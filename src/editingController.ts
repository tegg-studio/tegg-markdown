import {Compartment, StateEffect, type EditorState, type Extension} from "@codemirror/state";
import {EditorView, type ViewUpdate} from "@codemirror/view";
import {ensureSyntaxTree} from "@codemirror/language";
import {getSupportedCommands,getCommandStatus} from "./commandRegistry";
import {editorToolbarState} from "./editorToolbar";
import {undoDepth,redoDepth,undo, redo} from "@codemirror/commands";
import {dispatchSourcePatches} from "./editorPatches";
import {executeEditorCommand} from "./editorToolbar";
import {findFrontmatter, findTechnicalBlocks} from "./profile";
import {inlineMathAt} from "./mathSyntax";
import {calloutRanges} from "./calloutEditing";
import type {MarkdownProfile} from "./syntaxProfiles";
import type {SourceRange} from "./sourcePatch";

export type EditingIdentity = {documentId:string; generation:string; sequence?:number; profile?:MarkdownProfile; mode?:"reader"|"live"|"source"; readOnly?:boolean};
export type ObjectKind = "selection"|"link"|"image"|"code"|"math"|"mermaid"|"graphviz"|"footnote"|"callout"|"metadata"|"table";
export type ObjectTarget = SourceRange & {kind:ObjectKind};
export type EditSession = ObjectTarget & {token:string; original:string; draft:string; status:"editing"|"stale"|"cancelled"|"applied"; reason?:string};
export type EditResult = {ok:true; changed:boolean}|{ok:false; reason:string};
export type EditingControllerOptions = {identity:()=>EditingIdentity; onSessionChange?:(session:EditSession|null)=>void; onError?:(error:unknown)=>void};
export type FindOptions = {caseSensitive?:boolean; wholeWord?:boolean; range?:SourceRange};
const controllers = new WeakMap<EditorView,EditingController>();
export const sameEditingIdentity = (a:EditingIdentity,b:EditingIdentity) => a.documentId===b.documentId && a.generation===b.generation && (a.profile??"tegg")===(b.profile??"tegg") && (a.mode??"live")===(b.mode??"live") && !!a.readOnly===!!b.readOnly;
const sameIdentity = sameEditingIdentity;
const objectKinds = new Set<ObjectKind>(["selection","link","image","code","math","mermaid","graphviz","footnote","callout","metadata","table"]);
const allowed = (kind:ObjectKind,profile:MarkdownProfile="tegg") => !(profile==="gfm" && ["math","mermaid","graphviz","footnote","callout","metadata"].includes(kind)) && !(profile==="github" && ["graphviz","metadata"].includes(kind));
const splitsCodePoint=(text:string,position:number)=>position>0&&position<text.length&&/[\uD800-\uDBFF]/.test(text[position-1])&&/[\uDC00-\uDFFF]/.test(text[position]);
const codePointBefore=(text:string,position:number)=>position>0?text.slice(splitsCodePoint(text,position-1)?position-2:position-1,position):"";
const wordCharacter=(value:string)=>/[\p{L}\p{N}\p{M}_\u200c\u200d]/u.test(value);

