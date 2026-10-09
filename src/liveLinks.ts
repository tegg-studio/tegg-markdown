import {allocatedEditingSurface} from './overlayPlacement';
import {editingLeaveIsComposing,registerEditingLeave} from './editingPreflight';
import {contextFor, mountOverlay, setUIText, setUILabel} from "./uiContext";
import {ensureSyntaxTree, syntaxTree} from "@codemirror/language";
import {EditorView, ViewPlugin} from "@codemirror/view";
import {parserFor} from "./markdownParser";
import {resourceContext,sameResourceContextAuthority} from "./editorHost";
import {analyzeSource} from "./sourceAnalysis";
import {parseWikiLink} from "./profile";
import {dispatchSourcePatches} from "./editorPatches";
import {readLinkDraft, serializeLinkDraft, unwrapLinkDraft} from "./objectDraft";
import {sanitizeRenderedHtml} from './renderKit';
import {copySource} from './renderInteraction';
import {isMacLiveLinkOpen} from './renderedLinks';
import {editingControllerFor,sameEditingIdentity} from './editingController';
import {tableWidgetIsComposing} from './tableWidget';
import {buildReferenceLinkIndex, referenceDocumentSource, referenceLinkContext, referenceAt, referenceDefinitions, referenceOccurrences, referenceLabelReplacement,
  referenceDefinitionPatch, createReferenceDefinitionPatch, inlineLinkReplacement, validateLinkDestination, type ReferenceOccurrence, type ReferenceDefinition} from './referenceLinkEditing';
import type {SourcePatch} from './sourcePatch';

export type Link = {from: number; to: number; raw: string; label: string; target: string; wiki: boolean; labelSource?: string; title?: string; reference?:ReferenceOccurrence};
export function linkAt(view: EditorView, position: number): Link | null {
  const source = view.state.doc.toString();
  const profile = view.state.facet(resourceContext).profile;
  const markdownParser = parserFor(profile);
  const tree = ensureSyntaxTree(view.state, position, 50) ?? syntaxTree(view.state);
  for (let node = tree.resolveInner(position, 1); node; node = node.parent!) {
    if (["FencedCode", "CodeBlock", "Image"].includes(node.name)) return null;
    if(node.name==='InlineCode'){let parent=node.parent;while(parent&&parent.name!=='Link')parent=parent.parent;if(!parent)return null;}
  }
  const wiki = analyzeSource(view.state.doc, profile).wikiLinks.find(item => position >= item.from && position <= item.to);
  if (wiki) {
    const raw = source.slice(wiki.from, wiki.to);
    const parsed = parseWikiLink(raw.slice(2, -2));
    const alias = raw.slice(2,-2).indexOf('|');
    const labelSource = alias < 0 ? parsed.target : raw.slice(2,-2).slice(alias+1);
    const label = parsed.label || parsed.target;
    return {...wiki, raw, label, labelSource, target: parsed.target, wiki: true};
  }
  let index:ReturnType<typeof buildReferenceLinkIndex>|undefined;
  for (let node = tree.resolveInner(position, 1); node; node = node.parent!) {
    if (!["Link", "Autolink", "URL"].includes(node.name)) continue;
    if (node.name === "URL" && node.parent?.name === "Link") continue;
    if (node.parent?.name === "Image") return null;
    const raw = source.slice(node.from, node.to);
    const env = {};
    markdownParser.parse(referenceDocumentSource(view), env);
    const children = markdownParser.parseInline(raw, env)[0]?.children ?? [];
    const opening = children.find(token => token.type === "link_open");
    const target = opening?.attrGet("href");
    const reference = referenceAt(index ??= buildReferenceLinkIndex(source,profile,referenceDocumentSource(view)),position);
    if(reference && reference.kind==='link' && reference.from===node.from && reference.to===node.to){
      const definitions=referenceDefinitions(index,reference.key),definition=definitions[0];
      return {from:node.from,to:node.to,raw,label:reference.label,labelSource:reference.labelSource,target:target??definition?.target??'',title:opening?.attrGet('title')??definition?.title,wiki:false,reference};
    }
    if (!target) continue;
    const fallbackLabel = children.filter(token => token.nesting === 0 && token.type !== "html_inline").map(token => ["softbreak", "hardbreak"].includes(token.type) ? "\n" : token.content).join("");
    let labelSource: string | undefined;
    if (node.name === "Link") {
      for (let child = node.firstChild?.nextSibling; child; child = child.nextSibling) {
        if (child.name === "LinkMark" && source[child.from] === "]") { labelSource = source.slice(node.from + 1, child.from); break; }
      }
    }
    const fields = readLinkDraft(raw) ?? (labelSource === undefined ? null : readLinkDraft(`[${labelSource}]()`));
    return {from: node.from, to: node.to, raw, label: fields?.label ?? fallbackLabel, target, wiki: false, labelSource, title: opening?.attrGet("title") ?? undefined};
  }
  return null;
}

export function linkActionLabel(target: string, wiki = false): string {
  if (/^https?:/i.test(target)) return "Open in browser";
  if (/^mailto:/i.test(target)) return "Open in mail app";
  if (target.startsWith("#")) return "Jump to heading";
  if (wiki) return "Open note";
  let path: string;
  try {
    const url = new URL(target, "file:///document.md");
    if (url.protocol !== "file:") return "Unsupported link";
    path = decodeURIComponent(url.pathname);
  } catch { return "Open link"; }
  if (/\.(md|markdown|mdown|mkdn)$/i.test(path)) return "Open note";
  // Keep these document types aligned with AppModel.openLink's default-app routing.
  if (/\.(pdf|txt|rtf|doc|docx|xls|xlsx|ppt|pptx|pages|numbers|key|png|jpg|jpeg|gif|webp|heic|svg|mp3|m4a|wav|mp4|mov)$/i.test(path)) return "Open file";
  return "Show in Finder";
}

