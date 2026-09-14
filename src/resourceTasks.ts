import type {EditingController, EditResult} from "./editingController";
import {renderPreparedPaste, type ClipboardFile, type PastePreparation} from "./clipboard";
export type StoreResourceContext = {signal:AbortSignal;documentId:string;generation:string;sessionToken:string;onProgress:(progress:number)=>void};
export type StoredResource = {reference:string};
export type ResourceHost = {storeResource?:(file:ClipboardFile,context:StoreResourceContext)=>Promise<StoredResource>;releaseResource?:(resource:StoredResource)=>void|Promise<void>;onError?:(error:unknown)=>void};
export type ResourceTaskState = {status:"pending"|"storing"|"failed"|"cancelled"|"stale"|"ready"|"applied";progress:number;indeterminate:boolean;error?:string;references:Readonly<Record<string,string>>};
/** Temporary browser URLs and absolute file paths never become serialized Markdown. */
export function assertPersistentReference(reference:string):string {
  if(typeof reference!=="string"||!reference||reference!==reference.trim()||/[\u0000-\u001f\u007f]/.test(reference)||
      /^(?:blob|data|javascript|vbscript|file):/i.test(reference)||/^\//.test(reference)) {
    throw new Error("The Host must return a persistent document-relative or HTTP(S) resource reference.");
  }
  const scheme=/^([\w+.-]+):/.exec(reference);
  if(scheme){
    if(!/^https?:$/i.test(scheme[0]))throw new Error("Unsupported persistent resource scheme.");
    let url:URL;try{url=new URL(reference);}catch{throw new Error("The persistent resource URL is invalid.");}
    if(!url.hostname)throw new Error("The persistent resource URL needs a hostname.");
  }
  return reference;
}
export class ResourceTask {
  private abort?:AbortController;
  private epoch=0;
  private dead=false;
  private value:ResourceTaskState={status:"pending",progress:0,indeterminate:true,references:{}};
  private listeners=new Set<(state:ResourceTaskState)=>void>();
  readonly prepared:Readonly<PastePreparation>;
  constructor(readonly controller:EditingController,readonly token:string,prepared:PastePreparation,readonly host:ResourceHost,readonly options:{commit?:boolean}={}){
    this.prepared=Object.freeze({...prepared,resources:Object.freeze(prepared.resources.map(resource=>Object.freeze({...resource}))),
      issues:Object.freeze(prepared.issues.map(issue=>Object.freeze({...issue})))} as unknown as PastePreparation);
  }
  get state():ResourceTaskState{return {...this.value,references:{...this.value.references}};}
  subscribe(fn:(state:ResourceTaskState)=>void){if(this.dead)return ()=>{};this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};}
  private set(state:Partial<ResourceTaskState>){this.value={...this.value,...state};for(const fn of this.listeners){try{fn(this.state);}catch(error){try{this.host.onError?.(error);}catch{/* observers do not control resource commits */}}}}
  private validate():EditResult{return this.dead?{ok:false,reason:"destroyed"}:this.controller.validateSession(this.token);}
  async run():Promise<EditResult>{
    if(this.value.status==="applied")return this.dead?{ok:false,reason:"destroyed"}:{ok:true,changed:false};
    if(this.value.status==="cancelled"||this.value.status==="stale")return {ok:false,reason:this.value.status};
    const initial=this.validate();if(!initial.ok)return initial;
    if(this.value.status==="storing")return {ok:false,reason:"already-storing"};
    if(this.prepared.status!=="ready")return {ok:false,reason:"paste-needs-review"};
    if(this.prepared.resources.length&&!this.host.storeResource){this.set({status:"failed",error:"This Host does not support storing attachments."});return {ok:false,reason:"resource-storage-unavailable"};}
    const epoch=++this.epoch,abort=this.abort=new AbortController(),identity=this.controller.identity;
    const sessionSignal=this.controller.signalForSession(this.token);
    const stale=()=>{abort.abort("session-ended");if(!this.dead&&epoch===this.epoch)this.set({status:"stale",error:"The document or target changed. Stored resources remain available."});};
    sessionSignal?.addEventListener("abort",stale,{once:true});
    this.set({status:"storing",error:undefined,progress:0,indeterminate:true});
    const refs={...this.value.references};
    try {
      for(let i=0;i<this.prepared.resources.length;i++){
        const valid=this.validate();if(!valid.ok){this.set({status:valid.reason==="composing"?"failed":"stale",error:valid.reason});return valid;}
        const file=this.prepared.resources[i];
        if(refs[file.id])continue;
        const stored=await this.host.storeResource!(file,{signal:abort.signal,documentId:identity.documentId,generation:identity.generation,sessionToken:this.token,onProgress:p=>{
          if(epoch===this.epoch&&!abort.signal.aborted&&!this.dead)this.set({indeterminate:false,progress:(i+Math.max(0,Math.min(1,Number.isFinite(p)?p:0)))/this.prepared.resources.length});
        }});
        if(epoch!==this.epoch||abort.signal.aborted||this.dead)return {ok:false,reason:"cancelled-or-stale"};
        // Preserve successful references even when composition temporarily prevents insertion.
        refs[file.id]=assertPersistentReference(stored.reference);this.set({references:{...refs}});
      }
      if(epoch!==this.epoch||abort.signal.aborted||this.dead)return {ok:false,reason:"cancelled-or-stale"};
      const valid=this.validate();if(!valid.ok){this.set({status:valid.reason==="composing"?"failed":"stale",error:valid.reason});return valid;}
      const markdown=renderPreparedPaste(this.prepared as PastePreparation,refs),updated=this.controller.updateDraft(this.token,markdown);
      if(!updated.ok){this.set({status:"failed",error:updated.reason});return updated;}
      this.set({status:"ready",progress:1,indeterminate:false});
      if(epoch!==this.epoch||abort.signal.aborted||this.dead)return {ok:false,reason:"cancelled-or-stale"};
      if(this.options.commit===false)return {ok:true,changed:false};
      const result=this.controller.commit(this.token,markdown);
      this.set(result.ok?{status:"applied"}:{status:"failed",error:result.reason});return result;
    }catch(error){
      if(epoch!==this.epoch||abort.signal.aborted||this.dead)return {ok:false,reason:"cancelled"};
      const message=error instanceof Error?error.message:String(error);this.set({status:"failed",error:message});return {ok:false,reason:message};
    }finally{sessionSignal?.removeEventListener("abort",stale);}
  }
  cancel(){if(this.dead)return;this.epoch++;this.abort?.abort();if(this.value.status!=="applied")this.set({status:"cancelled"});}
  destroy(){if(this.dead)return;this.cancel();this.dead=true;this.listeners.clear();}
}