/** Source positions are CodeMirror UTF-16 offsets (normalized document newlines). */
export function objectAt(state:EditorState, position:number, profile:MarkdownProfile="tegg"):ObjectTarget|null {
  const source=state.doc.toString(), pos=Math.max(0,Math.min(position,source.length));
  const front=findFrontmatter(source);
  if(profile==="tegg" && front.to && pos<front.to) return {kind:"metadata",from:0,to:front.to};
  const tree=ensureSyntaxTree(state,Math.min(source.length,pos+1),50);
  let node=tree?.resolveInner(pos,-1);
  const nodes=[];
  while(node){nodes.push(node);node=node.parent??undefined;}
  for(const item of nodes){
    if(item.name==="Image" || item.name==="Link") return {kind:item.name==="Image"?"image":"link",from:item.from,to:item.to};
    if(item.name==="InlineCode" || item.name==="CodeBlock") return item.name==="CodeBlock"?{kind:"code",from:item.from,to:item.to}:null;
  }
  for(const block of findTechnicalBlocks(source)){const kind=block.kind==="dot"?"graphviz":block.kind;if(pos>=block.from && pos<=block.to && allowed(kind,profile)) return {kind,from:block.from,to:block.to};}
  const fence=nodes.find(item=>item.name==="FencedCode");
  if(fence) return {kind:"code",from:fence.from,to:fence.to};
  const line=state.doc.lineAt(pos);
  if(allowed("math",profile)) for(let i=line.from;i<line.to;i++){
    const match=inlineMathAt(source,i);
    if(match && pos>=match.from && pos<=match.to) return {kind:"math",from:match.from,to:match.to};
    if(match)i=match.to-1;
  }
  if(allowed("footnote",profile)){
    const ref=/\[\^([^\]\n]+)\]/g;let label:string|undefined;
    for(const match of line.text.matchAll(ref)) if(pos>=line.from+match.index! && pos<=line.from+match.index!+match[0].length) label=match[1];
    const candidates: ObjectTarget[]=[];
    for(let n=1;n<=state.doc.lines;n++){
      const l=state.doc.line(n), m=l.text.match(/^ {0,3}\[\^([^\]]+)\]:/);
      if(!m) continue;
      let end=n;
      while(end<state.doc.lines && /^(?: {4}|\t)/.test(state.doc.line(end+1).text))end++;
      const target={kind:"footnote" as const,from:l.from,to:state.doc.line(end).to};
      if(label===m[1] || (!label && pos>=target.from && pos<=target.to)) candidates.push(target);
      n=end;
    }
    if(candidates.length===1)return candidates[0];
  }
  if(allowed("callout",profile)){
    const callout=calloutRanges(state).filter(r=>pos>=r.from && pos<=r.to).sort((a,b)=>(a.to-a.from)-(b.to-b.from))[0];
    if(callout)return {kind:"callout",from:callout.from,to:callout.to};
  }
  const table=nodes.find(item=>item.name==="Table");
  return table?{kind:"table",from:table.from,to:table.to}:null;
}