/** Inline source is never synthesized from a reference occurrence. */
function inlineDraftSource(link: Link): string | undefined {return !link.wiki&&!link.reference&&readLinkDraft(link.raw)?link.raw:undefined;}
export function linkLabelIsSimple(link:Link):boolean {
  const source=link.labelSource??link.label;
  if(/[\\\r\n]/.test(source)||/&(?:#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/i.test(source))return false;
  const tokens=parserFor('gfm').parseInline(source,{})[0]?.children??[];
  return tokens.every(token=>token.type==='text')&&source===link.label;
}
export function linkReplacement(link: Link, label: string, target: string, title?:string) {
  if(arguments.length<4)title=link.title;
  if(label!==link.label&&!linkLabelIsSimple(link))throw new Error('Edit this display text in the document to preserve its formatting.');
  if (/[\r\n]/.test(label) && (link.wiki || label !== link.label)) throw new Error("Display text must be on one line.");
  if(link.reference){
    if(target!==link.target||title!==link.title)throw new Error('Enter the shared target scope to change this reference destination.');
    return referenceLabelReplacement(link.reference,label);
  }
  validateLinkDestination(target);
  if (link.wiki) {
    if (/[\[\]|]/.test(target) || /[\[\]|]/.test(label)) throw new Error("Wiki links cannot contain brackets or a vertical bar.");
    const content=link.raw.slice(2,-2),separator=content.indexOf('|');
    const originalTarget=separator<0?content:content.slice(0,separator),originalAlias=separator<0?undefined:content.slice(separator+1);
    const destination=target===link.target?originalTarget:target;
    const alias=label===link.label?originalAlias:label;
    return '[['+destination+(alias===undefined?'':'|'+alias)+']]';
  }
  const original=inlineDraftSource(link);return original?inlineLinkReplacement(original,label,target,title):serializeLinkDraft({label,url:target,title});
}

export function linkPopoverPlacement(anchor: {left: number; top: number; bottom: number}, width: number, height: number, viewport: {width: number; height: number}, preferredSide?: "above" | "below") {
  const margin = 8, gap = 8;
  const below = Math.max(0, viewport.height - margin - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - margin);
  const useBelow = preferredSide === "below" && height <= below ? true : preferredSide === "above" && height <= above ? false : height <= below || below >= above;
  const maxHeight = useBelow ? below : above;
  return {
    left: Math.max(margin, Math.min(anchor.left, viewport.width - width - margin)),
    top: useBelow ? anchor.bottom + gap : anchor.top - gap - Math.min(height, maxHeight),
    maxHeight,
    side: useBelow ? "below" as const : "above" as const,
  };
}

/** Only callers holding a real rendered/draft owner may provide these actions. */
export type LiveLinkActions = {
  owner:HTMLElement;
  target:string;
  wiki?:boolean;
  current:()=>boolean;
  open:()=>void;
  edit?:()=>void;
  restoreFocus?:()=>void;
};
function composingLinkInput(view:EditorView) {return tableWidgetIsComposing(view)||editingLeaveIsComposing(view);}
function captureLinkAuthority(view:EditorView):()=>boolean {
  const controller=editingControllerFor(view),identity=controller?.identity;
  let revoked=false;
  return ()=>{
    if(editingControllerFor(view)!==controller||controller&&identity&&!sameEditingIdentity(identity,controller.identity))revoked=true;
    return !revoked;
  };
}
function mountLinkOverlay(view:EditorView,panel:HTMLElement) {
  const owner=contextFor(view.dom).overlayContainer?view.dom:view.dom.closest<HTMLElement>(".tegg-sdk-frame")??view.dom;
  return mountOverlay(owner,panel);
}
/** One menu factory serves parsed text links and real HTML draft anchors. */
function appendLinkActions(panel:HTMLElement,view:EditorView,options:Omit<LiveLinkActions,'owner'>) {
  const allowed=()=>options.current()&&!composingLinkInput(view);
  const action=(key:string,run:(button:HTMLButtonElement)=>void)=>{
    const button=document.createElement('button');button.type='button';setUIText(button,key);
    button.addEventListener('click',()=>{if(allowed())run(button);});return button;
  };
  let readableTarget=options.target;
  try {readableTarget=decodeURI(options.target);} catch { /* Display only; Copy retains the actual destination. */ }
  const target=action('',()=>options.open());target.className='md-link-destination';target.title=readableTarget;
  setUILabel(target,'Open {value}',{value:readableTarget});
  const text=document.createElement('span');text.className='md-link-destination-text';text.textContent=readableTarget;
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 16 16');icon.setAttribute('aria-hidden','true');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M9 2.5h4.5V7M13 3L7 9M6 3H3a.5.5 0 0 0-.5.5v9a1 1 0 0 0 1 1h9a.5.5 0 0 0 .5-.5v-3');icon.append(path);target.append(text,icon);
  const footer=document.createElement('div');footer.className='md-link-footer';
  const hint=document.createElement('span');hint.className='md-link-hint';setUIText(hint,linkActionLabel(options.target,options.wiki));
  const edit=action('Edit link',()=>options.edit?.());edit.className='md-link-text-action';edit.disabled=!options.edit;
  const copy=action('Copy link address',button=>{
    // Do not queue a composition-time action, or infer an ACK from a canceled legacy event.
    setUIText(hint,linkActionLabel(options.target,options.wiki));
    void copySource(options.target,button,undefined,allowed).then(copied=>{
      if(copied===true&&allowed()){hint.setAttribute('role','status');setUIText(hint,'Copied');}
    });
  });
  copy.className='md-link-copy-address';setUILabel(copy,'Copy link address');
  footer.append(hint,edit,copy);panel.append(target,footer);
  // Pointer menu actions preserve the text selection and cannot implicitly finish a table cell.
  for(const type of ['pointerdown','mousedown'])panel.addEventListener(type,event=>{
    if(event.target instanceof Element&&event.target.closest('button')&&(event.type==='mousedown'||!['touch','pen'].includes((event as PointerEvent).pointerType)))event.preventDefault();
  });
}
function placeLinkActionPopover(panel:HTMLElement,anchor:{left:number;top:number;bottom:number},previous?:{left:number;side:'above'|'below'}) {
  const position=linkPopoverPlacement(anchor,panel.offsetWidth,panel.scrollHeight,{width:window.innerWidth,height:window.innerHeight},previous?.side??panel.dataset.side as 'above'|'below');
  panel.dataset.side=position.side;
  panel.style.left=`${previous?Math.max(8,Math.min(previous.left,window.innerWidth-panel.offsetWidth-8)):position.left}px`;
  panel.style.top=`${position.top}px`;panel.style.maxHeight=`${position.maxHeight}px`;panel.style.overflowY='auto';
}
/** Internal reuse only: the caller supplies the actual owner and controlled navigation. */
export function showLiveLinkActions(view:EditorView,options:LiveLinkActions):()=>void {
  return controllers.get(view)?.showProjectedActions(options)??(()=>{});
}

let nextLinkFormID = 0;
const controllers = new WeakMap<EditorView, LinkController>();
/** @internal Actual generated interaction ownership, independent of write authority. */
export function captureLiveLinkInteraction(view:EditorView):{
  panel:HTMLElement;projectedOwner:HTMLElement|null;current:()=>boolean;owns:(node:Node)=>boolean;
  leaveChoice:{keep:HTMLButtonElement;current:()=>boolean}|null;
}|null {
  const controller=controllers.get(view),panel=controller?.panel;
  if(!controller||!panel?.isConnected)return null;
  const epoch=controller.interactionEpoch,projectedOwner=controller.projectedOwner,link=controller.activeLink;
  const current=()=>controllers.get(view)===controller&&controller.interactionEpoch===epoch&&
    controller.panel===panel&&panel.isConnected&&controller.projectedOwner===projectedOwner&&
    controller.activeLink===link&&(!projectedOwner||projectedOwner.isConnected);
  const notice=controller.closeNotice,keep=notice?.querySelector<HTMLButtonElement>('button');
  const leaveChoice=notice&&keep&&controller.leavePending?{keep,current:()=>current()&&controller.leavePending&&
    controller.closeNotice===notice&&notice.isConnected&&keep.isConnected&&notice.contains(keep)&&
    !view.compositionStarted&&!composingLinkInput(view)}:null;
  return {panel,projectedOwner,current,owns:node=>current()&&panel.contains(node),leaveChoice};
}
/** A lease for one actual dedicated link draft, independent of generic sessions. */
export function captureCurrentLinkDraft(view:EditorView):{panel:HTMLElement;current:()=>boolean}|null {
  const controller=controllers.get(view),panel=controller?.panel,link=controller?.activeLink;
  if(!controller?.editing||!panel?.isConnected||!link)return null;
  const doc=view.state.doc,{from,to,raw}=link;
  return {panel,current:()=>controllers.get(view)===controller&&controller.editing&&
    controller.panel===panel&&panel.isConnected&&controller.activeLink===link&&
    link.from===from&&link.to===to&&link.raw===raw&&view.state.doc===doc};
}
export function editCurrentLink(view: EditorView) {
  const selection=view.state.selection.main;
  let link = linkAt(view, selection.empty?selection.head:selection.from+Math.min(1,selection.to-selection.from));
  if(!link&&selection.empty&&selection.head>0){const previous=linkAt(view,selection.head-1);if(previous?.to===selection.head)link=previous;}
  if (!link || !selection.empty&&(selection.from<link.from||selection.to>link.to)) return false;
  const controller=controllers.get(view);if(!controller)return false;
  controller.show(link, true);return !!controller.panel&&controller.editing&&controller.activeLink?.from===link.from&&controller.activeLink.raw===link.raw;
}
class LinkController {
  panel: HTMLDivElement | HTMLDialogElement | null = null;
  interactionEpoch=0;
  projectedOwner:HTMLElement|null=null;
  editing = false;
  timer = 0;
  activeLink: Link | null = null;
  composing = false;
  leavePending = false;
  closeNotice?:HTMLElement;
  leaveOverlay?:HTMLElement;
  leaveFocus?:{field:HTMLElement;from?:number|null;to?:number|null;direction?:"forward"|"backward"|"none"|null};
  protectedNodes:Array<{node:HTMLElement;inert:boolean}>=[];
  dirtyFields:()=>boolean = ()=>false;
  saveDraft?:()=>boolean;
  stopLeave:()=>void;
  stopOverlay?:()=>void;
  stopPlacement?:()=>void;
  cancelPending() {const pending=this.leavePending;this.leavePending=false;if(pending)this.view.dom.dispatchEvent(new CustomEvent('tegg-editing-leave-cancelled',{bubbles:true}));}
  prepareLeave() {return this.requestClose(true);}
  requestClose(leaving=false) {
    if(this.composing||this.view.composing){this.cancelPending();return false;}
    if(!this.editing||!this.dirtyFields()){this.close();return true;}
    if(leaving)this.leavePending=true;
    if(!this.closeNotice&&this.panel){
      const active=this.panel.ownerDocument.activeElement;
      if(active instanceof HTMLElement&&this.panel.contains(active))this.leaveFocus={field:active,...(active instanceof HTMLInputElement?{from:active.selectionStart,to:active.selectionEnd,direction:active.selectionDirection}:{})};
      const overlay=this.leaveOverlay=document.createElement('div');overlay.className='md-link-leave-overlay';
      const note=this.closeNotice=document.createElement('section');note.className='md-link-leave-choice';note.setAttribute('role','alertdialog');note.setAttribute('aria-modal','true');
      const text=document.createElement('p');text.id=`tegg-link-leave-${++nextLinkFormID}`;setUIText(text,'This object has unapplied changes. Complete the edit or discard changes before leaving.');note.setAttribute('aria-labelledby',text.id);note.append(text);
      const warning=document.createElement('p');warning.className='md-link-leave-error';warning.setAttribute('role','alert');note.append(warning);
      const choices=document.createElement('div');choices.className='md-link-leave-actions';note.append(choices);
      const choice=(label:string,run:()=>void)=>{const button=document.createElement('button');button.type='button';setUIText(button,label);button.addEventListener('click',()=>{if(!this.composing&&!this.view.composing)run();});choices.append(button);return button;};
      const keep=choice('Keep editing',()=>this.dismissLeave());
      choice('Discard changes',()=>{const pending=this.leavePending;this.close(true);if(pending)this.view.dom.dispatchEvent(new CustomEvent('tegg-editing-leave-resolved',{bubbles:true,detail:{choice:'discard'}}));});
      choice('Complete and continue',()=>{this.saveDraft?.();});
      this.protectedNodes=[...this.panel.children].filter((node):node is HTMLElement=>node instanceof HTMLElement).map(node=>({node,inert:!!node.inert}));for(const item of this.protectedNodes)item.node.inert=true;
      overlay.append(note);this.panel.append(overlay);this.syncLeaveAvailability();keep.focus({preventScroll:true});
    }
    return false;
  }
  dismissLeave(){
    this.cancelPending();this.leaveOverlay?.remove();this.leaveOverlay=undefined;this.closeNotice=undefined;
    for(const item of this.protectedNodes)item.node.inert=item.inert;this.protectedNodes=[];
    const focus=this.leaveFocus;this.leaveFocus=undefined;if(focus?.field.isConnected){focus.field.focus({preventScroll:true});if(focus.field instanceof HTMLInputElement&&focus.from!=null&&focus.to!=null)focus.field.setSelectionRange(focus.from,focus.to,focus.direction??'none');}
  }
  syncLeaveAvailability(){
    const button=this.closeNotice?.querySelector<HTMLButtonElement>('[data-tegg-ui-text="Complete and continue"]'),warning=this.closeNotice?.querySelector<HTMLElement>('.md-link-leave-error');if(!button)return;
    const link=this.activeLink,reason=this.view.state.readOnly||this.view.state.facet(EditorView.editable)===false?'This document is read-only.':link&&this.view.state.sliceDoc(link.from,link.to)!==link.raw?'The link changed. Reopen it to edit.':'';
    button.disabled=!!reason;if(warning&&reason)setUIText(warning,reason);
  }
  controls(root:HTMLElement){return [...root.querySelectorAll<HTMLElement>('button,input,summary,[tabindex]')].filter(node=>!node.matches(':disabled,[tabindex="-1"]')&&!node.closest('[hidden],[inert]')&&getComputedStyle(node).display!=='none'&&!(node.closest('details:not([open])')&&node!==node.closest('details')?.querySelector('summary')));}
  cycleFocus(event:KeyboardEvent){const root=this.closeNotice??this.panel;if(!root)return;const controls=this.controls(root);if(!controls.length)return;const index=controls.indexOf(root.ownerDocument.activeElement as HTMLElement),next=controls[(index+(event.shiftKey?-1:1)+controls.length)%controls.length];event.preventDefault();next.focus();}
  cancelClose() { clearTimeout(this.timer); this.timer = 0; }
  scheduleClose() {
    this.cancelClose();
    if (!this.editing) this.timer = window.setTimeout(() => {
      if (!this.panel?.contains(document.activeElement)) this.close();
    }, 350);
  }
  over(event: MouseEvent) {
    const link = this.target(event);
    if (!link || this.editing || composingLinkInput(this.view) || this.pointerActive&&this.down?.dragged) return;
    this.cancelClose();
    if (this.activeLink?.from !== link.from || this.activeLink?.to !== link.to) this.show(link);
  }
  out(event: MouseEvent) {
    const next = event.relatedTarget;
    if (next instanceof Node && this.panel?.contains(next)) { this.cancelClose(); return; }
    const element = next instanceof Element ? next.closest(".cm-live-link, .cm-live-wikilink") : null;
    if (element && element === (event.target as Element).closest(".cm-live-link, .cm-live-wikilink")) return;
    this.scheduleClose();
  }
  down: {x:number;y:number;button:number;doc:EditorView['state']['doc'];pointer:boolean;dragged:boolean;current:()=>boolean;link:Link|null} | null = null;
  pointerActive = false;
  beginPointer(event:MouseEvent,pointer=false) {
    const doc=this.view.state.doc,context={...this.view.state.facet(resourceContext)},rootSource=referenceDocumentSource(this.view),authority=captureLinkAuthority(this.view);
    const current=()=>controllers.get(this.view)===this&&authority()&&this.view.state.doc===doc&&
      sameResourceContextAuthority(context,this.view.state.facet(resourceContext))&&referenceDocumentSource(this.view)===rootSource;
    this.down={x:event.clientX,y:event.clientY,button:event.button,doc,pointer,dragged:false,current,link:isMacLiveLinkOpen(event,this.view.dom)?this.target(event):null};this.pointerActive=true;
  }
  movePointer(event:MouseEvent) {if(this.pointerActive&&this.down?.button===0&&(event.buttons&1)&&Math.hypot(event.clientX-this.down.x,event.clientY-this.down.y)>4)this.down.dragged=true;}
  constructor(readonly view: EditorView) { controllers.set(view, this); document.addEventListener("mousedown", this.outside, true);this.stopLeave=registerEditingLeave({view,composing:()=>this.composing,awaitingChoice:()=>this.leavePending&&!!this.closeNotice,prepare:()=>this.prepareLeave(),cancelPending:()=>this.cancelPending()}); }
  outside = (event: MouseEvent) => { if (this.panel && !this.panel.contains(event.target as Node) && !this.requestClose()) {event.preventDefault();event.stopPropagation();} };
  close(resolving=false) { this.interactionEpoch++;this.projectedOwner=null; if(resolving)this.leavePending=false;else this.cancelPending();this.cancelClose();this.stopPlacement?.();this.stopPlacement=undefined; this.panel?.remove();this.stopOverlay?.();this.stopOverlay=undefined; this.panel = null; this.activeLink = null; this.editing = false;this.composing=false;this.closeNotice=undefined;this.leaveOverlay=undefined;this.leaveFocus=undefined;this.protectedNodes=[];this.dirtyFields=()=>false;this.saveDraft=undefined; }
  target(event: MouseEvent) {
    const element = (event.target as Element).closest<HTMLElement>(".cm-live-link, .cm-live-wikilink");
    if (!element) return null;
    try { return linkAt(this.view, Math.min(this.view.state.doc.length, this.view.posAtDOM(element) + 1)); } catch { return null; }
  }
  open(link: Link) {
    if (/^(?:javascript|data|vbscript):/i.test(link.target)) return;
    this.view.dom.dispatchEvent(new CustomEvent("tegg-open-link", {bubbles: true, cancelable: true,
      detail: link.wiki ? `wikilink:${encodeURIComponent(link.target)}` : link.target}));
    this.close();
  }
  show(link: Link, editing = false) {
    if(composingLinkInput(this.view))return;
    if(this.editing&&this.panel){if(this.activeLink?.from===link.from&&this.activeLink?.raw===link.raw){this.panel.querySelector<HTMLInputElement>('input')?.focus();return;}if(!this.requestClose())return;}
    const previous = editing && this.activeLink?.from === link.from && this.panel
      ? {left: parseFloat(this.panel.style.left), side: this.panel.dataset.side as "above" | "below"} : undefined;
    this.close(); this.editing = editing; this.activeLink = link;
    const panel = this.panel = editing?document.createElement("dialog"):document.createElement("div");
    panel.style.margin="0";panel.className = "md-link-popover" + (editing ? " md-link-editor" : "");
    panel.setAttribute("role", editing ? "dialog" : "group");
    const mobile=contextFor(this.view.dom).mobile??(typeof matchMedia!=="undefined"&&matchMedia("(pointer:coarse)").matches);
    panel.dataset.mobile=String(mobile);
    setUILabel(panel,editing ? "Edit link" : "Link actions");
    panel.addEventListener("mouseenter", () => this.cancelClose());
    panel.addEventListener("mouseleave", () => this.scheduleClose());
    panel.addEventListener("focusin", () => this.cancelClose());
    panel.addEventListener("focusout", () => this.scheduleClose());
    panel.addEventListener('compositionstart',()=>{this.composing=true;this.cancelPending();});
    panel.addEventListener('compositionend',()=>{this.composing=false;});
    const escape=()=>{if(this.closeNotice)this.dismissLeave();else if(this.requestClose())this.view.focus();};
    panel.addEventListener('pointerdown',event=>{if((this.composing||this.view.composing)&&event.target instanceof Element&&event.target.closest('button'))event.preventDefault();});
    panel.addEventListener('mousedown',event=>{if((this.composing||this.view.composing)&&event.target instanceof Element&&event.target.closest('button'))event.preventDefault();});
    panel.addEventListener('cancel',event=>{event.preventDefault();if(!this.composing&&!this.view.composing)escape();});
    panel.addEventListener("keydown", incoming => {
      const event=incoming as KeyboardEvent;event.stopPropagation();if(this.composing||this.view.composing||event.isComposing||event.keyCode===229){if(event.key==='Enter')event.preventDefault();return;}
      if(event.key==='Escape'){event.preventDefault();escape();}
      else if(editing&&event.key==='Tab')this.cycleFocus(event);
      else if(editing&&event.key==='Enter'&&event.metaKey){event.preventDefault();if(!this.closeNotice)this.saveDraft?.();}
      else if(editing&&event.key==='Enter'&&event.target instanceof HTMLInputElement)event.preventDefault();
    });
    const action = (text: string, run: () => void) => {
      const button = document.createElement("button"); button.type = "button"; setUIText(button,text);
      button.addEventListener("click", () => {if(!this.composing&&!this.view.composing)run();}); return button;
    };
    let readableTarget = link.target;
    try { readableTarget = decodeURI(link.target); } catch { /* Keep malformed escape sequences readable. */ }
    if (!editing) {
      const doc=this.view.state.doc,context={...this.view.state.facet(resourceContext)},rootSource=referenceDocumentSource(this.view),{from,to,raw}=link,authority=captureLinkAuthority(this.view);
      const current=()=>controllers.get(this.view)===this&&this.panel===panel&&panel.isConnected&&this.activeLink===link&&
        link.from===from&&link.to===to&&link.raw===raw&&authority()&&this.view.state.doc===doc&&referenceDocumentSource(this.view)===rootSource&&
        sameResourceContextAuthority(context,this.view.state.facet(resourceContext));
      const writable=()=>!this.view.state.readOnly&&this.view.state.facet(EditorView.editable)!==false&&editingControllerFor(this.view)?.unavailableReason==null;
      appendLinkActions(panel,this.view,{target:link.target,wiki:link.wiki,current,open:()=>this.open(link),
        edit:writable()?()=>{if(writable())this.show(link,true);}:undefined});
    } else {
      const form = document.createElement("form");form.id=`tegg-link-form-${++nextLinkFormID}`;
      const header=document.createElement("header"),heading=document.createElement("h2");setUIText(heading,"Edit link");header.append(heading);panel.append(header);
      const input = (name: string, value: string) => {
        const label = document.createElement("label"),text=document.createElement("span"); setUIText(text,name);label.append(text);
        const field = document.createElement("input"); field.value = value; field.spellcheck = false; field.autocomplete = "off"; setUILabel(field,name);
        label.append(field); form.append(label); return field;
      };
      const simple=linkLabelIsSimple(link);
      let labelInput:HTMLInputElement|undefined;
      if(simple)labelInput=input('Display text',link.label);
      else {
        const preview=document.createElement('div');preview.className='md-link-label-preview';setUILabel(preview,'Display text');
        if(link.wiki)preview.textContent=link.label;else preview.innerHTML=sanitizeRenderedHtml(parserFor(this.view.state.facet(resourceContext).profile).renderInline(link.labelSource??link.label));
        const note=document.createElement('p');note.className='md-link-label-note';setUIText(note,'Edit this display text in the document to preserve its formatting.');form.append(preview,note);
      }
      const target=input('Link destination',readableTarget);
      let labelEdited=false,targetEdited=false,titleEdited=false,shared=false;
      labelInput?.addEventListener('input',()=>{labelEdited=true;});target.addEventListener('input',()=>{targetEdited=true;});
      let titleInput:HTMLInputElement|undefined,titleSection:HTMLDetailsElement|undefined;
      if(!link.wiki){
        titleSection=document.createElement('details');titleSection.className='md-link-title-details';titleSection.open=!!link.title;
        const summary=document.createElement('summary');setUIText(summary,'Description (optional)');titleSection.append(summary);
        const titleLabel=document.createElement('label');
        titleInput=document.createElement('input');titleInput.value=link.title??'';titleInput.spellcheck=false;setUILabel(titleInput,'Description (optional)');titleLabel.append(titleInput);titleSection.append(titleLabel);form.append(titleSection);
        titleInput.addEventListener('input',()=>{titleEdited=true;});
      }
      let sharedDefinitions:ReferenceDefinition[]=[],sharedOccurrences:ReferenceOccurrence[]=[];
      if(link.reference){
        target.readOnly=true;if(titleInput)titleInput.readOnly=true;
        const scopeSource=referenceDocumentSource(this.view),index=buildReferenceLinkIndex(scopeSource,this.view.state.facet(resourceContext).profile);
        sharedOccurrences=referenceOccurrences(index,link.reference.key);sharedDefinitions=referenceDefinitions(index,link.reference.key);
        const unmapped=!!index.resolved[link.reference.key]&&!sharedDefinitions.length;
        const sharedButton=action('Shared target ({value} occurrences)',()=>{
          if(shared)return;shared=true;sharedButton.disabled=true;
          const scope=document.createElement('section');scope.className='md-link-shared-scope';scope.dataset.referenceKey=link.reference!.key;
          const heading=document.createElement('p');setUIText(heading,'This change affects these reference occurrences:');scope.append(heading);
          const list=document.createElement('ul');list.className='md-link-reference-occurrences';
          for(const item of sharedOccurrences){const row=document.createElement('li'),text=document.createElement('span'),position=document.createElement('span');text.textContent=item.label;setUIText(position,'Line {value}',{value:String(scopeSource.slice(0,item.from).split('\n').length)});row.dataset.sourceFrom=String(item.from);row.dataset.sourceTo=String(item.to);row.append(text,document.createTextNode(' — '),position);list.append(row);}scope.append(list);
          if(unmapped){const warning=document.createElement('p');setUIText(warning,'This shared definition cannot be mapped safely. Inspect it in Source before changing its target.');scope.append(warning);}
          else if(sharedDefinitions.length>1){
            const warning=document.createElement('p');setUIText(warning,'This reference has multiple definitions. Inspect them in Source before changing the shared target.');scope.append(warning);
            for(const definition of sharedDefinitions){const entry=document.createElement('pre');entry.className='md-link-conflicting-definition';entry.textContent=definition.raw;entry.dataset.sourceFrom=String(definition.from);entry.dataset.sourceTo=String(definition.to);scope.append(entry);}
          }else {
            target.readOnly=false;if(titleInput)titleInput.readOnly=false;
            if(!sharedDefinitions.length){const warning=document.createElement('p');setUIText(warning,'The definition is missing. Completing this edit creates one shared definition for the occurrences above.');scope.append(warning);}
          }
          form.insertBefore(scope,target.parentElement);target.focus();requestAnimationFrame(()=>{if(this.panel===panel)this.place(link);});
        });
        setUIText(sharedButton,'Shared target ({value} occurrences)',{value:String(sharedOccurrences.length)});sharedButton.className='md-link-shared-target';form.insertBefore(sharedButton,target.parentElement);
      }
      const error=document.createElement('div');error.setAttribute('role','alert');
      const fields=()=>({label:labelEdited?labelInput!.value:link.label,target:targetEdited&&target.value!==readableTarget?target.value:link.target,title:titleEdited?(titleInput!.value||undefined):link.title});
      this.dirtyFields=()=>{const value=fields();return value.label!==link.label||value.target!==link.target||value.title!==link.title;};
      const save=(remove=false):boolean=>{
        if(this.composing||this.view.composing)return false;
        if(!remove&&!this.dirtyFields()){const pending=this.leavePending;this.close(true);this.view.focus();if(pending)this.view.dom.dispatchEvent(new CustomEvent('tegg-editing-leave-resolved',{bubbles:true,detail:{choice:'complete'}}));return true;}
        try {
          if(this.view.state.readOnly||this.view.state.facet(EditorView.editable)===false)throw new Error('This document is read-only.');
          if(this.view.state.sliceDoc(link.from,link.to)!==link.raw)throw new Error('The link changed. Reopen it to edit.');
          const value=fields(),pending=this.leavePending,patches:SourcePatch[]=[],sharedPatches:SourcePatch[]=[];
          if(labelEdited&&!simple)throw new Error('Edit this display text in the document to preserve its formatting.');
          if(remove){
            const original=inlineDraftSource(link),sourceLabel=link.reference?.labelSource??(link.wiki?link.labelSource:original?unwrapLinkDraft(original):undefined);
            const insert=value.label===link.label&&sourceLabel!=null?sourceLabel:unwrapLinkDraft(serializeLinkDraft({label:value.label,url:''}))!;
            patches.push({from:link.from,to:link.to,expected:link.raw,insert});
          }else if(link.reference){
            const scopeSource=referenceDocumentSource(this.view),profile=this.view.state.facet(resourceContext).profile;
            const current=buildReferenceLinkIndex(scopeSource,profile),local=buildReferenceLinkIndex(this.view.state.doc.toString(),profile,scopeSource),occurrence=referenceAt(local,link.from+1);
            if(!occurrence||occurrence.raw!==link.raw)throw new Error('The link changed. Reopen it to edit.');
            if(value.target!==link.target||value.title!==link.title){
              if(!shared)throw new Error('Enter the shared target scope to change this reference destination.');
              const definitions=referenceDefinitions(current,link.reference.key),occurrences=referenceOccurrences(current,link.reference.key);
              if(definitions.length!==sharedDefinitions.length||definitions.some((item,i)=>item.raw!==sharedDefinitions[i].raw)||occurrences.length!==sharedOccurrences.length||occurrences.some((item,i)=>item.raw!==sharedOccurrences[i].raw))throw new Error('The shared reference scope changed. Reopen it to review the affected occurrences.');
              if(!definitions.length&&current.resolved[link.reference.key])throw new Error('This shared definition cannot be mapped safely. Inspect it in Source before changing its target.');
              if(definitions.length>1)throw new Error('This reference has multiple definitions. Inspect them in Source before changing the shared target.');
              sharedPatches.push(definitions.length?referenceDefinitionPatch(definitions[0],value.target,value.title):createReferenceDefinitionPatch(scopeSource,occurrence.identifier,value.target,value.title));
            }
            const insert=referenceLabelReplacement(occurrence,value.label);if(insert!==link.raw)patches.push({from:link.from,to:link.to,expected:link.raw,insert});
          }else {
            const insert=linkReplacement(link,value.label,value.target,value.title);if(insert!==link.raw)patches.push({from:link.from,to:link.to,expected:link.raw,insert});
          }
          if(sharedPatches.length&&referenceLinkContext(this.view)){
            if(!referenceLinkContext(this.view)!.applyShared(sharedPatches,patches))throw new Error('The shared reference scope changed. Reopen it to review the affected occurrences.');
          }else if(patches.length||sharedPatches.length)dispatchSourcePatches(this.view,[...patches,...sharedPatches],{isolateHistory:true});
          this.close(true);this.view.focus();if(pending)this.view.dom.dispatchEvent(new CustomEvent('tegg-editing-leave-resolved',{bubbles:true,detail:{choice:'complete'}}));return true;
        }catch(failure){setUIText(error,(failure as Error).message);const warning=this.closeNotice?.querySelector<HTMLElement>(".md-link-leave-error");if(warning)setUIText(warning,(failure as Error).message);this.syncLeaveAvailability();return false;}
      };
      this.saveDraft=()=>save();
      const buttons=document.createElement('div');buttons.className='md-link-footer md-link-editor-actions';
      const remove=action('Remove link',()=>save(true));remove.className='md-link-text-action md-link-remove';
      const cancel=action('Cancel',()=>{this.close();this.view.focus();});
      const submit=action('Done',()=>{});submit.type='submit';submit.setAttribute('form',form.id);submit.className='md-link-save';form.append(error,remove);panel.append(form);
      if(mobile){header.prepend(cancel);header.append(submit);}else{buttons.append(cancel,submit);panel.append(buttons);}
      form.addEventListener('submit',event=>{event.preventDefault();save();});
      requestAnimationFrame(()=>{if(this.panel===panel&&this.editing&&!panel.contains(this.view.dom.ownerDocument.activeElement)){const field=labelInput??target;field.focus();field.select();}});

    }
    this.stopOverlay=mountLinkOverlay(this.view,panel);
    this.place(link,previous);
    if(panel instanceof HTMLDialogElement){if(typeof panel.showModal==="function")panel.showModal();else panel.setAttribute("open","");}
    if(editing){
      const resize=()=>{if(this.panel===panel)this.place(this.activeLink??link);};
      window.addEventListener("resize",resize);
      const owners=allocatedEditingSurface(this.view.dom).owners;
      const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(resize):undefined;
      for(const owner of owners)observer?.observe(owner);
      this.stopPlacement=()=>{window.removeEventListener("resize",resize);observer?.disconnect();};
    }
  }
  place(link:Link,previous?:{left:number;side:'above'|'below'}) {
    const panel=this.panel;if(!panel)return;
    if(this.editing){
      panel.style.overflowY='hidden';
      if(panel.dataset.mobile==='true'&&window.innerWidth<600){
        panel.style.left='env(safe-area-inset-left,0px)';panel.style.right='env(safe-area-inset-right,0px)';panel.style.width='auto';panel.style.top='env(safe-area-inset-top,0px)';
        panel.style.maxHeight='calc(100dvh - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px))';
      }else{
        const surface=allocatedEditingSurface(this.view.dom),available=surface.width,width=Math.max(0,Math.min(440,available-32));
        const inset=parseFloat(getComputedStyle(this.view.dom).getPropertyValue('--toolbar-inset'))||0;
        panel.style.width=`${width}px`;panel.style.left=`${Math.max(16,surface.left+(available-width)/2)}px`;panel.style.right='auto';panel.style.top=`${window.innerHeight<500?8:inset+20}px`;
        panel.style.maxHeight=`${Math.max(0,window.innerHeight-(window.innerHeight<500?16:inset+40))}px`;
      }
      return;
    }
    const coords=this.view.coordsAtPos(link.from);
    placeLinkActionPopover(panel,coords??{left:16,top:30,bottom:50},previous);
  }

  showProjectedActions(options:LiveLinkActions):()=>void {
    if(!options.owner.isConnected||!options.current()||composingLinkInput(this.view)||this.pointerActive&&this.down?.dragged)return ()=>{};
    if(this.editing&&!this.requestClose())return ()=>{};
    this.close();
    this.projectedOwner=options.owner;
    const panel=this.panel=document.createElement('div');panel.className='md-link-popover';panel.style.margin='0';panel.setAttribute('role','group');setUILabel(panel,'Link actions');
    panel.dataset.mobile=String(contextFor(this.view.dom).mobile??(typeof matchMedia!=="undefined"&&matchMedia("(pointer:coarse)").matches));
    const doc=this.view.state.doc,context={...this.view.state.facet(resourceContext)},rootSource=referenceDocumentSource(this.view),authority=captureLinkAuthority(this.view);
    const current=()=>controllers.get(this.view)===this&&authority()&&this.panel===panel&&panel.isConnected&&options.owner.isConnected&&
      this.view.state.doc===doc&&referenceDocumentSource(this.view)===rootSource&&sameResourceContextAuthority(context,this.view.state.facet(resourceContext))&&options.current();
    appendLinkActions(panel,this.view,{...options,current,open:()=>{options.open();if(this.panel===panel)this.close();},
      edit:options.edit?()=>{if(this.panel===panel)this.close();options.edit!();}:undefined});
    panel.addEventListener('mouseenter',()=>this.cancelClose());panel.addEventListener('mouseleave',()=>this.scheduleClose());
    panel.addEventListener('focusin',()=>this.cancelClose());panel.addEventListener('focusout',()=>this.scheduleClose());
    panel.addEventListener('keydown',event=>{event.stopPropagation();if(event.isComposing||event.keyCode===229||composingLinkInput(this.view)){if(event.key==='Enter')event.preventDefault();return;}if(event.key==='Escape'){event.preventDefault();if(!current())return;this.close();options.restoreFocus?.();}});
    this.stopOverlay=mountLinkOverlay(this.view,panel);
    const place=()=>{if(current())placeLinkActionPopover(panel,options.owner.getBoundingClientRect());};place();
    window.addEventListener('resize',place);this.stopPlacement=()=>window.removeEventListener('resize',place);
    return ()=>{if(this.panel===panel)this.close();};
  }

  update(update: import("@codemirror/view").ViewUpdate) {
    this.syncLeaveAvailability();if(!update.docChanged)return;
    const link=this.activeLink;if(!this.editing||!link){this.close();return;}
    const from=update.changes.mapPos(link.from,1),to=update.changes.mapPos(link.to,-1);
    if(from<=to&&update.state.sliceDoc(from,to)===link.raw){link.from=from;link.to=to;}
    this.syncLeaveAvailability();
    // A changed target retains its fields and fails the original-source check.
  }
  destroy() { this.close();this.stopLeave(); document.removeEventListener("mousedown", this.outside,true); controllers.delete(this.view); }
}
export const liveLinks = ViewPlugin.fromClass(LinkController, {
  eventHandlers: {
    pointerdown(event) {this.beginPointer(event,true);return false;},
    pointermove(event) {this.movePointer(event);return false;},
    pointerup() {this.pointerActive=false;return false;},
    pointercancel() {this.pointerActive=false;this.down=null;return false;},
    mousedown(event) {if(!this.pointerActive||!this.down?.pointer)this.beginPointer(event);return false;},
    mousemove(event) {this.movePointer(event);return false;},
    mouseup() {this.pointerActive=false;return false;},
    compositionstart() {this.pointerActive=false;this.down=null;return false;},
    click(event) {
      const down=this.down;this.down=null;this.pointerActive=false;
      // Ordinary text clicks belong to CodeMirror's actual DOM caret placement.
      if(!isMacLiveLinkOpen(event,this.view.dom)||composingLinkInput(this.view)||!down||!down.current()||down.button!==0||down.doc!==this.view.state.doc||down.dragged||
        Math.hypot(event.clientX-down.x,event.clientY-down.y)>4||!this.view.state.selection.main.empty)return false;
      const link=this.target(event);if(!link||!down.link||link.from!==down.link.from||link.to!==down.link.to||link.raw!==down.link.raw||link.target!==down.link.target)return false;
      event.preventDefault();this.open(link);return true;
    },
    mouseover(event) { this.over(event); return false; },
    mouseout(event) { this.out(event); return false; },
    contextmenu(event) {if(composingLinkInput(this.view)||this.pointerActive&&this.down?.dragged)return false;const link=this.target(event);if(!link)return false;event.preventDefault();this.show(link);return true;},
    scroll() { if (!this.editing) this.close(); return false; },
  },
});
