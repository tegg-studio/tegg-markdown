import {allocatedEditingSurface} from './overlayPlacement';
import {requestSemanticClipboardRead} from './clipboardTransport';
import {captureEditorClipboardSelection} from './contentClipboard';
import {readReferenceObject,serializeReferenceObject} from './htmlReferenceDraft';
import {installNestedEditingProvider,type NestedEditingOptions} from './nestedEditingScope';
import {editingLeaveAwaitingChoice,editingLeaveIsComposing,cancelIndependentEditingLeave} from './editingPreflight';
import {prepareEditingLeave} from './editingLeave';
import {inspectDocument,queryInspection,inspectionLocation,expandInspectionLocation,type InspectionKind} from './documentInspection';
import {captureCurrentLinkDraft} from './liveLinks';
import {captureHtmlTableDrafts} from './htmlTableWidget';
import {captureMetadataActiveDrafts} from './metadata';
import {routeFootnoteCommand,executeFocusedFootnoteCommand} from './footnoteEditing';
import {createCommandSurface} from "./commandSurface";
import {Compartment, StateEffect} from "@codemirror/state";
import {EditorView} from "@codemirror/view";
import {syntaxTree} from "@codemirror/language";
import {parseDocument} from "yaml";
import {objectAt,EditingController,editingControllerFor, sameEditingIdentity, type EditingIdentity, type ObjectKind, type EditSession, type FindOptions} from "./editingController";
import {captureClipboard,preparePaste,type ClipboardInput,type PastePreparation} from "./clipboard";
import {ResourceTask,type ResourceHost,type StoredResource,assertPersistentReference} from "./resourceTasks";
import {focusedTableCell,tableWidgetOwnsFocus,executeFocusedTableCommand} from "./tableWidget";
import {focusCodeAtSelection} from "./codeEditing";
import {technicalDraft} from "./technicalDraft";
import {validateTechnicalDraft,type TechnicalValidationOutcome} from "./technicalSyntax";
import {readLinkDraft,serializeLinkDraft,serializeImageReference} from "./objectDraft";
import {objectIcon,enhanceFigures} from "./renderInteraction";
import {bindEngines,enginesFor} from "./renderEngines";
import {renderMathInto,sanitizeRenderedHtml,sanitizeDiagramSvg} from "./renderKit";
import {parserFor} from "./markdownParser";
import {resourceContext,displaySessionFor,sameResourceContextAuthority} from "./editorHost";
import {setUIText,setUILabel,bindUI,contextFor,type UIOptions} from "./uiContext";
import type {SourceRange} from "./sourcePatch";
import {editingBudgets} from "./editingBudget";
import {ControlledExtensionRegistry,type ControlledExtension} from "./controlledExtensions";
export type ActiveEditingDraft =
  | {kind:'object';panel:HTMLElement;controller:EditingController;token:string;current:()=>boolean}
  | {kind:'link'|'html-cell'|'metadata';panel:HTMLElement;controller?:never;token?:never;current:()=>boolean};
export type EditingUIHost = ResourceHost & UIOptions & {
  toolbar?:boolean;
  /** Original source (including its newlines) for readonly inspection. */
  source?:()=>string;
  extensions?:readonly ControlledExtension[];
  chooseResource?:(context:{documentId:string;generation:string;sessionToken:string;signal:AbortSignal})=>Promise<StoredResource & {alt?:string;title?:string;kind?:"image"|"file"}|null>;
  mobile?:boolean;
  modalRoot?:HTMLElement;
  copyText?:(text:string)=>void|Promise<void>;
  onError?:(error:unknown)=>void;
};
/** Empty transport representations carry no insertion and must not erase a selection. */
function hasClipboardPayload(input:ClipboardInput):boolean {
  return [input.text,input.markdown,input.html,input.structured].some(value=>!!value)
    || !!input.files?.length || !!input.cells?.length;
}
const instances=new WeakMap<EditingController,EditingUI>();
const viewInstances=new WeakMap<EditorView,EditingUI>();
const nestedInstances=new WeakMap<EditorView,Set<EditingUI>>();
// These controls contain literal Markdown or search strings. Native WebKit text
// correction can otherwise rewrite a value on blur, after the last input event.
function literalControl<T extends HTMLInputElement|HTMLTextAreaElement>(control:T):T {
  control.setAttribute("autocorrect","off");
  control.setAttribute("autocapitalize","none");
  control.setAttribute("autocomplete","off");
  control.spellcheck=false;
  return control;
}