/** One controller per EditorView; installs its own update listener. Never owns a second document. */
export class EditingController {
  readonly instanceId=crypto.randomUUID();
  private active:EditSession|null=null;
  private captured:EditingIdentity|null=null;
  private applied=new Set<string>();
  private dead=false;
  private applying=false;
  private queued=false;
  private listeners=new Set<(session:EditSession|null)=>void>();
  private sessionAbort?:AbortController;
  private readonly listener = new Compartment();
  private detectedTarget = false;
  readonly extension:Extension;
  constructor(readonly view:EditorView, readonly options:EditingControllerOptions){
    if(controllers.has(view))throw new Error("This EditorView already has an editing controller");
    controllers.set(view,this);
    this.extension=this.listener.of(EditorView.updateListener.of(update=>this.track(update)));
    this.attachToCurrentState();
  }
  attachToCurrentState(){if(!this.dead && this.listener.get(this.view.state)===undefined)this.view.dispatch({effects:StateEffect.appendConfig.of(this.extension)});}
  get identity(){return {...this.options.identity()};}
  get session():EditSession|null{this.refreshIdentity();return this.active?{...this.active}:null;}
  get unavailableReason():string|null{return this.reason();}
  supports(kind:ObjectKind){return objectKinds.has(kind)&&allowed(kind,this.identity.profile);}
  subscribe(listener:(session:EditSession|null)=>void){if(this.dead)return ()=>{};this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
  private report(error:unknown){try{this.options.onError?.(error);}catch{ /* observers cannot interrupt transaction delivery */ }}
  private publish(){
    if(this.queued||this.dead)return;this.queued=true;
    queueMicrotask(()=>{this.queued=false;if(this.dead)return;const value=this.session;try{this.options.onSessionChange?.(value);}catch(error){this.report(error);}for(const listener of this.listeners){try{listener(value?{...value}:null);}catch(error){this.report(error);}}});
  }
  private reason(){if(this.dead)return "destroyed";const id=this.identity;return (id.readOnly||id.mode==="reader"||this.view.state.readOnly)?"read-only":this.view.composing?"composing":null;}
  signalForSession(token:string):AbortSignal|null{this.refreshIdentity();return this.active?.token===token?this.sessionAbort?.signal??null:null;}
  private refreshIdentity(){if(!this.dead&&this.active?.status==="editing"&&(!this.captured||!sameIdentity(this.captured,this.identity)))this.invalidate("document-changed");}
  /** Current capability check for asynchronous tasks; does not advance or replace a draft. */
  validateSession(token:string):EditResult{
    const reason=this.reason();if(reason)return {ok:false,reason};
    this.refreshIdentity();const session=this.active;
    if(!session||session.token!==token)return {ok:false,reason:"invalid-session"};
    if(session.status!=="editing")return {ok:false,reason:session.reason??session.status};
    if(this.view.state.doc.sliceString(session.from,session.to)!==session.original){this.invalidate("target-changed");return {ok:false,reason:"target-changed"};}
    return {ok:true,changed:false};
  }
  private track(update:ViewUpdate){
    const session=this.active;
    if(this.dead||!session||session.status!=="editing"||this.applying)return;
    if(!this.captured||!sameIdentity(this.captured,this.identity)){this.invalidate("document-changed");return;}
    for(const transaction of update.transactions){
      if(!transaction.docChanged)continue;
      const {from,to}=session;let touched=false;
      transaction.changes.iterChangedRanges((a,b)=>{
        if(from===to ? a<=from&&b>=from : (a===b ? a>=from&&a<=to : a<to&&b>from))touched=true;
      });
      if(touched){this.invalidate("target-changed");return;}
      session.from=transaction.changes.mapPos(from,1);session.to=transaction.changes.mapPos(to,-1);
    }
    if(update.docChanged){
      if(this.view.state.doc.sliceString(session.from,session.to)!==session.original)this.invalidate("target-changed");
      else this.publish();
    }
  }
  private invalidate(reason:string){if(this.active?.status==="editing"){this.active.status="stale";this.active.reason=reason;this.sessionAbort?.abort(reason);this.publish();}}
  begin(kind?:ObjectKind, range?:SourceRange):EditSession {
    const reason=this.reason();if(reason)throw new Error(reason);
    if(this.active?.status==="editing"||this.active?.status==="stale")throw new Error("Finish or cancel the current object draft first");
    const selection=this.view.state.selection.main;
    const detected=range?null:objectAt(this.view.state,selection.from,this.identity.profile);
    const target=range?{...range,kind:kind??"selection"}:detected&&(!kind||detected.kind===kind)?detected:{kind:kind??"selection",from:selection.from,to:selection.to};
    if(!this.supports(target.kind))throw new Error("unsupported-profile");
    if(!Number.isInteger(target.from)||!Number.isInteger(target.to)||target.from<0||target.to<target.from||target.to>this.view.state.doc.length)throw new Error("invalid-range");
    const original=this.view.state.doc.sliceString(target.from,target.to);
    this.detectedTarget=!!detected && detected.from===target.from && detected.to===target.to && detected.kind===target.kind;
    this.captured=this.identity;
    this.sessionAbort=new AbortController();
    this.active={...target,token:this.instanceId+":"+crypto.randomUUID(),original,draft:original,status:"editing"};
    this.publish();return this.session!;
  }
  updateDraft(token:string,draft:string):EditResult{
    if(this.dead)return {ok:false,reason:"destroyed"};
    if(typeof draft!=="string")return {ok:false,reason:"invalid-draft"};
    if(!this.active||this.active.token!==token||!["editing","stale"].includes(this.active.status))return {ok:false,reason:"invalid-session"};
    this.active.draft=draft;this.publish();return {ok:true,changed:false};
  }
  commit(token:string,draft?:string):EditResult {
    const reason=this.reason();if(reason)return {ok:false,reason};
    const session=this.active;
    if(!session||session.token!==token)return {ok:false,reason:"invalid-session"};
    if(!this.captured||!sameIdentity(this.captured,this.identity))this.invalidate("document-changed");
    if(session.status==="applied"&&this.applied.has(token)&&this.captured&&sameIdentity(this.captured,this.identity))return {ok:true,changed:false};
    if(session.status!=="editing")return {ok:false,reason:session.reason??session.status};
    if(this.view.state.doc.sliceString(session.from,session.to)!==session.original){this.invalidate("target-changed");return {ok:false,reason:"target-changed"};}
    if(this.detectedTarget){
      const target=objectAt(this.view.state,Math.min(session.to,session.from+1),this.identity.profile);
      if(!target||target.kind!==session.kind||target.from!==session.from||target.to!==session.to){this.invalidate("target-structure-changed");return {ok:false,reason:"target-structure-changed"};}
    }
    if(typeof(draft??session.draft)!=="string")return {ok:false,reason:"invalid-draft"};
    const next=(draft??session.draft).replace(/\r\n/g,"\n");
    this.applying=true;
    try{
      if(next!==session.original)dispatchSourcePatches(this.view,[{from:session.from,to:session.to,expected:session.original,insert:next}],{isolateHistory:true,selection:{anchor:session.from+next.length},scrollIntoView:true});
      session.status="applied";session.draft=next;this.applied.add(token);
      if(this.applied.size>32)this.applied.delete(this.applied.values().next().value!);
      this.publish();return {ok:true,changed:next!==session.original};
    }finally{this.applying=false;}
  }
  cancel(token?:string):EditResult{
    if(!this.active||(token&&this.active.token!==token))return {ok:false,reason:"invalid-session"};
    if(this.active.status==="applied")return {ok:false,reason:"already-applied"};
    this.active.status="cancelled";this.sessionAbort?.abort("cancelled");this.publish();return {ok:true,changed:false};
  }
  reset(){if(this.dead)return;this.invalidate("document-changed");this.applied.clear();this.attachToCurrentState();this.publish();}
  command(command:string):boolean{
    if(this.reason())return false;
    const profile=this.identity.profile??"tegg";
    const state={...editorToolbarState(this.view.state),profile,commands:getSupportedCommands(profile),mode:this.identity.mode??"live",dirty:false,toolbarEnabled:true,canUndo:undoDepth(this.view.state)>0,canRedo:redoDepth(this.view.state)>0};
    if(!getCommandStatus(command,state).enabled)return false;
    if(command==="undo")return undo(this.view);
    if(command==="redo")return redo(this.view);
    executeEditorCommand(this.view,command);return true;
  }
  find(query:string,options:FindOptions={}):SourceRange[]{
    if(!query)return [];
    const source=this.view.state.doc.toString(), needle=options.caseSensitive?query:query.toLowerCase();
    // Case folding can expand Unicode; do not use those offsets to modify the source.
    const result:SourceRange[]=[];const from=options.range?.from??0,to=options.range?.to??source.length;
    if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<from||to>source.length)throw new RangeError("invalid-search-range");
    for(let p=from;p<=to-query.length;p++){
      if(splitsCodePoint(source,p)||splitsCodePoint(source,p+query.length))continue;
      const candidate=source.slice(p,p+query.length);
      if((options.caseSensitive?candidate:candidate.toLowerCase())!==needle)continue;
      if(options.wholeWord && (wordCharacter(codePointBefore(source,p))||wordCharacter(String.fromCodePoint(source.codePointAt(p+query.length)??0))))continue;
      result.push({from:p,to:p+query.length});p+=query.length-1;
    }
    return result;
  }
  replace(query:string,replacement:string,options:FindOptions & {all?:boolean}={}):EditResult{
    const reason=this.reason();if(reason)return {ok:false,reason};
    const ranges=this.find(query,options);if(!ranges.length)return {ok:true,changed:false};
    const current=this.view.state.selection.main;
    const chosen=options.all?ranges:[ranges.find(r=>r.from>=current.from)??ranges[0]];
    const patches=chosen.map(r=>({...r,expected:this.view.state.doc.sliceString(r.from,r.to),insert:replacement.replace(/\r\n/g,"\n")})).filter(patch=>patch.expected!==patch.insert);
    if(patches.length)dispatchSourcePatches(this.view,patches,{isolateHistory:true});
    return {ok:true,changed:patches.length>0};
  }
  destroy(){if(this.dead)return;this.cancel();this.dead=true;this.listeners.clear();controllers.delete(this.view);this.applied.clear();if(this.listener.get(this.view.state)!==undefined)this.view.dispatch({effects:this.listener.reconfigure([])});}
}
export function editingControllerFor(view:EditorView){return controllers.get(view);}
