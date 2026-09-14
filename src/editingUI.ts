import {Compartment, StateEffect} from "@codemirror/state";
import {EditorView} from "@codemirror/view";
import {syntaxTree} from "@codemirror/language";
import {parseDocument} from "yaml";
import {EditingController, sameEditingIdentity, type ObjectKind, type EditSession, type FindOptions} from "./editingController";
import {captureClipboard,preparePaste,type ClipboardInput,type PastePreparation} from "./clipboard";
import {ResourceTask,type ResourceHost,type StoredResource,assertPersistentReference} from "./resourceTasks";
import {readLinkDraft,serializeLinkDraft,serializeImageReference} from "./objectDraft";
import {enginesFor} from "./renderEngines";
import {sanitizeRenderedHtml,sanitizeDiagramSvg} from "./renderKit";
import {parserFor} from "./markdownParser";
import {resourceContext} from "./editorHost";
import {setUIText,setUILabel,bindUI,contextFor,type UIOptions} from "./uiContext";
import type {SourceRange} from "./sourcePatch";
import {editingBudgets} from "./editingBudget";
import {ControlledExtensionRegistry,type ControlledExtension} from "./controlledExtensions";
export type EditingUIHost = ResourceHost & UIOptions & {
  toolbar?:boolean;
  extensions?:readonly ControlledExtension[];
  chooseResource?:(context:{documentId:string;generation:string;sessionToken:string;signal:AbortSignal})=>Promise<StoredResource & {alt?:string;title?:string;kind?:"image"|"file"}|null>;
  copyText?:(text:string)=>void|Promise<void>;
  onError?:(error:unknown)=>void;
};
const instances=new WeakMap<EditingController,EditingUI>();
/** Optional DOM chrome. Document semantics and all mutations stay in the shared controller. */
export class EditingUI {
  readonly element=document.createElement("section");
  private panel=document.createElement("div");
  private status=document.createElement("p");
  private stop:()=>void;
  private effects=new Compartment();
  private task?:ResourceTask;
  private picker?:AbortController;
  private filePicker?:HTMLInputElement;
  private stopTask?:()=>void;
  private panelEpoch=0;
  private previewEpoch=0;
  private previewTimer?:ReturnType<typeof setTimeout>;
  private alive=true;
  private apply?:HTMLButtonElement;
  private textarea?:HTMLTextAreaElement;
  private returnFocus?:HTMLElement;
  private extensions:ControlledExtensionRegistry;
  private uiBinding:ReturnType<typeof bindUI>;
  constructor(readonly controller:EditingController,root:HTMLElement,readonly host:EditingUIHost={}){
    if(instances.has(controller))throw new Error("This controller already has an editing UI");this.extensions=new ControlledExtensionRegistry(controller,host.extensions??[]);instances.set(controller,this);
    this.uiBinding=bindUI(this.element,{...contextFor(controller.view.dom),...(host.locale?{locale:host.locale}:{}),...(host.messages?{messages:host.messages}:{}),...(host.overlayContainer?{overlayContainer:host.overlayContainer}:{})});
    this.element.className="tegg-editing-ui";this.panel.className="tegg-editing-panel";this.panel.hidden=true;
    this.status.setAttribute("role","status");this.status.setAttribute("aria-live","polite");
    if(host.toolbar!==false){
      const bar=document.createElement("div");bar.className="tegg-editing-toolbar";bar.setAttribute("role","toolbar");setUILabel(bar,"Editing tools");
      for(const [label,command] of [["Undo","undo"],["Redo","redo"],["Bold","bold"],["Italic","italic"],["List","list"],["Task list","task"]])bar.append(this.button(label,()=>controller.command(command)));
      for(const [label,kind] of [["Edit object",undefined],["Link","link"],["Image","image"],["Code block","code"],["Formula","math"],["Mermaid","mermaid"],["GraphViz","graphviz"],["Footnote","footnote"],["Callout","callout"],["Metadata · YAML","metadata"]] as const)bar.append(this.button(label,()=>this.openObject(kind)));
      bar.append(this.button("Attach file",()=>this.chooseResource()),this.button("Find and replace",()=>this.openSearch()));
      for(const extension of this.extensions.list()){const button=this.button(extension.label,()=>this.openExtension(extension.id));button.dataset.extension=extension.id;bar.append(button);}
      this.element.append(bar);
    }
    this.element.append(this.panel,this.status);root.append(this.element);
    this.stop=controller.subscribe(session=>{if(!this.alive)return;this.attachToCurrentState();this.sync();if(session?.status==="stale"){this.picker?.abort();this.previewEpoch++;clearTimeout(this.previewTimer);this.message("The document changed. Copy your draft or cancel and reopen this object.");if(this.apply)this.apply.disabled=true;}});
    this.element.addEventListener("keydown",this.panelKey);
    controller.view.dom.addEventListener("keydown",this.editorKey);
    controller.view.dom.addEventListener("tegg-edit-object",this.objectEvent);
    controller.view.dom.addEventListener("tegg-table-resource-paste",this.tablePaste);
    this.attachToCurrentState();this.sync();
  }
  setUI(options:UIOptions){if(this.alive)this.uiBinding.update(options);}
  private safe(run:()=>unknown){try{Promise.resolve(run()).catch(error=>this.error(error));}catch(error){this.error(error);}}
  private button(label:string,run:()=>unknown){const button=document.createElement("button");button.type="button";setUIText(button,label);button.dataset.label=label;button.addEventListener("click",()=>{if(this.alive)this.safe(run);});return button;}
  private label(text:string,control:HTMLElement){const label=document.createElement("label");const span=document.createElement("span");setUIText(span,text);label.append(span,control);return label;}
  private input(label:string,value="",type="text"){const input=document.createElement("input");input.type=type;input.value=value;this.panel.append(this.label(label,input));return input;}
  private message(text:string){if(this.alive)setUIText(this.status,text);}
  private error(error:unknown){if(!this.alive)return;this.message(error instanceof Error?error.message:String(error));try{this.host.onError?.(error);}catch{/* diagnostic observers cannot break UI cleanup */}}
  private sync(){const reason=this.controller.unavailableReason,extensions=this.extensions.list();for(const button of this.element.querySelectorAll<HTMLButtonElement>(".tegg-editing-toolbar button"))button.disabled=button.dataset.extension?!extensions.find(item=>item.id===button.dataset.extension)?.enabled:button.dataset.label==="Find and replace"?reason==="composing"||reason==="destroyed":!!reason;for(const button of this.panel.querySelectorAll<HTMLButtonElement>('button[data-mutation="true"]'))button.disabled=!!reason||this.controller.session?.status==="stale";}
  attachToCurrentState(){
    if(!this.alive||this.controller.unavailableReason==="destroyed")return;
    if(this.effects.get(this.controller.view.state)!==undefined)return;
    this.controller.view.dispatch({effects:StateEffect.appendConfig.of(this.effects.of([
      EditorView.updateListener.of(()=>queueMicrotask(()=>{if(this.alive)this.sync();})),
      EditorView.domEventHandlers({paste:(event,view)=>{
        if(view.composing||view.state.readOnly||this.controller.identity.mode==="reader"||!event.clipboardData)return false;
        const captured=captureClipboard(event.clipboardData);
        if(!captured.html&&!captured.markdown&&!captured.files?.length&&!captured.delimiter&&!captured.text?.includes('\t'))return false;
        event.preventDefault();void this.paste(captured).catch(error=>this.error(error));return true;
      },drop:(event,view)=>{
        if(view.composing||view.state.readOnly||this.controller.identity.mode==="reader"||!event.dataTransfer?.files.length)return false;
        event.preventDefault();const captured=captureClipboard(event.dataTransfer);const position=view.posAtCoords({x:event.clientX,y:event.clientY});
        void this.paste(captured,position===null?undefined:{from:position,to:position}).catch(error=>this.error(error));return true;
      }})
    ]))});
  }
  private editorKey=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="f"&&!event.isComposing&&!this.controller.view.composing){event.preventDefault();event.stopPropagation();this.safe(()=>this.openSearch());}};
  private objectEvent=(event:Event)=>{event.preventDefault();event.stopPropagation();this.safe(()=>{const detail=(event as CustomEvent<{kind?:ObjectKind;from:number;to?:number}>).detail;if(!detail||!Number.isInteger(detail.from))throw new Error("invalid-object-target");this.openObject(detail.kind,detail.to===undefined?undefined:{from:detail.from,to:detail.to},detail.from);});};
  private tablePaste=(event:Event)=>{
    event.preventDefault();event.stopPropagation();
    const detail=(event as CustomEvent<{from:number;to:number;expected:string;prepared:PastePreparation}>).detail;
    try{if(this.controller.view.state.doc.sliceString(detail.from,detail.to)!==detail.expected)throw new Error("The table changed. Paste again.");
      const session=this.controller.begin("table",{from:detail.from,to:detail.to});void this.applyPaste(session,detail.prepared).catch(error=>this.error(error));
    }catch(error){this.error(error);}
  };
  private panelKey=(event:KeyboardEvent)=>{
    if(event.isComposing)return;
    if(event.key==="Escape"){event.preventDefault();this.close();}
    if(event.key==="Tab"&&!this.panel.hidden){const controls=[...this.panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(el=>!el.hidden);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  };
  private startPanel(title:string){
    this.panelEpoch++;this.previewEpoch++;clearTimeout(this.previewTimer);
    if(this.panel.hidden)this.returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;
    this.panel.replaceChildren();this.panel.hidden=false;this.panel.setAttribute("role","dialog");setUILabel(this.panel,title);this.apply=undefined;this.textarea=undefined;this.message("");
    const heading=document.createElement("h2");setUIText(heading,title);this.panel.append(heading);
  }
  private endPanel(){this.panel.append(this.button("Cancel",()=>this.close()));const epoch=this.panelEpoch;this.sync();queueMicrotask(()=>{if(this.alive&&!this.panel.hidden&&epoch===this.panelEpoch)this.panel.querySelector<HTMLElement>('input:not(:disabled),textarea:not(:disabled),button:not(:disabled)')?.focus();});}
  close(restoreFocus=true){const wasOpen=!this.panel.hidden;this.panelEpoch++;this.previewEpoch++;clearTimeout(this.previewTimer);this.extensions.cancel();this.picker?.abort();this.filePicker?.remove();this.filePicker=undefined;this.stopTask?.();this.stopTask=undefined;this.task?.destroy();this.task=undefined;const session=this.controller.session;if(session&&["editing","stale"].includes(session.status))this.controller.cancel(session.token);this.panel.hidden=true;this.panel.replaceChildren();this.apply=undefined;this.textarea=undefined;if(restoreFocus&&wasOpen){if(this.returnFocus?.isConnected)this.returnFocus.focus();else this.controller.view.focus();}}
  async openExtension(id:string){
    if(!this.alive)throw new Error("destroyed");
    const extension=this.extensions.list().find(item=>item.id===id);if(!extension?.enabled)throw new Error(extension?.reason??"unknown-extension");
    const session=this.controller.begin();this.startPanel("Review extension draft");const epoch=this.panelEpoch;
    const raw=this.textarea=document.createElement("textarea");raw.rows=10;raw.readOnly=true;raw.value=session.draft;this.panel.append(this.label("Object Markdown",raw),this.button("Copy draft",()=>this.copy(raw.value)));this.endPanel();this.message("Preparing draft…");
    const prepared=await this.extensions.prepare(id,session.token);
    if(!this.alive||epoch!==this.panelEpoch)return;
    if(prepared.status!=="ready"){this.message(prepared.reason);return;}
    raw.readOnly=false;raw.value=prepared.draft;this.controller.updateDraft(session.token,raw.value);
    raw.addEventListener("input",()=>{this.controller.updateDraft(session.token,raw.value);});
    this.apply=this.button("Apply",()=>{const result=this.extensions.commit(prepared,raw.value);if(!result.ok)throw new Error(result.reason);this.close();});this.apply.dataset.mutation="true";
    this.panel.insertBefore(this.apply,this.panel.lastChild);this.sync();this.message("Review the draft before applying.");raw.focus();
  }
  openObject(kind?:ObjectKind,range?:SourceRange,position?:number){
    if(!this.alive)throw new Error("destroyed");const reason=this.controller.unavailableReason;if(reason)throw new Error(reason);
    if(position!==undefined&&(!Number.isInteger(position)||position<0||position>this.controller.view.state.doc.length))throw new Error("invalid-object-target");
    if(position!==undefined&&!range)this.controller.view.dispatch({selection:{anchor:Math.min(this.controller.view.state.doc.length,position+1)}});
    const session=this.controller.begin(kind,range);this.startPanel("Edit object");
    const raw=document.createElement("textarea");raw.rows=10;raw.value=session.original||this.template(session.kind);this.textarea=raw;setUILabel(raw,"Object Markdown");
    const parsed=readLinkDraft(session.original);
    if((session.kind==="link"||session.kind==="image")&&(!session.original||parsed)){
      const label=this.input(session.kind==="image"?"Alternative text":"Text",parsed?.label??"");const url=this.input("Target",parsed?.url??""),title=this.input("Title",parsed?.title??"");
      const update=(event:Event)=>{try{
        const current=readLinkDraft(raw.value);if(raw.value&&!current)throw new Error("Use the source draft for this link.");
        // Text inputs normalize newlines. Read untouched fields from the current source draft.
        const fields=current??{label:"",url:"",title:undefined};
        if(event.currentTarget===label)fields.label=label.value;
        else if(event.currentTarget===url)fields.url=url.value;
        else if(event.currentTarget===title)fields.title=title.value===""&&fields.title===undefined?undefined:title.value;
        const original=raw.value||undefined;
        raw.value=session.kind==="image"?serializeImageReference(fields.url,fields.label,fields.title,original):serializeLinkDraft(fields,original);
        this.controller.updateDraft(session.token,raw.value);if(this.apply)this.apply.disabled=false;this.message("");raw.dispatchEvent(new Event("input"));
      }catch(error){if(this.apply)this.apply.disabled=true;this.message((error as Error).message);}};
      for(const input of [label,url,title])input.addEventListener("input",update);
      raw.addEventListener("input",()=>{const fields=readLinkDraft(raw.value);for(const input of [label,url,title])input.disabled=!fields;if(fields){label.value=fields.label;url.value=fields.url;title.value=fields.title??"";}});
      if(session.kind==="image")this.panel.append(this.button("Replace image",()=>this.chooseResource(session)));
    }
    this.panel.append(this.label("Object Markdown",raw));
    const preview=document.createElement("div");preview.className="tegg-object-preview";setUILabel(preview,"Draft preview");this.panel.append(preview);
    raw.addEventListener("input",()=>{this.controller.updateDraft(session.token,raw.value);this.schedulePreview(session.kind,raw.value,preview);});
    this.controller.updateDraft(session.token,raw.value);
    this.apply=this.button("Apply",()=>{
      if(session.kind==="metadata"){const body=raw.value.replace(/^---\n/,"").replace(/\n---\s*$/,"");const parsed=parseDocument(body);if(parsed.errors.length)throw new Error(parsed.errors[0].message);}
      const result=this.controller.commit(session.token,raw.value);if(!result.ok)throw new Error(result.reason);this.close();
    });
    this.apply.dataset.mutation="true";
    this.panel.append(this.apply,this.button("Copy draft",()=>this.copy(raw.value)));this.endPanel();this.schedulePreview(session.kind,raw.value,preview);
  }
  private template(kind:ObjectKind){return ({link:"[text](https://)",image:"![description](assets/image.png)",code:"```text\n\n```",math:"$$\n\n$$",mermaid:"```mermaid\nflowchart TD\n  A --> B\n```",graphviz:"```graphviz\ndigraph { a -> b }\n```",footnote:"[^note]: ",callout:"> [!note]\n> ",metadata:"---\ntitle: \n---\n",table:"| A | B |\n| --- | --- |\n|  |  |",selection:""})[kind];}
  private schedulePreview(kind:ObjectKind,source:string,target:HTMLElement){
    clearTimeout(this.previewTimer);const epoch=++this.previewEpoch;
    this.previewTimer=setTimeout(()=>{void this.preview(kind,source,target,epoch).catch(error=>{if(epoch===this.previewEpoch)target.textContent=(error as Error).message;});},250);
  }
  private async preview(kind:ObjectKind,source:string,target:HTMLElement,epoch:number){
    if(epoch!==this.previewEpoch||!this.alive)return;
    // Bound synchronous engines before invocation: cancellation must stay responsive.
    const tooLarge=source.length>editingBudgets.draftPreviewUnits||((kind==="mermaid"||kind==="graphviz")&&(source.length>editingBudgets.diagramDraftUnits||source.split('\n').length>editingBudgets.diagramDraftLines));
    if(tooLarge){setUIText(target,"Draft is too large for automatic preview. Source is retained.");return;}
    const engines=enginesFor(this.controller.view.dom),current=()=>this.alive&&epoch===this.previewEpoch&&target.isConnected;
    const body=source.replace(/^\s*(`{3,}|~{3,})[^\n]*\n/,"").replace(/\n\s*(`{3,}|~{3,})\s*$/,"");
    let html:string;
    if(kind==="math"&&engines.math)html=engines.math(source.replace(/^\$\$\s*|\s*\$\$$/g,"").replace(/^\$|\$$/g,""),source.trim().startsWith("$$")?"block":"inline");
    else if((kind==="mermaid"||kind==="graphviz")&&engines[kind])html=await engines[kind]!(body,target,current);
    else {const context=this.controller.view.state.facet(resourceContext);html=parserFor(this.controller.identity.profile).render(source);if(current())target.innerHTML=sanitizeRenderedHtml(html,context.documentPath,context.resolveImage);return;}
    if(current()){
      if(kind==="mermaid"||kind==="graphviz")target.replaceChildren(sanitizeDiagramSvg(html));
      else target.innerHTML=sanitizeRenderedHtml(html);
    }
  }
  private async copy(text:string){if(this.host.copyText)await this.host.copyText(text);else await navigator.clipboard.writeText(text);this.message("Copied");}
  openSearch(){
    if(!this.alive)throw new Error("destroyed");if(this.controller.view.composing)throw new Error("composing");
    const session=this.controller.session;if(session&&["editing","stale"].includes(session.status))throw new Error("Finish or cancel the current object draft first");
    this.startPanel("Find and replace");const query=this.input("Find"),replacement=this.input("Replace with");
    const sensitive=this.input("Match case","","checkbox"),word=this.input("Whole word","","checkbox"),selected=this.input("In selection","","checkbox");
    let rangeDoc=this.controller.view.state.doc;const identity=this.controller.identity;
    const range={from:this.controller.view.state.selection.main.from,to:this.controller.view.state.selection.main.to};selected.disabled=range.from===range.to;
    const options=():FindOptions=>({caseSensitive:sensitive.checked,wholeWord:word.checked,...(selected.checked?{range}: {})});
    const guard=()=>{if(!sameEditingIdentity(identity,this.controller.identity))throw new Error("The document changed. Reopen search.");if(this.controller.view.composing)throw new Error("composing");if(selected.checked&&this.controller.view.state.doc!==rangeDoc)throw new Error("The search selection changed. Reopen search.");};
    const context=document.createElement("pre");context.setAttribute("role","region");setUILabel(context,"Match source context");this.panel.append(context);
    const replace=(all:boolean)=>{guard();const oldLength=this.controller.view.state.doc.length;const result=this.controller.replace(query.value,replacement.value,{...options(),all});if(!result.ok)throw new Error(result.reason);if(selected.checked)range.to+=this.controller.view.state.doc.length-oldLength;rangeDoc=this.controller.view.state.doc;this.message(result.changed?"Replaced":"No matches");};
    const find=(backward:boolean)=>{guard();const found=this.controller.find(query.value,options()),selection=this.controller.view.state.selection.main;const next=backward?[...found].reverse().find(item=>item.to<=selection.from)??found.at(-1):found.find(item=>item.from>=selection.to)??found[0];if(next){this.controller.view.dispatch({selection:{anchor:next.from,head:next.to},scrollIntoView:true});context.textContent=this.controller.view.state.doc.sliceString(Math.max(0,next.from-80),Math.min(this.controller.view.state.doc.length,next.to+80));this.message(String(found.length)+" matches");}else{context.textContent="";this.message("No matches");}};
    const once=this.button("Replace",()=>replace(false)),all=this.button("Replace all",()=>replace(true));once.dataset.mutation=all.dataset.mutation="true";
    this.panel.append(this.button("Find next",()=>find(false)),this.button("Find previous",()=>find(true)),once,all);this.endPanel();
  }
  async paste(input:ClipboardInput,range?:SourceRange){
    let node=syntaxTree(this.controller.view.state).resolveInner(range?.from??this.controller.view.state.selection.main.from,1),code=false;
    for(;;){if(["FencedCode","CodeBlock","InlineCode"].includes(node.name)){code=true;break;}if(!node.parent)break;node=node.parent;}
    const prepared=preparePaste(input,{target:code?"code":"document"});const session=this.controller.begin("selection",range??this.controller.view.state.selection.main);
    if(prepared.status!=="ready"){
      this.startPanel("Review paste");const original=document.createElement("textarea");original.readOnly=true;original.value=prepared.plainText||input.html||input.markdown||"";this.panel.append(this.label("Original input",original));
      const preview=document.createElement("pre");preview.textContent=prepared.markdown;this.panel.append(preview);
      const issues=document.createElement("p");issues.textContent=prepared.issues.map(item=>item.message).join('\n');this.panel.append(issues);
      if(prepared.status!=="rejected")this.panel.append(this.button("Insert converted Markdown",()=>this.applyPaste(session,preparePaste(input,{acceptSimplification:true}))));
      this.panel.append(this.button("Paste plain text",()=>this.applyPaste(session,preparePaste(input,{plainText:true}))),this.button("Copy original",()=>this.copy(original.value)));this.endPanel();return;
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
    this.message(result.reason);this.panel.append(this.button("Retry",async()=>{const result=await task.run();if(!this.alive||task!==this.task)return;if(result.ok)complete();else this.message(result.reason);}),this.button("Copy original",()=>this.copy(prepared.plainText)));this.endPanel();
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
        const original=existing?this.controller.session?.draft:undefined,fields=original?readLinkDraft(original):null;
        if(existing&&original&&!fields)throw new Error("Use the source draft for this image.");
        const next=result.kind==="file"?serializeLinkDraft({label:result.alt??"Attachment",url:result.reference,title:result.title}):serializeImageReference(result.reference,fields?.label??result.alt??"",fields?fields.title:result.title,original);
        if(existing){const updated=this.controller.updateDraft(session.token,next);if(!updated.ok)throw new Error(updated.reason);if(this.textarea){this.textarea.value=next;this.textarea.dispatchEvent(new Event("input"));}this.message("Attachment ready. Apply to update the document.");}
        else{const applied=this.controller.commit(session.token,next);if(!applied.ok)throw new Error(applied.reason);this.close();}
      }catch(error){if(!picker.signal.aborted&&this.alive){this.error(error);if(!existing&&this.controller.session?.token===session.token)this.controller.cancel(session.token);}}
      finally{signal?.removeEventListener("abort",abort);if(this.picker===picker)this.picker=undefined;}return;
    }
    this.filePicker?.remove();const picker=this.filePicker=document.createElement("input");picker.type="file";picker.multiple=!existing;picker.hidden=true;if(existing)picker.accept="image/*";this.element.append(picker);
    picker.addEventListener("cancel",()=>{picker.remove();if(!existing)this.controller.cancel(session.token);},{once:true});
    picker.addEventListener("change",()=>{const files=Array.from(picker.files??[]);picker.remove();if(!this.alive||this.filePicker!==picker)return;this.filePicker=undefined;if(!files.length){if(!existing)this.controller.cancel(session.token);return;}this.safe(async()=>{const input={files:files.map((file,i)=>({id:String(i),name:file.name,type:file.type,size:file.size,blob:file}))};const prepared=preparePaste(input);if(existing){const fields=readLinkDraft(this.controller.session?.draft??session.original);if(!fields||prepared.resources.length!==1||prepared.resources[0].kind!=="image")throw new Error("Select one image to replace the current image.");prepared.resources[0].alt=fields.label;prepared.resources[0].title=fields.title;}await this.applyPaste(session,prepared,!!existing);});},{once:true});picker.click();
  }
  destroy(){if(!this.alive)return;this.close(false);this.extensions.dispose();this.uiBinding.destroy();this.alive=false;this.stop();this.controller.view.dom.removeEventListener("keydown",this.editorKey);this.controller.view.dom.removeEventListener("tegg-edit-object",this.objectEvent);this.controller.view.dom.removeEventListener("tegg-table-resource-paste",this.tablePaste);this.element.removeEventListener("keydown",this.panelKey);if(this.effects.get(this.controller.view.state)!==undefined)this.controller.view.dispatch({effects:this.effects.reconfigure([])});this.element.remove();instances.delete(this.controller);}
}
export function attachEditingUI(controller:EditingController,root:HTMLElement,host:EditingUIHost={}){return new EditingUI(controller,root,host);}