/** Optional DOM chrome. Document semantics and all mutations stay in the shared controller. */
export class EditingUI {
  readonly element=document.createElement("section");
  private panel=document.createElement("div");
  private panelPurpose:'object'|'search'|'inspection'|null=null;
  /** Actual readonly inspection ownership; author DOM classes cannot grant this authority. */
  get inspectionElement():HTMLElement|null{return this.alive&&this.panelPurpose==='inspection'&&!this.panel.hidden&&this.panel.isConnected?this.panel:null;}
  private status=document.createElement("p");
  private content=document.createElement("div");
  private footer=document.createElement("footer");
  private panelCleanup?:()=>void;
  private mobile=false;
  private modalRoot?:{node:HTMLElement;inert:boolean};
  private initialDraft="";
  private closeNotice?:HTMLElement;
  private guardInert:{node:HTMLElement;inert:boolean}[]=[];
  private guardReturn?:{field:HTMLInputElement|HTMLTextAreaElement;start:number|null;end:number|null;direction:"forward"|"backward"|"none"|null};
  private lastDraftField?:HTMLInputElement|HTMLTextAreaElement;
  private fieldFocus=(event:FocusEvent)=>{const node=event.target;if((node instanceof HTMLInputElement||node instanceof HTMLTextAreaElement)&&this.content.contains(node))this.lastDraftField=node;};
  private stop:()=>void;
  private effects=new Compartment();
  private task?:ResourceTask;
  private tableResourceController?:EditingController;
  private tableResourceOwned=false;
  private tableResourceToken?:string;
  private tableResourceComplete?:()=>void;
  private picker?:AbortController;
  private filePicker?:HTMLInputElement;
  private stopTask?:()=>void;
  private panelOwner?:{controller:EditingController;token:string;identity:EditingIdentity};
  private panelEpoch=0;
  private copyEpoch=0;
  private copyDraftRevision=0;
  private copyDraftChanged=()=>{this.copyDraftRevision++;};
  private modalToolbar?:{node:HTMLElement;inert:boolean};
  private syntaxEpoch=0;
  private syntaxState:'idle'|'pending'|'invalid'='idle';
  private syntaxError?:HTMLElement;
  private previewEpoch=0;
  private previewTimer?:ReturnType<typeof setTimeout>;
  private alive=true;
  private composing=false;
  private leavePending=false;
  private resolvingLeave=false;
  /** True only while an explicit leave is awaiting a draft choice, including projected children. */
  get awaitingLeaveChoice():boolean {return this.alive&&(editingLeaveAwaitingChoice(this.controller.view)||(this.leavePending&&!!this.closeNotice)||[...(nestedInstances.get(this.controller.view)??[])].some(ui=>ui.awaitingLeaveChoice));}
  get isComposing():boolean{return this.composing||this.controller.view.composing||editingLeaveIsComposing(this.controller.view)||[...(nestedInstances.get(this.controller.view)??[])].some(ui=>ui.isComposing);}
  cancelPendingLeave(){this.cancelLeave();}
  private cancelLeave(){const pending=this.leavePending;this.leavePending=false;if(pending)this.element.dispatchEvent(new CustomEvent('tegg-editing-leave-cancelled',{bubbles:true}));}
  private preflight=(event:Event)=>{if(event.target!==this.controller.view.dom)return;if(this.composing){event.preventDefault();}};
  private forwardLeave=(event:Event)=>{if(!(event.target instanceof Node)||!this.controller.view.dom.contains(event.target))return;event.stopPropagation();this.element.dispatchEvent(new CustomEvent(event.type,{bubbles:true,detail:(event as CustomEvent).detail}));};
  private leaveRequest=(event:Event)=>{if(event.target!==this.controller.view.dom)return;if(this.composing)return;this.leavePending=true;this.requestClose();};
  private compositionPointer=(event:Event)=>{if((this.composing||this.controller.view.composing)&&event.target instanceof Element&&event.target.closest('button,summary')){event.preventDefault();event.stopPropagation();}};
  private compositionStart=()=>{this.copyEpoch++;this.composing=true;if(this.leavePending)this.cancelLeave();this.sync();};
  private compositionEnd=()=>{this.composing=false;this.sync();};
  private apply?:HTMLButtonElement;
  private textarea?:HTMLTextAreaElement;
  private returnFocus?:HTMLElement;
  private extensions:ControlledExtensionRegistry;
  private uiBinding:ReturnType<typeof bindUI>;
  private tableFocusChanged=()=>this.sync();
  constructor(readonly controller:EditingController,root:HTMLElement,readonly host:EditingUIHost={}){
    installNestedEditingProvider(attachNestedEditingUI);
    if(instances.has(controller))throw new Error("This controller already has an editing UI");this.extensions=new ControlledExtensionRegistry(controller,host.extensions??[]);instances.set(controller,this);viewInstances.set(controller.view,this);
    this.uiBinding=bindUI(this.element,{...contextFor(controller.view.dom),...(host.locale?{locale:host.locale}:{}),...(host.messages?{messages:host.messages}:{}),...(host.overlayContainer?{overlayContainer:host.overlayContainer}:{})});
    this.mobile=host.mobile??contextFor(controller.view.dom).mobile??(typeof matchMedia!=="undefined"&&matchMedia("(pointer:coarse)").matches);this.element.dataset.mobile=String(this.mobile);
    this.element.className="tegg-editing-ui";this.panel.className="tegg-editing-panel";this.panel.hidden=true;
    this.status.setAttribute("role","status");this.status.setAttribute("aria-live","polite");
    if(host.toolbar!==false){
      const bar=document.createElement("div");bar.className="tegg-editing-toolbar";bar.setAttribute("role","toolbar");setUILabel(bar,"Editing tools");
      for(const [label,command] of [["Undo","undo"],["Redo","redo"],["Bold","bold"],["Italic","italic"],["List","list"],["Task list","task"]])bar.append(this.button(label,()=>executeFocusedFootnoteCommand(controller.view,command)||executeFocusedTableCommand(controller.view,command)||controller.command(command)));
      for(const [label,kind] of [["Edit object",undefined],["Link","link"],["Image","image"],["Code block","code"],["Formula","math"],["Mermaid","mermaid"],["GraphViz","graphviz"],["Footnote","footnote"],["Callout","callout"],["Metadata · YAML","metadata"]] as const)bar.append(this.button(label,()=>this.openObject(kind)));
      bar.append(this.button("Attach file",()=>this.chooseResource()),this.button("Find and replace",()=>this.openSearch()));
      for(const extension of this.extensions.list()){const button=this.button(extension.label,()=>this.openExtension(extension.id));button.dataset.extension=extension.id;bar.append(button);}
      this.element.append(bar);
    }
    this.element.append(this.panel,this.status);root.append(this.element);
    this.stop=controller.subscribe(session=>{if(!this.alive)return;this.attachToCurrentState();this.sync();if(session?.status==="stale"){this.picker?.abort();this.previewEpoch++;clearTimeout(this.previewTimer);this.message("The document changed. Copy your draft or cancel and reopen this object.");if(this.apply)this.apply.disabled=true;}});
    this.element.addEventListener("keydown",this.panelKey);
    this.panel.addEventListener("pointerdown",this.compositionPointer,true);this.panel.addEventListener("mousedown",this.compositionPointer,true);this.panel.addEventListener("input",this.copyDraftChanged);this.panel.addEventListener("focusin",this.fieldFocus);this.panel.addEventListener("compositionstart",this.compositionStart);this.panel.addEventListener("compositionend",this.compositionEnd);
    controller.view.dom.addEventListener('tegg-editing-leave-resolved',this.forwardLeave);controller.view.dom.addEventListener('tegg-editing-leave-cancelled',this.forwardLeave);controller.view.dom.addEventListener("tegg-editing-preflight",this.preflight);controller.view.dom.addEventListener("tegg-editing-leave-request",this.leaveRequest);
    controller.view.dom.addEventListener("keydown",this.editorKey);
    controller.view.dom.addEventListener("tegg-edit-object",this.objectEvent);
    controller.view.dom.addEventListener("tegg-table-resource-paste",this.tablePaste);
    controller.view.dom.addEventListener("tegg-toolbar-state",this.tableFocusChanged);
    controller.view.dom.addEventListener("focusin",this.tableFocusChanged);
    controller.view.dom.addEventListener("focusout",this.tableFocusChanged);
    this.attachToCurrentState();this.sync();
  }
  /** Capture existing source-bound drafts, never infer ownership from panel DOM. */
  captureActiveDrafts():readonly ActiveEditingDraft[]{
    const drafts:ActiveEditingDraft[]=[],owner=this.panelOwner,session=owner?.controller.session;
    if(this.alive&&!this.panel.hidden&&this.panel.isConnected&&owner&&session?.token===owner.token&&["editing","stale"].includes(session.status)&&sameEditingIdentity(owner.identity,owner.controller.identity)){
      const {controller,token}=owner,panel=this.panel,epoch=this.panelEpoch,doc=controller.view.state.doc,
        identity=controller.identity,status=session.status;
      drafts.push({kind:'object',panel,controller,token,current:()=>this.alive&&this.panel===panel&&!panel.hidden&&panel.isConnected&&
        epoch===this.panelEpoch&&this.panelOwner?.controller===controller&&this.panelOwner.token===token&&
        controller.session?.token===token&&controller.session.status===status&&controller.view.state.doc===doc&&
        sameEditingIdentity(identity,controller.identity)&&sameEditingIdentity(owner.identity,controller.identity)});
    }
    const link=this.alive?captureCurrentLinkDraft(this.controller.view):null;
    if(link){
      const view=this.controller.view,doc=view.state.doc,identity=this.controller.identity;
      drafts.push({kind:'link',panel:link.panel,current:()=>this.alive&&view.state.doc===doc&&
        sameEditingIdentity(identity,this.controller.identity)&&link.current()});
    }
    if(this.alive){
      const view=this.controller.view,identity=this.controller.identity;
      for(const lease of captureHtmlTableDrafts(view))drafts.push({kind:'html-cell',panel:lease.panel,
        current:()=>this.alive&&sameEditingIdentity(identity,this.controller.identity)&&lease.current()});
    }
    if(this.alive){
      const view=this.controller.view,identity=this.controller.identity,doc=view.state.doc,context={...view.state.facet(resourceContext)};
      for(const lease of captureMetadataActiveDrafts(view.dom))drafts.push({kind:'metadata',panel:lease.panel,
        current:()=>this.alive&&view.state.doc===doc&&sameResourceContextAuthority(context,view.state.facet(resourceContext))&&sameEditingIdentity(identity,this.controller.identity)&&lease.current()});
    }
    for(const child of nestedInstances.get(this.controller.view)??[])drafts.push(...child.captureActiveDrafts());
    return drafts;
  }
  setUI(options:UIOptions){if(this.alive)this.uiBinding.update(options);}
  private safe(run:()=>unknown){if(this.isComposing)return;try{Promise.resolve(run()).catch(error=>this.error(error));}catch(error){this.error(error);}}
  private button(label:string,run:()=>unknown){const button=document.createElement("button");button.type="button";setUIText(button,label);button.dataset.label=label;button.addEventListener("mousedown",event=>{if(!this.element.querySelector(".tegg-editing-panel:not([hidden])"))event.preventDefault();});button.addEventListener("click",()=>{if(this.alive)this.safe(run);});return button;}
  private label(text:string,control:HTMLElement){const label=document.createElement("label");const span=document.createElement("span");setUIText(span,text);label.append(span,control);return label;}
  private input(label:string,value="",type="text"){const input=document.createElement("input");input.type=type;if(type==="text")literalControl(input);setUILabel(input,label);input.value=value;this.content.append(this.label(label,input));return input;}
  private message(text:string){if(this.alive)setUIText(this.status,text);}
  private error(error:unknown){if(!this.alive)return;this.message(error instanceof Error?error.message:String(error));try{this.host.onError?.(error);}catch{/* diagnostic observers cannot break UI cleanup */}}
  private sync(){const reason=this.isComposing?"composing":this.controller.unavailableReason,extensions=this.extensions.list(),cell=!!focusedTableCell(this.controller.view),preview=tableWidgetOwnsFocus(this.controller.view)&&!cell;for(const button of this.element.querySelectorAll<HTMLButtonElement>(".tegg-editing-toolbar button"))button.disabled=(preview&&!["Undo","Redo","Find and replace"].includes(button.dataset.label??""))||(cell&&!["Undo","Redo","Bold","Italic","Link","Find and replace"].includes(button.dataset.label??""))||(button.dataset.extension?!extensions.find(item=>item.id===button.dataset.extension)?.enabled:button.dataset.label==="Find and replace"?reason==="composing"||reason==="destroyed":!!reason);for(const button of this.panel.querySelectorAll<HTMLButtonElement>('button[data-mutation="true"]'))button.disabled=!!reason||this.controller.session?.status==="stale"||(button===this.apply&&this.syntaxState!=="idle");const complete=this.closeNotice?.querySelector<HTMLButtonElement>('[data-label="Complete and continue"]');if(complete)complete.disabled=!this.apply||this.apply.disabled;}
  attachToCurrentState(){
    if(!this.alive||this.controller.unavailableReason==="destroyed")return;
    if(this.effects.get(this.controller.view.state)!==undefined)return;
    this.controller.view.dispatch({effects:StateEffect.appendConfig.of(this.effects.of([
      createCommandSurface(this.controller),
      EditorView.updateListener.of(()=>queueMicrotask(()=>{if(this.alive)this.sync();})),
      EditorView.domEventHandlers({paste:(event,view)=>{
        if(view.composing||view.state.readOnly||this.controller.identity.mode==="reader"||!event.clipboardData)return false;
        const captured=captureClipboard(event.clipboardData),selection=captureEditorClipboardSelection(view),doc=view.state.doc,context=view.state.facet(resourceContext),identity=this.controller.identity;
        const read=requestSemanticClipboardRead(view.dom,'content',{text:captured.text??'',html:captured.html,structured:captured.structured});
        if(read instanceof Promise){event.preventDefault();void read.then(data=>{if(!this.alive||!view.dom.isConnected||view.composing||this.composing||view.state.readOnly||view.state.doc!==doc||view.state.facet(resourceContext)!==context||!view.state.selection.eq(selection)||!sameEditingIdentity(identity,this.controller.identity))throw new Error('The paste target changed. Paste again.');return this.paste(hasClipboardPayload(data)?{...data,files:captured.files}:captured,{from:selection.main.from,to:selection.main.to});}).catch(error=>this.error(error));return true;}
        if(!captured.structured&&!captured.html&&!captured.markdown&&!captured.files?.length&&!captured.delimiter&&!captured.text?.includes('\t'))return false;
        event.preventDefault();void this.paste(captured,{from:selection.main.from,to:selection.main.to}).catch(error=>this.error(error));return true;
      },drop:(event,view)=>{
        if(view.composing||view.state.readOnly||this.controller.identity.mode==="reader"||!event.dataTransfer?.files.length)return false;
        event.preventDefault();const captured=captureClipboard(event.dataTransfer);const position=view.posAtCoords({x:event.clientX,y:event.clientY});
        void this.paste(captured,position===null?undefined:{from:position,to:position}).catch(error=>this.error(error));return true;
      }})
    ]))});
  }
  private editorKey=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="f"&&!event.isComposing&&!this.controller.view.composing){event.preventDefault();event.stopPropagation();this.safe(()=>this.openSearch());}};
  private objectEvent=(event:Event)=>{event.preventDefault();event.stopPropagation();this.safe(()=>{const detail=(event as CustomEvent<{kind?:ObjectKind;from:number;to?:number;create?:boolean}>).detail;if(!detail||!Number.isInteger(detail.from))throw new Error("invalid-object-target");this.openObject(detail.kind,detail.to===undefined?undefined:{from:detail.from,to:detail.to},detail.from,detail.create===true);});};
  private tablePaste=(event:Event)=>{
    event.preventDefault();event.stopPropagation();
    const detail=(event as CustomEvent<{from:number;to:number;expected:string;prepared:PastePreparation;cellDraft?:{view:EditorView;range:SourceRange;current:()=>boolean;complete:()=>void;cancelWith:(cancel:()=>void)=>void}}>).detail;
    try{if(this.controller.view.state.doc.sliceString(detail.from,detail.to)!==detail.expected)throw new Error("The table changed. Paste again.");
      if(detail.cellDraft){void this.pasteTableCellDraft(detail.cellDraft,detail.prepared).catch(error=>this.error(error));return;}
      const session=this.controller.begin("table",{from:detail.from,to:detail.to});void this.applyPaste(session,detail.prepared).catch(error=>this.error(error));
    }catch(error){this.error(error);}
  };
  private clearTableResource(){const child=this.tableResourceController,token=this.tableResourceToken;if(child&&token&&child.session?.token===token&&['editing','stale'].includes(child.session.status))child.cancel(token);if(this.tableResourceOwned)child?.destroy();this.tableResourceController=undefined;this.tableResourceToken=undefined;this.tableResourceOwned=false;this.tableResourceComplete?.();this.tableResourceComplete=undefined;}
  private async pasteTableCellDraft(target:{view:EditorView;range:SourceRange;current:()=>boolean;complete:()=>void;cancelWith:(cancel:()=>void)=>void},prepared:PastePreparation){
    if(!target.current())throw new Error('The table cell changed. Paste again.');
    this.stopTask?.();this.task?.destroy();this.clearTableResource();
    const existing=editingControllerFor(target.view);this.tableResourceOwned=!existing;const child=this.tableResourceController=existing??new EditingController(target.view,{identity:()=>({...this.controller.identity,readOnly:!!this.controller.identity.readOnly||target.view.state.readOnly||!target.current()})});
    const session=child.begin('selection',target.range);this.tableResourceToken=session.token;this.tableResourceComplete=target.complete;
    this.startPanel('Attachments',child);this.endPanel();const task=this.task=new ResourceTask(child,session.token,prepared,this.host,{current:target.current});
    target.cancelWith(()=>{task.cancel();child.cancel(session.token);});
    this.stopTask=task.subscribe(state=>{if(task===this.task)this.message(state.error??state.status);});
    const complete=()=>{if(!this.alive||task!==this.task)return;target.complete();this.close();};
    const result=await task.run();if(!this.alive||task!==this.task)return;
    if(result.ok){complete();return;}
    this.message(result.reason);this.footer.prepend(this.button('Retry',async()=>{const retried=await task.run();if(retried.ok)complete();else this.message(retried.reason);}));
  }
  private panelKey=(event:KeyboardEvent)=>{
    if(event.isComposing||event.keyCode===229||this.composing||this.panel.hidden)return;
    if(event.key==="Escape"){event.preventDefault();event.stopPropagation();if(this.closeNotice)this.keepDraft();else this.requestClose();return;}
    if(event.key==="Enter"&&(event.metaKey||event.ctrlKey)){
      const complete=this.closeNotice?.querySelector<HTMLButtonElement>('[data-label="Complete and continue"]')??this.apply;
      if(complete){event.preventDefault();event.stopPropagation();if(!complete.disabled)complete.click();}return;
    }
    if(event.key==="Tab"){
      const scope=this.closeNotice??this.panel;
      const controls=[...scope.querySelectorAll<HTMLElement>(':is(button,input,textarea,select,summary,[tabindex="0"]):not(:disabled)')].filter(el=>!el.closest('[hidden],[inert]')&&![...scope.querySelectorAll('details:not([open])')].some(detail=>detail.contains(el)&&detail.firstElementChild!==el));
      const first=controls[0],last=controls.at(-1);
      if(this.closeNotice&&controls.length){event.preventDefault();const current=controls.indexOf(document.activeElement as HTMLElement);controls[(current+(event.shiftKey?-1:1)+controls.length)%controls.length]?.focus();return;}
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  };
  private clearLeaveGuard(restore=false){
    this.closeNotice?.remove();this.closeNotice=undefined;delete this.panel.dataset.leaveGuard;
    for(const {node,inert} of this.guardInert)node.inert=inert;this.guardInert=[];
    const saved=this.guardReturn;this.guardReturn=undefined;
    if(restore&&saved?.field.isConnected){saved.field.focus({preventScroll:true});if(saved.start!==null&&saved.end!==null)try{saved.field.setSelectionRange(saved.start,saved.end,saved.direction??undefined);}catch{/* Some input types have no text selection. */}}
  }
  private keepDraft(){this.clearLeaveGuard(true);this.cancelLeave();}
  private startPanel(title:string,controller=this.controller){
    const session=controller.session;this.panelOwner=session&&["editing","stale"].includes(session.status)?{controller,token:session.token,identity:controller.identity}:undefined;
    if(this.leavePending)this.cancelLeave();
    this.panelEpoch++;this.previewEpoch++;this.syntaxEpoch++;this.syntaxState='idle';this.syntaxError=undefined;clearTimeout(this.previewTimer);
    if(this.panel.hidden)this.returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;
    this.panelCleanup?.();this.panelCleanup=undefined;this.clearLeaveGuard();this.lastDraftField=undefined;
    if(!this.modalRoot){let node=this.host.modalRoot??this.controller.view.dom;if(node.contains(this.element))node=this.controller.view.contentDOM;this.modalRoot={node,inert:!!node.inert};node.inert=true;}
    if(!this.modalToolbar){const node=this.element.querySelector<HTMLElement>(".tegg-editing-toolbar");if(node){this.modalToolbar={node,inert:!!node.inert};node.inert=true;}}
    this.panelPurpose='object';this.panel.replaceChildren();this.panel.hidden=false;this.panel.setAttribute("aria-modal","true");this.panel.setAttribute("role","dialog");setUILabel(this.panel,title);this.apply=undefined;this.textarea=undefined;this.message("");
    delete this.panel.dataset.kind;delete this.panel.dataset.layout;delete this.panel.dataset.validation;this.closeNotice=undefined;
    this.content=document.createElement("div");this.content.className="tegg-editing-content";
    this.footer=document.createElement("footer");this.footer.className="tegg-editing-footer";
    const header=document.createElement("header"),heading=document.createElement("h2"),headingText=document.createElement("span");setUIText(headingText,title);heading.append(headingText);
    header.append(heading);
    this.panel.append(header,this.content,this.status,this.footer);
  }
  private requestClose(){
    if(this.composing)return;
    if(this.textarea&&this.textarea.value!==this.initialDraft){
      if(this.closeNotice){this.closeNotice.querySelector<HTMLElement>("button")?.focus();return;}
      const active=document.activeElement,field=(active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement)&&this.content.contains(active)?active:this.lastDraftField;
      if(field)this.guardReturn={field,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection};
      const backdrop=document.createElement("div");backdrop.className="tegg-leave-backdrop";
      const note=document.createElement("div");note.className="tegg-discard-draft";note.setAttribute("role","dialog");note.setAttribute("aria-modal","true");setUILabel(note,"Unsaved changes");
      const text=document.createElement("span");setUIText(text,"Discard these changes?");
      const keep=this.button("Keep editing",()=>this.keepDraft());
      const discard=this.button("Discard changes",()=>{const pending=this.leavePending;this.resolvingLeave=true;try{this.close();}finally{this.resolvingLeave=false;}if(pending)this.element.dispatchEvent(new CustomEvent('tegg-editing-leave-resolved',{bubbles:true,detail:{choice:'discard'}}));});
      const complete=this.button("Complete and continue",()=>{const pending=this.leavePending;this.resolvingLeave=true;try{this.apply?.click();}finally{this.resolvingLeave=false;}if(pending&&this.panel.hidden)this.element.dispatchEvent(new CustomEvent('tegg-editing-leave-resolved',{bubbles:true,detail:{choice:'complete'}}));});complete.dataset.mutation="true";
      note.append(text,keep,discard,complete);backdrop.append(note);
      for(const node of [this.content,this.footer,this.panel.querySelector<HTMLElement>('header')!]){this.guardInert.push({node,inert:node.inert});node.inert=true;}
      this.closeNotice=backdrop;this.panel.dataset.leaveGuard="true";this.panel.append(backdrop);this.sync();keep.focus();return;
    }
    this.close();
  }
  private endPanel(){
    const header=this.panel.querySelector("header")!;
    const copies=[...this.content.querySelectorAll<HTMLButtonElement>(":scope > button")].filter(button=>button.dataset.label?.startsWith("Copy"));
    const ordinary=[...this.content.querySelectorAll<HTMLButtonElement>(":scope > button")].filter(button=>!copies.includes(button)&&button.dataset.label!=="Replace image"&&button!==this.apply);
    this.footer.append(...ordinary);
    if(copies.length){
      if(this.panel.dataset.kind==="image"){
        const target=this.content.querySelector<HTMLInputElement>('input[data-image-address]');
        const group=document.createElement("div");group.className="tegg-image-address";if(target){target.replaceWith(group);group.append(target,...copies);}else this.content.append(...copies);
      }else{
        const menu=document.createElement("details");menu.className="tegg-editing-more";
        const summary=document.createElement("summary");setUILabel(summary,"More actions");const icon=objectIcon(this.button("More actions",()=>{}),"more");summary.append(...icon.childNodes);menu.append(summary,...copies);
        menu.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();menu.open=false;summary.focus();}});
        if(this.mobile)this.content.prepend(menu);else header.append(menu);
      }
    }
    const cancel=this.button("Cancel",()=>this.close());
    if(this.apply)this.apply.classList.add("tegg-primary-action");
    if(this.mobile){header.prepend(cancel);if(this.apply)header.append(this.apply);}else{this.footer.append(cancel);if(this.apply)this.footer.append(this.apply);}
    this.initialDraft=this.textarea?.value??"";
    const epoch=this.panelEpoch;this.sync();queueMicrotask(()=>{if(this.alive&&!this.panel.hidden&&epoch===this.panelEpoch){
      const controls=[...this.content.querySelectorAll<HTMLElement>('input:not(:disabled),textarea:not(:disabled),button:not(:disabled)')];
      (controls.find(el=>!el.closest('[hidden],details:not([open])'))??cancel).focus({preventScroll:true});
    }});
  }
  private watchObjectWorkspace(body?:HTMLTextAreaElement){
    let assigned="",manual=false,alive=true,frame=0;const epoch=this.panelEpoch;
    const update=()=>{if(!alive||epoch!==this.panelEpoch||this.panel.hidden)return;if(!(this.mobile&&innerWidth<600)){const surface=allocatedEditingSurface(this.controller.view.dom),available=surface.width,preferred=this.panel.dataset.kind==="link"?440:["image","mermaid","graphviz"].includes(this.panel.dataset.kind??"")?840:560,width=Math.max(0,Math.min(preferred,available-32));this.panel.style.width=width+"px";this.panel.style.left=Math.max(16,surface.left+(available-width)/2)+"px";this.panel.style.right="auto";this.panel.style.marginInline="0";}else{for(const property of ["width","left","right","margin-inline"])this.panel.style.removeProperty(property);}const diagram=["image","mermaid","graphviz"].includes(this.panel.dataset.kind??"");this.panel.dataset.columns=diagram&&this.content.clientWidth-32>=600&&!this.mobile?"2":"1";
      if(body){if(assigned&&body.style.height!==assigned)manual=true;if(!manual){const line=parseFloat(getComputedStyle(body).lineHeight)||19.5,min=this.panel.dataset.kind==="math"?80:144;assigned=Math.min(260,Math.max(min,(body.value.split('\n').length+1)*line+18))+"px";body.style.height=assigned;}}
    };
    const schedule=()=>{if(!alive||frame)return;frame=requestAnimationFrame(()=>{frame=0;update();});};
    const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(schedule):undefined;observer?.observe(this.content);for(const owner of allocatedEditingSurface(this.controller.view.dom).owners)observer?.observe(owner);if(body){body.addEventListener("input",update);observer?.observe(body);}window.addEventListener("resize",update);schedule();
    this.panelCleanup=()=>{alive=false;observer?.disconnect();if(frame)cancelAnimationFrame(frame);frame=0;window.removeEventListener("resize",update);body?.removeEventListener("input",update);};
  }
  close(restoreFocus=true){if(this.resolvingLeave)this.leavePending=false;else this.cancelLeave();this.clearLeaveGuard();const wasOpen=!this.panel.hidden;this.panelEpoch++;this.previewEpoch++;this.syntaxEpoch++;this.syntaxState='idle';this.syntaxError=undefined;clearTimeout(this.previewTimer);this.extensions.cancel();this.picker?.abort();this.filePicker?.remove();this.filePicker=undefined;this.stopTask?.();this.stopTask=undefined;this.task?.destroy();this.task=undefined;this.clearTableResource();const session=this.controller.session;if(session&&["editing","stale"].includes(session.status))this.controller.cancel(session.token);this.panelCleanup?.();this.panelCleanup=undefined;if(this.modalRoot){this.modalRoot.node.inert=this.modalRoot.inert;this.modalRoot=undefined;}if(this.modalToolbar){this.modalToolbar.node.inert=this.modalToolbar.inert;this.modalToolbar=undefined;}this.panel.hidden=true;this.panelPurpose=null;this.panelOwner=undefined;this.element.append(this.status);this.panel.replaceChildren();this.apply=undefined;this.textarea=undefined;if(restoreFocus&&wasOpen){if(this.returnFocus?.isConnected)this.returnFocus.focus();else this.controller.view.focus();}}
  async openExtension(id:string){
    if(!this.alive)throw new Error("destroyed");
    const extension=this.extensions.list().find(item=>item.id===id);if(!extension?.enabled)throw new Error(extension?.reason??"unknown-extension");
    const session=this.controller.begin();this.startPanel("Review extension draft");const epoch=this.panelEpoch;
    const raw=this.textarea=literalControl(document.createElement("textarea"));raw.rows=10;raw.readOnly=true;raw.value=session.draft;this.content.append(this.label("Object Markdown",raw),this.button("Copy draft",()=>this.copy(raw.value)));this.endPanel();this.message("Preparing draft…");
    const prepared=await this.extensions.prepare(id,session.token);
    if(!this.alive||epoch!==this.panelEpoch)return;
    if(prepared.status!=="ready"){this.message(prepared.reason);return;}
    raw.readOnly=false;raw.value=prepared.draft;this.controller.updateDraft(session.token,raw.value);
    raw.addEventListener("input",()=>{this.controller.updateDraft(session.token,raw.value);});
    this.apply=this.button("Done",()=>{const result=this.extensions.commit(prepared,raw.value);if(!result.ok)throw new Error(result.reason);this.close();});this.apply.dataset.mutation="true";this.apply.dataset.label="Apply";this.apply.classList.add("tegg-primary-action");
    if(this.mobile)this.panel.querySelector("header")!.append(this.apply);else this.footer.append(this.apply);
    this.watchObjectWorkspace(raw);this.sync();this.message("Review the draft before applying.");raw.focus();
  }
  openObject(kind?:ObjectKind,range?:SourceRange,position?:number,create=false){
    if(!this.alive)throw new Error("destroyed");const reason=this.controller.unavailableReason;if(reason)throw new Error(reason);
    if(routeFootnoteCommand(this.controller.view,kind??'edit-object'))return;
    // A focused preview owns implicit table commands. An explicit parent range
    // still belongs to the controller, while a live cell draft keeps its scope.
    if(tableWidgetOwnsFocus(this.controller.view)&&(range===undefined||focusedTableCell(this.controller.view))) {if(focusedTableCell(this.controller.view)&&kind==="link")executeFocusedTableCommand(this.controller.view,"link");return;}
    if(position!==undefined&&(!Number.isInteger(position)||position<0||position>this.controller.view.state.doc.length))throw new Error("invalid-object-target");
    if(position!==undefined&&!range)this.controller.view.dispatch({selection:{anchor:Math.min(this.controller.view.state.doc.length,position+1)}});
    if(kind==="code"&&!range&&this.controller.identity.mode!=="source"){
      const object=objectAt(this.controller.view.state,this.controller.view.state.selection.main.head,this.controller.identity.profile);
      if(!object||object.kind!=="code"){
        if(this.controller.command("codeBlock")){
          const view=this.controller.view, doc=view.state.doc, anchor=view.state.selection.main.anchor, identity=this.controller.identity;
          requestAnimationFrame(()=>{if(this.alive&&view.dom.isConnected&&view.state.doc===doc&&
            view.state.selection.main.anchor===anchor&&sameEditingIdentity(identity,this.controller.identity))
            focusCodeAtSelection(view);});
        }
        return;
      }
    }
    const session=this.controller.begin(kind,range);
    const title=({math:"Edit formula",mermaid:"Edit diagram",graphviz:"Edit diagram",code:"Edit code",image:"Edit image",link:"Edit link"} as Partial<Record<ObjectKind,string>>)[session.kind]??"Edit object";
    this.startPanel(title);this.panel.dataset.kind=session.kind;
    const raw=literalControl(document.createElement("textarea"));raw.rows=4;raw.value=create?this.template(session.kind):session.original||this.template(session.kind);this.textarea=raw;raw.hidden=true;this.content.append(raw);setUILabel(raw,"Object Markdown");
    const parsed=readReferenceObject(session.original,session.kind==="image");
    if((session.kind==="link"||session.kind==="image")&&(!session.original||parsed)){
      const label=this.input(session.kind==="image"?"Alternative text":"Text",parsed?.label??"");const url=this.input("Target",parsed?.url??""),title=this.input("Title",parsed?.title??"");if(session.kind==="image")url.dataset.imageAddress="true";else{const details=document.createElement("details"),summary=document.createElement("summary");setUIText(summary,"Description (optional)");const titleLabel=title.closest("label")!;titleLabel.classList.add("tegg-link-description");details.open=!!parsed?.title;details.append(summary,titleLabel);this.content.append(details);}
      const update=(event:Event)=>{try{
        const current=readReferenceObject(raw.value,session.kind==="image");if(raw.value&&!current)throw new Error("Use the source draft for this link.");
        // Text inputs normalize newlines. Read untouched fields from the current source draft.
        const fields=current??{label:"",url:"",title:undefined};
        if(event.currentTarget===label){if(label.readOnly)throw new Error("Edit rich display text in the document to preserve its formatting.");fields.label=label.value;}
        else if(event.currentTarget===url)fields.url=url.value;
        else if(event.currentTarget===title)fields.title=title.value===""&&fields.title===undefined?undefined:title.value;
        const original=raw.value||undefined;
        raw.value=current?.html?serializeReferenceObject(fields as ReturnType<typeof readReferenceObject>&{},session.kind==="image",raw.value):session.kind==="image"?serializeImageReference(fields.url,fields.label,fields.title,original):serializeLinkDraft(fields,original);
        this.controller.updateDraft(session.token,raw.value);if(this.apply)this.apply.disabled=false;this.message("");raw.dispatchEvent(new Event("input"));
      }catch(error){if(this.apply)this.apply.disabled=true;this.message((error as Error).message);}};
      for(const input of [label,url,title])input.addEventListener("input",update);
      raw.addEventListener("input",()=>{const fields=readReferenceObject(raw.value,session.kind==="image");for(const input of [label,url,title])input.disabled=!fields;if(fields){label.value=fields.label;url.value=fields.url;title.value=fields.title??"";}});
      if(parsed?.richLabel||parsed?.html&&session.kind==="link"){label.readOnly=true;setUILabel(label,'Display text (read-only)');const preview=document.createElement('div');preview.className='md-link-label-preview';const template=document.createElement('template');template.innerHTML=sanitizeRenderedHtml(parsed.html?session.original:parserFor('gfm').renderInline(session.original));preview.append(...Array.from(template.content.firstElementChild?.childNodes??[]));const note=document.createElement('p');note.className='md-link-label-note';setUIText(note,'Edit this display text in the document to preserve its formatting.');this.content.prepend(preview,note);}
      if(session.kind==="image"&&parsed?.html){for(const dimension of ['width','height'] as const){if(parsed[dimension]===undefined)continue;const size=this.input(dimension==='width'?'Width':'Height',parsed[dimension]);size.addEventListener('input',()=>{try{const current=readReferenceObject(raw.value,true);if(!current)throw new Error('This image source changed.');raw.value=serializeReferenceObject({...current,[dimension]:size.value},true,raw.value);raw.dispatchEvent(new Event('input'));this.message('');if(this.apply)this.apply.disabled=false;}catch(error){if(this.apply)this.apply.disabled=true;this.message((error as Error).message);}});raw.addEventListener('input',()=>{const next=readReferenceObject(raw.value,true);size.disabled=next?.[dimension]===undefined;if(next?.[dimension]!==undefined)size.value=next[dimension]!;});}}
      if(session.kind==="image"){
        title.closest("label")!.classList.add("tegg-image-title");
        this.content.append(this.button("Replace image",()=>this.chooseResource(session)));
      }
    }
    let projection=technicalDraft(session.kind,raw.value);let technicalBody:HTMLTextAreaElement|undefined;
    if(projection){
      const body=literalControl(document.createElement("textarea"));body.rows=session.kind==="math"?3:8;body.value=projection.body;setUILabel(body,projection.label);
      technicalBody=body;body.className="tegg-object-body";this.content.append(this.label(session.kind==="math"?"Expression":"Code",body));
      const language=document.createElement("span");language.className="tegg-editing-language";language.textContent=session.kind==="math"?"LaTeX":session.kind==="mermaid"?"Mermaid":session.kind==="graphviz"?"Graphviz":"";if(language.textContent)this.panel.querySelector("h2")!.append(language);
      let writing=false;
      body.addEventListener("input",()=>{if(!projection)return;writing=true;raw.value=projection.serialize(body.value);raw.dispatchEvent(new Event("input"));writing=false;});
      raw.addEventListener("input",()=>{projection=technicalDraft(session.kind,raw.value);body.disabled=!projection;if(projection&&!writing)body.value=projection.body;});
    }else if(!parsed){raw.hidden=false;this.content.append(this.label("Object Markdown",raw));}
    const preview=document.createElement("div");preview.className="tegg-object-preview";setUILabel(preview,"Draft preview");
    if(session.kind!=="link"){
      this.panel.dataset.layout=(session.kind==="mermaid"||session.kind==="graphviz")?"split":"stack";
      const sourcePane=document.createElement("section"),previewPane=document.createElement("section");
      sourcePane.className="tegg-source-pane";previewPane.className="tegg-preview-pane";
      const sourceHeading=document.createElement("h3"),previewHeading=document.createElement("h3");
      setUIText(previewHeading,"Preview");
      sourcePane.append(...Array.from(this.content.childNodes));previewPane.append(previewHeading,preview);
      this.content.append(sourcePane,previewPane);
    }
    raw.addEventListener("input",()=>{this.controller.updateDraft(session.token,raw.value);this.validateSyntax(session.kind,raw.value,technicalBody??raw,preview);this.schedulePreview(session.kind,raw.value,preview);});
    this.controller.updateDraft(session.token,raw.value);
    this.apply=this.button("Done",()=>{
      if(session.kind==="metadata"){const body=raw.value.replace(/^---\n/,"").replace(/\n---\s*$/,"");const parsed=parseDocument(body);if(parsed.errors.length)throw new Error(parsed.errors[0].message);}
      const result=this.controller.commit(session.token,raw.value);if(!result.ok)throw new Error(result.reason);this.close();
    });
    this.apply.dataset.mutation="true";this.apply.dataset.label="Apply";
    this.content.append(this.apply,this.button(session.kind==="image"?"Copy image address":projection?(session.kind==="math"?"Copy expression":"Copy code"):"Copy draft",()=>this.copy(session.kind==="image"?(readReferenceObject(raw.value,true)?.url??""):technicalBody?.value??raw.value)));this.endPanel();this.watchObjectWorkspace(technicalBody);this.validateSyntax(session.kind,raw.value,technicalBody??raw,preview);this.schedulePreview(session.kind,raw.value,preview);
  }
  private template(kind:ObjectKind){return ({link:"[text](https://)",image:"![description](assets/image.png)",code:"```text\n\n```",math:"$$\n\n$$",mermaid:"```mermaid\nflowchart TD\n  A --> B\n```",graphviz:"```graphviz\ndigraph { a -> b }\n```",footnote:"[^note]: ",callout:"> [!note]\n> ",metadata:"---\ntitle: \n---\n",table:"| A | B |\n| --- | --- |\n|  |  |",selection:""})[kind];}
  private mathDisplay(source:string):'inline'|'block' {
    if(source.startsWith('<')){const template=document.createElement('template');template.innerHTML=source;return template.content.firstElementChild?.getAttribute('data-tegg-math')==='block'?'block':'inline';}
    return source.trim().startsWith('$$')?'block':'inline';
  }
  private validateSyntax(kind:ObjectKind,source:string,field:HTMLTextAreaElement,target:HTMLElement){
    const epoch=++this.syntaxEpoch;this.syntaxError?.remove();this.syntaxError=undefined;field.removeAttribute('aria-invalid');this.syntaxState='idle';
    if(kind!=='math'&&kind!=='mermaid'&&kind!=='graphviz'){this.sync();return;}
    const projection=technicalDraft(kind,source),engines=enginesFor(this.controller.view.dom);
    if(!projection||!engines[kind]?.validate){this.sync();return;}
    const panelEpoch=this.panelEpoch,token=this.controller.session?.token,doc=this.controller.view.state.doc,identity=this.controller.identity;
    const current=()=>this.alive&&!this.panel.hidden&&epoch===this.syntaxEpoch&&panelEpoch===this.panelEpoch&&
      token===this.controller.session?.token&&this.textarea?.value===source&&doc===this.controller.view.state.doc&&sameEditingIdentity(identity,this.controller.identity);
    this.syntaxState='pending';this.panel.dataset.validation='pending';this.sync();
    const complete=(outcome:TechnicalValidationOutcome)=>{if(!current()||outcome.status==='stale')return;
      this.syntaxState=outcome.status==='invalid'?'invalid':'idle';this.panel.dataset.validation=outcome.status;
      if(outcome.status==='invalid'){
        const error=document.createElement('p');error.className='tegg-technical-error';error.setAttribute('role','alert');error.textContent=outcome.message;
        field.setAttribute('aria-invalid','true');field.closest('label')?.after(error);this.syntaxError=error;
      }this.sync();
    };
    if(source.length>editingBudgets.draftPreviewUnits||kind!=='math'&&(source.length>editingBudgets.diagramDraftUnits||source.split('\n').length>editingBudgets.diagramDraftLines)){
      complete({status:'unavailable',reason:'budget',message:'Draft is too large for automatic preview. Source is retained.'});return;
    }
    void validateTechnicalDraft(kind,projection.body,engines,target,current,this.mathDisplay(source)).then(complete);
  }
  private schedulePreview(kind:ObjectKind,source:string,target:HTMLElement){
    clearTimeout(this.previewTimer);const epoch=++this.previewEpoch;target.replaceChildren();
    this.previewTimer=setTimeout(()=>{void this.preview(kind,source,target,epoch).catch(error=>{
      if(epoch!==this.previewEpoch)return;
      const message=target.querySelector(".tegg-preview-error")??document.createElement("p");message.className="tegg-preview-error";message.setAttribute("role","status");
      message.textContent=(error as Error).message;target.append(message);
    });},250);
  }
  private async preview(kind:ObjectKind,source:string,target:HTMLElement,epoch:number){
    if(epoch!==this.previewEpoch||!this.alive)return;
    // Bound synchronous engines before invocation: cancellation must stay responsive.
    const tooLarge=source.length>editingBudgets.draftPreviewUnits||((kind==="mermaid"||kind==="graphviz")&&(source.length>editingBudgets.diagramDraftUnits||source.split('\n').length>editingBudgets.diagramDraftLines));
    if(tooLarge){setUIText(target,"Draft is too large for automatic preview. Source is retained.");return;}
    delete target.dataset.teggUiText;
    const engines=enginesFor(this.controller.view.dom),current=()=>this.alive&&epoch===this.previewEpoch&&target.isConnected;
    const body=technicalDraft(kind,source)?.body??source;
    let html:string;
    if(kind==="math"&&engines.math){
      // Use the same trusted engine path as the document; the Markdown HTML
      // sanitizer strips KaTeX's required positioning styles from matrices.
      target.dataset.enhancements="false";
      const unbind=bindEngines(target,engines);
      try{renderMathInto(target,{kind:"math",source:body,display:this.mathDisplay(source)});}finally{unbind();}
      return;
    }
    else if((kind==="mermaid"||kind==="graphviz")&&engines[kind])html=await engines[kind]!(body,target,current);
    else {const context=this.controller.view.state.facet(resourceContext);html=parserFor(this.controller.identity.profile).render(source);if(current()){
      target.innerHTML=sanitizeRenderedHtml(html,context.documentPath,context.resolveImage);
      for(const image of target.querySelectorAll("img")){const figure=document.createElement("figure");const caption=document.createElement("figcaption");image.replaceWith(figure);figure.append(image,caption);}
      enhanceFigures(target);
    }return;}
    if(current()){
      if(kind==="mermaid"||kind==="graphviz")target.replaceChildren(sanitizeDiagramSvg(html));
      else target.innerHTML=sanitizeRenderedHtml(html);
    }
  }
  private async copy(text:string){
    if(!this.alive||this.composing||this.controller.view.composing||this.panel.hidden)return;
    const epoch=++this.copyEpoch,panelEpoch=this.panelEpoch,draftRevision=this.copyDraftRevision,
      sessionToken=this.controller.session?.token,doc=this.controller.view.state.doc,identity=this.controller.identity;
    const current=()=>this.alive&&!this.panel.hidden&&epoch===this.copyEpoch&&panelEpoch===this.panelEpoch&&
      draftRevision===this.copyDraftRevision&&sessionToken===this.controller.session?.token&&
      doc===this.controller.view.state.doc&&sameEditingIdentity(identity,this.controller.identity)&&
      !this.composing&&!this.controller.view.composing;
    try{if(this.host.copyText)await this.host.copyText(text);else await navigator.clipboard.writeText(text);
      if(current())this.message("Copied");
    }catch(error){if(current())this.error(error);}
  }
  /** Readonly inventory uses the same real leave boundary; a rejected attempt is never replayed. */
  openInspection(options:{projection?:'reader'|'live'|'source'}={}):boolean {
    if(!this.alive||this.controller.unavailableReason==='destroyed')return false;
    if(this.isComposing){this.cancelLeave();cancelIndependentEditingLeave(this.controller.view);return false;}
    if(this.inspectionElement){this.content.querySelector<HTMLInputElement>('input')?.focus();return true;}
    if(!prepareEditingLeave(this.controller.view,this.element,this.controller))return false;
    const source=this.host.source?.()??this.controller.view.state.sliceDoc(),identity=this.controller.identity,doc=this.controller.view.state.doc,
      model=inspectDocument(source,identity.profile??'tegg'),session=displaySessionFor(this.controller.view),projection=options.projection??identity.mode??'live';
    const current=()=>this.alive&&this.panelPurpose==='inspection'&&!this.panel.hidden&&this.controller.view.state.doc===doc&&(this.host.source?.()??this.controller.view.state.sliceDoc())===source&&sameEditingIdentity(identity,this.controller.identity);
    this.startPanel('Document inspection');this.panelPurpose='inspection';this.panelOwner=undefined;this.panel.dataset.kind='inspection';
    const search=this.input('Search document inspection'),type=document.createElement('select');setUILabel(type,'Inspection type');
    const labels:Record<InspectionKind,string>={'comment':'Comments','shared-definition':'Shared definitions','anchor':'Anchors','unapplied-declaration':'Unapplied declarations'};
    for(const [value,label] of [['','All types'],...Object.entries(labels)]){const option=document.createElement('option');option.value=value;setUIText(option,label);type.append(option);}this.content.append(this.label('Inspection type',type));
    const entries=document.createElement('div');entries.className='tegg-inspection-entries';this.content.append(entries);
    const render=()=>{
      entries.replaceChildren();const items=queryInspection(model,{kind:type.value?(type.value as InspectionKind):undefined,search:search.value});
      if(!items.length){const empty=document.createElement('p');setUIText(empty,'No matching declarations');entries.append(empty);return;}
      for(const entry of items){
        const detail=document.createElement('details'),summary=document.createElement('summary'),label=document.createElement('span'),kind=document.createElement('span');label.textContent=entry.label||entry.raw;setUIText(kind,labels[entry.kind]);kind.className='tegg-inspection-kind';summary.append(kind,label);detail.append(summary);
        const group=document.createElement('div');group.className='tegg-inspection-raw';const raw=document.createElement('pre');raw.textContent=entry.raw;raw.tabIndex=0;setUILabel(raw,'Original declaration');const copy=this.button('Copy',()=>this.copy(entry.raw));group.append(raw,copy);detail.append(group);
        if(entry.reason){const reason=document.createElement('p');reason.textContent=entry.reason;detail.append(reason);}
        if(entry.referenceCount!==undefined){const count=document.createElement('p');setUIText(count,'Referenced {value} times',{value:String(entry.referenceCount)});detail.append(count);}
        let location:ReturnType<typeof inspectionLocation>;try{location=inspectionLocation(model,entry,source,session,{projection});}catch{continue;}
        const locate=this.button('Locate',()=>{
          if(!current())throw new Error('The document changed. Reopen document inspection.');
          const next=inspectionLocation(model,entry,this.host.source?.()??this.controller.view.state.sliceDoc(),session,{projection});expandInspectionLocation(next,session);
          const detail={coordinates:'source' as const,sourceRange:{...entry.sourceRange},ownerRange:{...next.ownerRange},identity:{...identity},expandedCount:next.foldsToExpand.length};this.close(false);this.element.dispatchEvent(new CustomEvent('tegg-inspection-locate',{bubbles:true,detail}));
        });
        if(location.foldsToExpand.length)setUIText(locate,'Locate and expand {value} levels',{value:String(location.foldsToExpand.length)});
        detail.append(locate);entries.append(detail);
      }
    };
    search.addEventListener('input',render);type.addEventListener('change',render);render();
    const close=this.button('Close',()=>this.close());if(this.mobile)this.panel.querySelector('header')!.prepend(close);else this.footer.append(close);
    this.initialDraft='';const epoch=this.panelEpoch;queueMicrotask(()=>{if(this.alive&&epoch===this.panelEpoch&&!this.panel.hidden)search.focus({preventScroll:true});});this.watchObjectWorkspace();return true;
  }
  openSearch(){
    if(!this.alive)throw new Error("destroyed");if(this.controller.view.composing)throw new Error("composing");
    const session=this.controller.session;if(session&&["editing","stale"].includes(session.status))throw new Error("Finish or cancel the current object draft first");
    this.startPanel("Find and replace");this.panelPurpose='search';const query=this.input("Find"),replacement=this.input("Replace with");
    const sensitive=this.input("Match case","","checkbox"),word=this.input("Whole word","","checkbox"),selected=this.input("In selection","","checkbox");
    let rangeDoc=this.controller.view.state.doc;const identity=this.controller.identity;
    const range={from:this.controller.view.state.selection.main.from,to:this.controller.view.state.selection.main.to};selected.disabled=range.from===range.to;
    const options=():FindOptions=>({caseSensitive:sensitive.checked,wholeWord:word.checked,...(selected.checked?{range}: {})});
    const guard=()=>{if(!sameEditingIdentity(identity,this.controller.identity))throw new Error("The document changed. Reopen search.");if(this.controller.view.composing)throw new Error("composing");if(selected.checked&&this.controller.view.state.doc!==rangeDoc)throw new Error("The search selection changed. Reopen search.");};
    const context=document.createElement("pre");context.setAttribute("role","region");setUILabel(context,"Match source context");this.content.append(context);
    const replace=(all:boolean)=>{guard();const oldLength=this.controller.view.state.doc.length;const result=this.controller.replace(query.value,replacement.value,{...options(),all});if(!result.ok)throw new Error(result.reason);if(selected.checked)range.to+=this.controller.view.state.doc.length-oldLength;rangeDoc=this.controller.view.state.doc;this.message(result.changed?"Replaced":"No matches");};
    const find=(backward:boolean)=>{guard();const found=this.controller.find(query.value,options()),selection=this.controller.view.state.selection.main;const next=backward?[...found].reverse().find(item=>item.to<=selection.from)??found.at(-1):found.find(item=>item.from>=selection.to)??found[0];if(next){this.controller.view.dispatch({selection:{anchor:next.from,head:next.to},scrollIntoView:true});context.textContent=this.controller.view.state.doc.sliceString(Math.max(0,next.from-80),Math.min(this.controller.view.state.doc.length,next.to+80));this.message(String(found.length)+" matches");}else{context.textContent="";this.message("No matches");}};
    const once=this.button("Replace",()=>replace(false)),all=this.button("Replace all",()=>replace(true));once.dataset.mutation=all.dataset.mutation="true";
    this.content.append(this.button("Find next",()=>find(false)),this.button("Find previous",()=>find(true)),once,all);this.endPanel();
  }
  async paste(input:ClipboardInput,range?:SourceRange){
    if(!hasClipboardPayload(input))return;
    let node=syntaxTree(this.controller.view.state).resolveInner(range?.from??this.controller.view.state.selection.main.from,1),code=false;
    for(;;){if(["FencedCode","CodeBlock","InlineCode"].includes(node.name)){code=true;break;}if(!node.parent)break;node=node.parent;}
    const prepared=preparePaste(input,{target:code?"code":"document",documentSource:this.controller.view.state.doc.toString()});const session=this.controller.begin("selection",range??this.controller.view.state.selection.main);
    if(prepared.status!=="ready"){
      this.startPanel("Review paste");const original=literalControl(document.createElement("textarea"));original.readOnly=true;original.value=prepared.plainText||input.html||input.markdown||"";this.content.append(this.label("Original input",original));
      const preview=document.createElement("pre");preview.textContent=prepared.markdown;this.content.append(preview);
      const issues=document.createElement("p");issues.textContent=prepared.issues.map(item=>item.message).join('\n');this.content.append(issues);
      if(prepared.status!=="rejected")this.content.append(this.button("Insert converted Markdown",()=>this.applyPaste(session,preparePaste(input,{acceptSimplification:true,documentSource:this.controller.view.state.doc.toString()}))));
      this.content.append(this.button("Paste plain text",()=>this.applyPaste(session,preparePaste(input,{plainText:true}))),this.button("Copy original",()=>this.copy(original.value)));this.endPanel();return;
    }
    await this.applyPaste(session,prepared);
  }
  private async applyPaste(session:EditSession,prepared:PastePreparation,stageOnly=false){
    if(!this.alive)return;const valid=this.controller.validateSession(session.token);if(!valid.ok)throw new Error(valid.reason);
    if(prepared.resources.length&&!stageOnly){this.startPanel("Attachments");this.endPanel();}
    this.stopTask?.();this.task?.destroy();const task=this.task=new ResourceTask(this.controller,session.token,prepared,this.host,{commit:!stageOnly});
    this.stopTask=task.subscribe(state=>{if(task===this.task)this.message(state.error??(state.status==="storing"?(state.indeterminate?"Preparing attachments…":String(Math.round(state.progress*100))+"%"):state.status));});
    const result=await task.run();if(!this.alive||task!==this.task||this.controller.session?.status==="cancelled")return;
    const complete=()=>{if(stageOnly&&this.textarea){this.textarea.value=this.controller.session?.draft??"";this.textarea.dispatchEvent(new Event("input"));this.message("Attachment ready. Apply to update the document.");}else this.close();};
    if(result.ok){complete();return;}
    if(this.panel.hidden)this.startPanel("Attachments");
    this.message(result.reason);this.content.append(this.button("Retry",async()=>{const result=await task.run();if(!this.alive||task!==this.task)return;if(result.ok)complete();else this.message(result.reason);}),this.button("Copy original",()=>this.copy(prepared.plainText)));this.endPanel();
  }
  async chooseResource(existing?:EditSession){
    const session=existing??this.controller.begin("image",this.controller.view.state.selection.main);
    const valid=this.controller.validateSession(session.token);if(!valid.ok)throw new Error(valid.reason);
    if(this.host.chooseResource){
      this.picker?.abort();const picker=this.picker=new AbortController();
      const signal=this.controller.signalForSession(session.token),abort=()=>picker.abort();signal?.addEventListener("abort",abort,{once:true});
      try{
        const result=await this.host.chooseResource({...this.controller.identity,sessionToken:session.token,signal:picker.signal});
        if(!this.alive||picker!==this.picker||picker.signal.aborted)return;
        if(!result){if(!existing)this.controller.cancel(session.token);return;}
        const current=this.controller.validateSession(session.token);if(!current.ok)throw new Error(current.reason);
        assertPersistentReference(result.reference);
        if(existing&&result.kind==="file")throw new Error("Select an image when replacing an image.");
        const original=existing?this.controller.session?.draft:undefined,fields=original?readReferenceObject(original,true):null;
        if(existing&&original&&!fields)throw new Error("Use the source draft for this image.");
        const next=result.kind==="file"?serializeLinkDraft({label:result.alt??"Attachment",url:result.reference,title:result.title}):fields?.html&&original?serializeReferenceObject({...fields,url:result.reference},true,original):serializeImageReference(result.reference,fields?.label??result.alt??"",fields?fields.title:result.title,original);
        if(existing){const updated=this.controller.updateDraft(session.token,next);if(!updated.ok)throw new Error(updated.reason);if(this.textarea){this.textarea.value=next;this.textarea.dispatchEvent(new Event("input"));}this.message("Attachment ready. Apply to update the document.");}
        else{const applied=this.controller.commit(session.token,next);if(!applied.ok)throw new Error(applied.reason);this.close();}
      }catch(error){if(!picker.signal.aborted&&this.alive){this.error(error);if(!existing&&this.controller.session?.token===session.token)this.controller.cancel(session.token);}}
      finally{signal?.removeEventListener("abort",abort);if(this.picker===picker)this.picker=undefined;}return;
    }
    this.filePicker?.remove();const picker=this.filePicker=document.createElement("input");picker.type="file";picker.multiple=!existing;picker.hidden=true;if(existing)picker.accept="image/*";this.element.append(picker);
    picker.addEventListener("cancel",()=>{picker.remove();if(!existing)this.controller.cancel(session.token);},{once:true});
    picker.addEventListener("change",()=>{const files=Array.from(picker.files??[]);picker.remove();if(!this.alive||this.filePicker!==picker)return;this.filePicker=undefined;if(!files.length){if(!existing)this.controller.cancel(session.token);return;}this.safe(async()=>{const input={files:files.map((file,i)=>({id:String(i),name:file.name,type:file.type,size:file.size,blob:file}))};const prepared=preparePaste(input);if(existing){const fields=readLinkDraft(this.controller.session?.draft??session.original);if(!fields||prepared.resources.length!==1||prepared.resources[0].kind!=="image")throw new Error("Select one image to replace the current image.");prepared.resources[0].alt=fields.label;prepared.resources[0].title=fields.title;}await this.applyPaste(session,prepared,!!existing);});},{once:true});picker.click();
  }
  destroy(){if(!this.alive)return;this.close(false);this.extensions.dispose();this.uiBinding.destroy();this.alive=false;this.stop();this.controller.view.dom.removeEventListener("keydown",this.editorKey);this.controller.view.dom.removeEventListener('tegg-editing-leave-resolved',this.forwardLeave);this.controller.view.dom.removeEventListener('tegg-editing-leave-cancelled',this.forwardLeave);this.controller.view.dom.removeEventListener("tegg-editing-preflight",this.preflight);this.controller.view.dom.removeEventListener("tegg-editing-leave-request",this.leaveRequest);this.controller.view.dom.removeEventListener("tegg-edit-object",this.objectEvent);this.controller.view.dom.removeEventListener("tegg-table-resource-paste",this.tablePaste);this.controller.view.dom.removeEventListener("tegg-toolbar-state",this.tableFocusChanged);this.controller.view.dom.removeEventListener("focusin",this.tableFocusChanged);this.controller.view.dom.removeEventListener("focusout",this.tableFocusChanged);this.element.removeEventListener("keydown",this.panelKey);this.panel.removeEventListener("pointerdown",this.compositionPointer,true);this.panel.removeEventListener("mousedown",this.compositionPointer,true);this.panel.removeEventListener("input",this.copyDraftChanged);this.panel.removeEventListener("focusin",this.fieldFocus);if(this.effects.get(this.controller.view.state)!==undefined)this.controller.view.dispatch({effects:this.effects.reconfigure([])});this.element.remove();instances.delete(this.controller);viewInstances.delete(this.controller.view);}
}
export function attachEditingUI(controller:EditingController,root:HTMLElement,host:EditingUIHost={}){return new EditingUI(controller,root,host);}

/** A projected child editor inherits the actual parent Host callbacks and overlay root. */
export function attachNestedEditingUI(parent:EditorView,child:EditorView,options:NestedEditingOptions={}){const owner=viewInstances.get(parent);if(!owner||!owner.element.parentElement)return null;const controller=new EditingController(child,{identity:()=>({...owner.controller.identity,mode:options.literalObject?'source':'live',readOnly:child.state.readOnly||owner.controller.identity.readOnly})});const ui=new EditingUI(controller,owner.element.parentElement,{...owner.host,source:()=>child.state.sliceDoc(),modalRoot:owner.host.modalRoot??owner.controller.view.dom,toolbar:false});let children=nestedInstances.get(parent);if(!children){children=new Set();nestedInstances.set(parent,children);}children.add(ui);return {controller,ui,destroy(){children!.delete(ui);ui.destroy();controller.destroy();}};}
