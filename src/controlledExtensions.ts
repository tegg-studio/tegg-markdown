import {EditingController,sameEditingIdentity,type EditingIdentity,type EditSession,type EditResult,type ObjectKind} from "./editingController";
import type {MarkdownProfile} from "./syntaxProfiles";

export type ExtensionPrepareContext=Readonly<{
  identity:Readonly<EditingIdentity>;
  session:Readonly<Pick<EditSession,"token"|"kind"|"from"|"to"|"original"|"draft">>;
  signal:AbortSignal;
}>;
/** Trusted Host callback. It receives one local source draft, never a parser or EditorView. */
export type ControlledExtension=Readonly<{
  id:string;
  version:string;
  label:string;
  profiles?:readonly MarkdownProfile[];
  kinds?:readonly ObjectKind[];
  prepare:(context:ExtensionPrepareContext)=>Promise<{draft:string}>|{draft:string};
}>;
export type ExtensionStatus={id:string;version:string;label:string;enabled:boolean;reason?:string};
export type PreparedExtension=Readonly<{status:"ready";id:string;version:string;sessionToken:string;draft:string}>;
export type ExtensionPreparation=PreparedExtension|{status:"rejected";reason:string};
const profiles=new Set<MarkdownProfile>(["tegg","gfm","github"]);
const kinds=new Set<ObjectKind>(["selection","link","image","code","math","mermaid","graphviz","footnote","callout","metadata","table"]);
const localDraftLimit=65_536;

/** Review and commit are separate. Async results are bounded, cancellable and bound to one session. */
export class ControlledExtensionRegistry {
  private entries=new Map<string,ControlledExtension>();
  private pending?:AbortController;
  private ready?:PreparedExtension;
  private dead=false;
  private epoch=0;
  private readonly timeoutMs:number;
  constructor(readonly controller:EditingController,extensions:readonly ControlledExtension[],options:{timeoutMs?:number}={}){
    this.timeoutMs=options.timeoutMs??30_000;
    if(!Number.isFinite(this.timeoutMs)||this.timeoutMs<1||this.timeoutMs>60_000)throw new Error("invalid-extension-timeout");
    for(const extension of extensions){
      if(!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(extension.id)||extension.id.length>128)throw new Error("Extension IDs need a namespace, such as acme.format-label");
      if(this.entries.has(extension.id))throw new Error("duplicate-extension-id");
      if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(extension.version)||!extension.label?.trim()||extension.label.length>100||typeof extension.prepare!=="function")throw new Error("invalid-extension-metadata");
      if(extension.profiles?.some(profile=>!profiles.has(profile))||extension.kinds?.some(kind=>!kinds.has(kind)))throw new Error("invalid-extension-capability");
      this.entries.set(extension.id,Object.freeze({...extension,profiles:extension.profiles&&Object.freeze([...extension.profiles]),kinds:extension.kinds&&Object.freeze([...extension.kinds])}));
    }
  }
  private reason(extension:ControlledExtension,session?:EditSession|null):string|undefined{
    if(this.dead)return "destroyed";
    const reason=this.controller.unavailableReason;if(reason)return reason;
    if(extension.profiles&&!extension.profiles.includes(this.controller.identity.profile??"tegg"))return "unsupported-profile";
    if(session&&extension.kinds&&!extension.kinds.includes(session.kind))return "unsupported-object";
    return undefined;
  }
  list():ExtensionStatus[]{return [...this.entries.values()].map(extension=>{const reason=this.reason(extension);return {id:extension.id,version:extension.version,label:extension.label,enabled:!reason,...(reason?{reason}:{})};});}
  async prepare(id:string,sessionToken:string):Promise<ExtensionPreparation>{
    const extension=this.entries.get(id);if(!extension)return {status:"rejected",reason:"unknown-extension"};
    const session=this.controller.session,reason=this.reason(extension,session);
    if(reason)return {status:"rejected",reason};
    const valid=this.controller.validateSession(sessionToken);if(!valid.ok)return {status:"rejected",reason:valid.reason};
    if(!session||session.token!==sessionToken)return {status:"rejected",reason:"invalid-session"};
    if(session.kind==="selection"&&session.from===0&&session.to===this.controller.view.state.doc.length&&session.to>0)return {status:"rejected",reason:"whole-document-extension-forbidden"};
    if(session.original.length>localDraftLimit||session.draft.length>localDraftLimit)return {status:"rejected",reason:"extension-draft-too-large"};
    this.cancel();const epoch=++this.epoch,abort=this.pending=new AbortController(),identity=this.controller.identity;
    const signal=this.controller.signalForSession(sessionToken),end=()=>abort.abort("session-ended");signal?.addEventListener("abort",end,{once:true});
    if(signal?.aborted)end();
    let timer:ReturnType<typeof setTimeout>|undefined;
    let stopAbort:()=>void=()=>{};
    const context=Object.freeze({identity:Object.freeze({...identity}),session:Object.freeze({token:session.token,kind:session.kind,from:session.from,to:session.to,original:session.original,draft:session.draft}),signal:abort.signal});
    try{
      const interrupted=new Promise<never>((_resolve,reject)=>{
        const stop=()=>reject(new Error(String(abort.signal.reason??"cancelled")));stopAbort=()=>abort.signal.removeEventListener("abort",stop);
        abort.signal.addEventListener("abort",stop,{once:true});if(abort.signal.aborted)stop();
        timer=setTimeout(()=>abort.abort("extension-timeout"),this.timeoutMs);
      });
      const result=await Promise.race([Promise.resolve().then(()=>{if(abort.signal.aborted)throw new Error("cancelled");return extension.prepare(context);}),interrupted]);
      if(this.dead||epoch!==this.epoch||abort.signal.aborted)return {status:"rejected",reason:"cancelled-or-stale"};
      const current=this.controller.validateSession(sessionToken);if(!current.ok)return {status:"rejected",reason:current.reason};
      if(!sameEditingIdentity(identity,this.controller.identity)||this.controller.session?.draft!==session.draft)return {status:"rejected",reason:"draft-changed"};
      if(!result||typeof result.draft!=="string"||Object.keys(result).some(key=>key!=="draft"))return {status:"rejected",reason:"extension-must-return-local-draft"};
      if(result.draft.length>localDraftLimit)return {status:"rejected",reason:"extension-draft-too-large"};
      const prepared:PreparedExtension=Object.freeze({status:"ready",id:extension.id,version:extension.version,sessionToken,draft:result.draft});
      this.ready=prepared;return prepared;
    }catch(error){return {status:"rejected",reason:error instanceof Error?error.message:String(error)};}
    finally{clearTimeout(timer);stopAbort();signal?.removeEventListener("abort",end);if(this.pending===abort)this.pending=undefined;}
  }
  /** Only a preparation issued by this registry can be applied, after explicit Host/UI review. */
  commit(prepared:PreparedExtension,reviewedDraft=prepared.draft):EditResult{
    if(this.dead)return {ok:false,reason:"destroyed"};
    if(prepared!==this.ready)return {ok:false,reason:"invalid-extension-preparation"};
    if(typeof reviewedDraft!=="string"||reviewedDraft.length>localDraftLimit)return {ok:false,reason:"extension-draft-too-large"};
    return this.controller.commit(prepared.sessionToken,reviewedDraft);
  }
  cancel(){this.epoch++;this.pending?.abort("cancelled");this.pending=undefined;this.ready=undefined;}
  dispose(){if(this.dead)return;this.cancel();this.dead=true;this.entries.clear();}
}
