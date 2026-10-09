import {mountCellDraftAuxiliary,bindCellDraftAuxiliaryMore,type CellDraftAuxiliaryLease} from "./cellDraftAuxiliary";
import {bindHtmlDetailsDisplay} from './htmlDetailsDisplay';
import {bindTableCellTouch} from './tableCellTouch';
import {bindHtmlTableControlsPlacement} from './htmlTableControlsPlacement';
import {isMacLiveLinkOpen,activateRenderedLink} from './renderedLinks';
import {showLiveLinkActions,captureLiveLinkInteraction} from './liveLinks';
import {readReferenceObject} from './htmlReferenceDraft';
import {editingLeaveIsComposing} from './editingPreflight';
import {tableWidgetIsComposing} from './tableWidget';
import {htmlTableActions,registerTableActions} from './tableActionCatalog';
import {attachHtmlObjectEditing} from './htmlObjectEditing';
import {attachDomSemanticClipboard} from './contentClipboard';
import {indentHtmlLiteral,insertHtmlLiteral} from './htmlLiteralEditing';
import {EditorView} from '@codemirror/view';
import {displaySessionFor,resourceContext,sameResourceContextAuthority} from './editorHost';
import {editingControllerFor,sameEditingIdentity} from './editingController';
import {undo,redo,undoDepth,redoDepth} from '@codemirror/commands';
import {dispatchSourcePatches} from './editorPatches';
import {applyHtmlTableOperation,parseHtmlTable,htmlTableRectangle,htmlTableSelectedCells,type HtmlTableCell,type HtmlTableOperation,type HtmlTableModel,HtmlTableEditingError} from './htmlTableEditing';
import {sourcePreservingHtmlDraft} from './richHtmlDraft';
import {htmlTableCopy,prepareHtmlTablePaste,readHtmlTablePaste,htmlTableClipboardType,writeHtmlTableClipboard,readHtmlTableClipboard,type HtmlTableClipboardData,type HtmlTablePastePlan} from './htmlTableClipboard';
import {sanitizeRenderedHtml} from './renderKit';
import {setUILabel,setUIText,message,contextFor} from './uiContext';
import {type TablePosition,type TableRectangle} from './tableEditing';
import {exitSemanticObject} from './semanticEditing';
import './htmlTableWidget.css';

type HtmlCellDraftLease={panel:HTMLElement;current:()=>boolean};
type Mounted={draftLease:()=>HtmlCellDraftLease|null;commit:()=>boolean;composing:()=>boolean;command:(name:string)=>boolean;active:()=>boolean;editing:()=>boolean;canUndo:()=>boolean;canRedo:()=>boolean};
const mounted=new WeakMap<EditorView,Set<Mounted>>();
const projectionRefreshers=new WeakMap<HTMLElement,{view:EditorView;refresh:()=>boolean}>();
/** @internal Actual renderer capability; author DOM and Core consumers do not create it. */
export function bindHtmlTableProjectionRefresh(wrapper:HTMLElement,view:EditorView,refresh:()=>boolean):()=>void{
 const owner={view,refresh};projectionRefreshers.set(wrapper,owner);
 return()=>{if(projectionRefreshers.get(wrapper)===owner)projectionRefreshers.delete(wrapper);};
}
const selectionMemory=new WeakMap<EditorView,Map<string,{at:TablePosition;range:TableRectangle;anchor?:TablePosition}>>();
/** Real local-draft leases; a long-lived cell DOM never owns a reopened draft. */
export function captureHtmlTableDrafts(view:EditorView):readonly HtmlCellDraftLease[]{return [...mounted.get(view)??[]].flatMap(item=>{const lease=item.draftLease();return lease?[lease]:[];});}
export function commitHtmlTableDrafts(view:EditorView) {for(const item of mounted.get(view)??[])if(!item.commit())return false;return true;}
export function htmlTableWidgetIsComposing(view:EditorView) {return [...mounted.get(view)??[]].some(item=>item.active()&&item.composing());}
export function htmlTableWidgetOwnsFocus(view:EditorView) {return [...mounted.get(view)??[]].some(item=>item.active());}
export function executeHtmlTableCommand(view:EditorView,name:string) {return [...mounted.get(view)??[]].find(item=>item.active())?.command(name)??false;}
export function htmlTableWidgetIsEditing(view:EditorView){return [...mounted.get(view)??[]].some(item=>item.active()&&item.editing());}
export function focusedHtmlTableState(view:EditorView){
 if(!htmlTableWidgetOwnsFocus(view))return null;const editing=htmlTableWidgetIsEditing(view),composing=htmlTableWidgetIsComposing(view);
 const query=(command:string)=>{try{return editing&&document.queryCommandState?.(command)===true;}catch{return false;}};
 const active=[...mounted.get(view)??[]].find(item=>item.active()),selection=view.dom.ownerDocument.getSelection(),anchor=selection?.anchorNode,element=anchor instanceof Element?anchor:anchor?.parentElement,cell=element?.closest('.md-html-cell-editing'),mapped=!!cell&&!!selection?.focusNode&&cell.contains(selection.focusNode),literal=mapped&&!!element?.closest('pre'),code=editing&&mapped&&!literal&&!!element?.closest('code'),highlight=editing&&mapped&&!literal&&!!element?.closest('mark');
 return {bold:query('bold'),italic:query('italic'),underline:query('underline'),strike:query('strikeThrough'),subscript:query('subscript'),superscript:query('superscript'),code,highlight,task:false,heading:0,callout:null,calloutEnabled:false,canUndo:!composing&&(editing?!!active?.canUndo():undoDepth(view.state)>0),canRedo:!composing&&(editing?!!active?.canRedo():redoDepth(view.state)>0),inlineFormattingEnabled:editing&&!composing&&!literal&&!code,blockFormattingEnabled:false,toolbarEnabled:editing&&!composing,commandEnabled:editing&&!composing,tablePreviewFocused:!editing,widgetEditing:editing,composing};
}
/** Attach only to a complete, source-mappable HTML table. A failed mapping never rewrites its source. */
export function attachHtmlTableEditing(wrapper:HTMLElement,view:EditorView,from:number,source:string):(()=>void)|null {
  let model:HtmlTableModel;try{model=parseHtmlTable(source);}catch{return null;}
  const table=wrapper.querySelector('table');if(!table)return null;
  const rows=Array.from(table.querySelectorAll('tr')).filter(row=>row.closest('table')===table);
  const elements=new Map<HtmlTableCell,HTMLTableCellElement>();
  for(let r=0;r<rows.length;r++){const children=Array.from(rows[r].children).filter(node=>node instanceof HTMLTableCellElement) as HTMLTableCellElement[];if(children.length!==model.rows[r]?.cells.length)return null;children.forEach((element,i)=>elements.set(model.rows[r].cells[i],element));}
  if(rows.length!==model.rows.length)return null;
  wrapper.classList.add('cm-live-html-table');wrapper.dataset.htmlTableFrom=String(from);wrapper.dataset.htmlTableLength=String(source.length);table.setAttribute('role','grid');
  let rangeAnchor:TablePosition|undefined;
  let at:TablePosition={row:0,column:0},range:TableRectangle={from:at,to:at},draft:ReturnType<typeof sourcePreservingHtmlDraft>|undefined,draftCell:HTMLTableCellElement|undefined,originalNodes:ChildNode[]|undefined,composing=false,alive=true,dragging=false;
  const error=document.createElement('div');error.className='md-html-table-error';error.setAttribute('role','status');error.hidden=true;wrapper.append(error);
  let closeLinkMenu:(()=>void)|undefined;
  const closeLinkActions=()=>{closeLinkMenu?.();closeLinkMenu=undefined;};
  let placeControls=()=>{};
  let auxiliary:CellDraftAuxiliaryLease|null=null,stopAuxiliaryMore:(()=>void)|undefined;
  const clipboardButtons:HTMLButtonElement[]=[];
  let selectionVersion=0,pendingCopy=false,draftVersion=0,focusing=false;let objectEditing:ReturnType<typeof attachHtmlObjectEditing>|undefined;let draftCaret:Range|undefined,draftDirection:{anchor:Node;anchorOffset:number;focus:Node;focusOffset:number}|undefined;
  const rememberCaret=()=>{const selection=document.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):undefined;if(range&&draftCell?.contains(range.commonAncestorContainer)){draftCaret=range.cloneRange();if(selection?.anchorNode&&selection.focusNode)draftDirection={anchor:selection.anchorNode,anchorOffset:selection.anchorOffset,focus:selection.focusNode,focusOffset:selection.focusOffset};}};
  const restoreCaret=(force=false)=>{const selection=document.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):undefined;if(!force&&range&&draftCell?.contains(range.commonAncestorContainer))return;if(draftCaret&&draftCell?.contains(draftCaret.startContainer)&&draftCell.contains(draftCaret.endContainer)){if(draftDirection&&draftCell.contains(draftDirection.anchor)&&draftCell.contains(draftDirection.focus)&&selection?.setBaseAndExtent)selection.setBaseAndExtent(draftDirection.anchor,draftDirection.anchorOffset,draftDirection.focus,draftDirection.focusOffset);else{selection?.removeAllRanges();selection?.addRange(draftCaret);}}};
  document.addEventListener('selectionchange',rememberCaret);
  let memories=selectionMemory.get(view);if(!memories){memories=new Map();selectionMemory.set(view,memories);}
  const memoryKey=(value:string)=>from+'\n'+value,saved=memories.get(memoryKey(source));if(saved){at={...saved.at};range={from:{...saved.range.from},to:{...saved.range.to}};rangeAnchor=saved.anchor?{...saved.anchor}:undefined;}
  const remember=(value=source)=>{memories!.set(memoryKey(value),{at:{...at},range:{from:{...range.from},to:{...range.to}},anchor:rangeAnchor?{...rangeAnchor}:undefined});if(memories!.size>40)memories!.delete(memories!.keys().next().value!);};
  const notify=()=>{remember();clipboardButtons.forEach(button=>{button.disabled=!!draft||composing||pendingCopy||(button.dataset.htmlClipboardAction==='cut'&&readOnly());});wrapper.dataset.cellEditing=String(!!draft);wrapper.dataset.cellSelected=String(!!draft||[...elements.values()].some(node=>node.classList.contains('md-html-cell-selected')));placeControls();view.dom.dispatchEvent(new CustomEvent('tegg-html-table-state',{bubbles:true}));};
  const report=(value:unknown)=>{error.textContent=value instanceof Error?value.message:String(value);error.hidden=false;notify();};
  const readOnly=()=>view.state.readOnly||view.state.facet(EditorView.editable)===false;
  function current(){return alive&&view.state.doc.sliceString(from,from+source.length)===source;}
  const cell=()=>model.grid[at.row][at.column];
  const display=displaySessionFor(view),temporarySummaries=new WeakSet<Node>();
  const detailElements=()=>Array.from(table.querySelectorAll<HTMLDetailsElement>('details')).filter(details=>details.closest('table')===table);
  const detailsDisplay=bindHtmlDetailsDisplay(display,()=>detailElements().map((element,index)=>({element,from:from+index,to:from+source.length})),()=>!composing&&!view.composing);
  const rememberDetails=detailsDisplay.remember;
  const boundDetails=new WeakSet<HTMLDetailsElement>();
  const bindDetails=()=>{detailElements().forEach(details=>{
    if(!details.querySelector(':scope > summary')){const summary=document.createElement('summary');summary.dataset.teggTemporary='true';summary.dataset.placeholder=message(view.dom,'Details');setUILabel(summary,'Details');temporarySummaries.add(summary);details.prepend(summary);}
    if(boundDetails.has(details))return;boundDetails.add(details);
    details.querySelector(':scope > summary')?.addEventListener('click',event=>{if(composing||view.composing){event.preventDefault();event.stopPropagation();}});
  });detailsDisplay.sync();};

  function focus(target:TablePosition,extend=false,requestedRange?:TableRectangle) {
    if(draft&&!finish(true))return;
    const next=model.grid[Math.max(0,Math.min(model.rows.length-1,target.row))]?.[Math.max(0,Math.min(model.columns-1,target.column))];if(!next)return;
    if(!current()){queueMicrotask(()=>view.dom.querySelector<HTMLElement>('[data-html-table-from="'+from+'"]')?.dispatchEvent(new CustomEvent('tegg-html-table-focus',{detail:{target,extend,requestedRange}})));return;}
    selectionVersion++;at={row:Math.max(0,Math.min(model.rows.length-1,target.row)),column:Math.max(0,Math.min(model.columns-1,target.column))};range=requestedRange??(extend?{from:range.from,to:{row:Math.max(0,Math.min(model.rows.length-1,target.row)),column:Math.max(0,Math.min(model.columns-1,target.column))}}:{from:at,to:at});
    const rectangle=htmlTableRectangle(model,range),selected=new Set(htmlTableSelectedCells(model,rectangle));
    for(const [item,element]of elements){element.tabIndex=item===next?0:-1;element.classList.toggle('md-html-cell-selected',selected.has(item));element.setAttribute('aria-selected',String(selected.has(item)));}
    paintHandles();focusing=true;try{elements.get(next)?.focus({preventScroll:true});}finally{focusing=false;}elements.get(next)?.scrollIntoView?.({block:'nearest',inline:'nearest'});error.hidden=true;notify();
  }
  function run(operation:HtmlTableOperation,restore?:TablePosition) {
    if(composing||view.composing||readOnly()||!current()){report('The cell draft is retained. Finish input or restore write access before leaving.');return false;}
    try {const result=applyHtmlTableOperation(source,operation);if(!result.patches.length)return true;
      const patches=result.patches.map(patch=>({...patch,from:patch.from+from,to:patch.to+from}));
      remember();
      if(operation.type!=='delete-table'){const after=parseHtmlTable(result.source);const clamp=(point:TablePosition)=>({row:Math.min(point.row,after.rows.length-1),column:Math.min(point.column,after.columns-1)});const nextAt=clamp(restore??result.selection),nextRange=operation.type==='clear'?{from:clamp(range.from),to:clamp(range.to)}:{from:nextAt,to:nextAt};memories!.set(memoryKey(result.source),{at:nextAt,range:nextRange,anchor:rangeAnchor?clamp(rangeAnchor):undefined});}
      dispatchSourcePatches(view,patches,{isolateHistory:true,selection:operation.type==='delete-table'?{anchor:from}:undefined});
      if(operation.type==='delete-table'){view.focus();return true;}
      if(restore)queueMicrotask(()=>{const panel=view.dom.querySelector<HTMLElement>(`[data-html-table-from="${from}"]`);panel?.querySelector<HTMLElement>(`[data-html-row="${restore.row}"][data-html-column="${restore.column}"]`)?.focus({preventScroll:true});});return true;
    }catch(problem){if(problem instanceof HtmlTableEditingError&&problem.code==='delete-table-confirmation')confirmDelete();else report(problem);return false;}
  }
  function perform(operation:HtmlTableOperation) {
    const target={...at};if(!finish(true))return false;if(current())return run(operation,target);
    queueMicrotask(()=>view.dom.querySelector<HTMLElement>(`[data-html-table-from="${from}"]`)?.dispatchEvent(new CustomEvent('tegg-html-table-operation',{detail:{operation,target}})));return true;
  }
  wrapper.addEventListener('tegg-html-table-operation',event=>{const detail=(event as CustomEvent).detail;run(detail.operation,detail.target);});
  wrapper.addEventListener('tegg-html-table-focus',event=>{const detail=(event as CustomEvent).detail;focus(detail.target,detail.extend,detail.requestedRange);});
  wrapper.addEventListener('tegg-html-table-command',event=>{command((event as CustomEvent).detail);});
  // Bind detached interactions to this finite draft and its actual object nodes.
  // A sibling menu on the same parent view, or an authored class, is not owned.
  function ownsDraftInteraction(node:Node|null):boolean {
    if(!node)return false;if(wrapper.contains(node))return true;
    if(!alive||!draft||!draftCell?.isConnected||mounted.get(view)?.has(item)!==true)return false;
    if(auxiliary?.owns(node)||objectEditing?.ownsNode(node))return true;
    const link=captureLiveLinkInteraction(view),owner=link?.projectedOwner;
    return !!owner&&draftCell.contains(owner)&&draft.objects().some(object=>object.kind==='link'&&object.element===owner)&&!!link?.owns(node);
  }
  function finish(commit:boolean) {
    const ownedDraft=draft,ownedCell=draftCell;
    if(!commit&&draft){
      if(!alive||!draftCell?.isConnected||mounted.get(view)?.has(item)!==true||composing||view.composing||view.compositionStarted||objectEditing?.isComposing())return false;
      if(!current()){
        const renderer=projectionRefreshers.get(wrapper);
        if(renderer?.view===view&&renderer.refresh())return true;
        report('The cell draft is retained. Its current document projection could not be refreshed.');return false;
      }
    }
    if(!composing&&!view.composing)closeLinkActions();
    rememberDetails();
    if(!draft)return true;if(composing||view.composing)return false;if(objectEditing&&!(commit?objectEditing.prepare():objectEditing.cancel()))return false;
    if(!commit){
      // Cancelling an actual child publishes/aborts synchronously. Its Host may
      // change the parent document or start composition before control returns.
      if(!alive||draft!==ownedDraft||draftCell!==ownedCell||!ownedCell?.isConnected||mounted.get(view)?.has(item)!==true||composing||view.composing||view.compositionStarted||objectEditing?.isComposing())return false;
      if(!current()){
        const renderer=projectionRefreshers.get(wrapper);
        if(renderer?.view===view&&renderer.refresh())return true;
        report('The cell draft is retained. Its current document projection could not be refreshed.');return false;
      }
    }
    if(commit){let html;try{html=draft.serialize();}catch(problem){report(problem);return false;}if(html!==cell().content){if(!run({type:'cell',at,html},at))return false;auxiliary?.dispose();auxiliary=null;objectEditing?.dispose();objectEditing=undefined;draft=undefined;draftCell=undefined;originalNodes=undefined;draftHistory=[];notify();return true;}}
    auxiliary?.dispose();auxiliary=null;
    if(draftCell&&originalNodes){draftCell.replaceChildren(...originalNodes);bindDetails();draftCell.removeAttribute('contenteditable');draftCell.classList.remove('md-html-cell-editing');}
    objectEditing?.dispose();objectEditing=undefined;draft=undefined;draftCell=undefined;originalNodes=undefined;draftHistory=[];notify();return true;
  }
  function begin(replace?:string) {
    if(readOnly()||!current()||composing||view.composing)return false;if(draft)return true;
    if(htmlTableSelectedCells(model,range).length>1){report("Select one actual cell before editing its text.");return false;}
    const element=elements.get(cell())!;const original=Array.from(element.childNodes);
    const cloneForDraft=(node:Node):Node=>{const clone=node.cloneNode(false);for(const child of node.childNodes)if(!temporarySummaries.has(child))clone.appendChild(cloneForDraft(child));return clone;};
    const clones=original.map(cloneForDraft);element.replaceChildren(...clones);
    try{draft=sourcePreservingHtmlDraft(element,cell().content);}catch(problem){element.replaceChildren(...original);report(problem);return false;}
    draftCell=element;originalNodes=original;bindDetails();element.contentEditable='true';element.classList.add('md-html-cell-editing');element.focus({preventScroll:true});
    const selection=element.ownerDocument.getSelection(),caret=element.ownerDocument.createRange();caret.selectNodeContents(element);caret.collapse(false);selection?.removeAllRanges();selection?.addRange(caret);const ownedDraft=draft;objectEditing=attachHtmlObjectEditing(element,view,draft,{uiRoot:wrapper,linkActionsInMenu:true,draftCurrent:()=>alive&&draft===ownedDraft&&draftCell===element&&element.isConnected&&mounted.get(view)?.has(item)===true,readOnly,composing:()=>composing||view.composing,current,changed:recordDraft,report});rememberCaret();draftHistory=[captureDraft()];draftHistoryIndex=0;draftGroup=undefined;if(replace!==undefined){element.replaceChildren(document.createTextNode(replace));caret.selectNodeContents(element);caret.collapse(false);selection?.removeAllRanges();selection?.addRange(caret);recordDraft('replace');}mountAuxiliary(ownedDraft,element);notify();return true;
  }
  function move(key:string,shift=false) {
    const selected=cell();let target={...at};
    if(key==='Tab'){const ordered=model.cells,index=ordered.indexOf(selected),next=ordered[index+(shift?-1:1)];if(!next){exitSemanticObject(view,{from,to:from+source.length},!shift);return;}target={row:next.row,column:next.column};}
    else if(key==='Enter')target.row=shift?selected.row-1:selected.row+selected.rowspan;
    else if(key==='ArrowRight')target.column=selected.column+selected.colspan;
    else if(key==='ArrowLeft')target.column=selected.column-1;
    else if(key==='ArrowDown')target.row=selected.row+selected.rowspan;
    else if(key==='ArrowUp')target.row=selected.row-1;
    focus(target,shift&&key.startsWith('Arrow'));
  }
  function insertDraftText(text:string){
    if(!draftCell||composing||view.composing||readOnly()||!current())return false;
    draftGroup=undefined;
    {const selection=document.getSelection(),r=selection?.rangeCount?selection.getRangeAt(0):undefined;if(!r||!draftCell.contains(r.commonAncestorContainer))return false;r.deleteContents();const node=document.createTextNode(text);r.insertNode(node);r.setStartAfter(node);r.collapse(true);selection!.removeAllRanges();selection!.addRange(r);}
    recordDraft('insertText');draftGroup=undefined;return true;
  }
  type DraftCheckpoint={restore:()=>void;html:string;backward?:boolean;start?:{path:number[];offset:number};end?:{path:number[];offset:number}};
  let draftHistory:DraftCheckpoint[]=[],draftHistoryIndex=0,draftGroup:{inputType:string;time:number}|undefined;
  function captureDraft():DraftCheckpoint{
    const selection=document.getSelection(),r=selection?.rangeCount?selection.getRangeAt(0):undefined;
    const position=(node:Node,offset:number)=>{if(!draftCell?.contains(node))return undefined;const path:number[]=[];while(node!==draftCell){const parent=node.parentNode!;path.unshift(Array.prototype.indexOf.call(parent.childNodes,node));node=parent;}return {path,offset};};
    return {restore:draft!.snapshot(),html:draftCell!.innerHTML,backward:!!r&&!r.collapsed&&selection?.anchorNode===r.endContainer&&selection.anchorOffset===r.endOffset,start:r?position(r.startContainer,r.startOffset):undefined,end:r?position(r.endContainer,r.endOffset):undefined};
  }
  function recordDraft(inputType=''){
    if(!draft||!draftCell)return;rememberCaret();draft.markChanged();if(composing){notify();return;}
    const next=captureDraft(),previous=draftHistory[draftHistoryIndex],time=Date.now();
    if(previous?.html===next.html){notify();return;}
    const group=inputType==='insertText'&&draftGroup?.inputType===inputType&&time-draftGroup.time<500&&draftHistoryIndex===draftHistory.length-1&&draftHistoryIndex>0;
    draftVersion++;draftHistory.splice(draftHistoryIndex+1);if(group)draftHistory[draftHistoryIndex]=next;else{draftHistory.push(next);draftHistoryIndex++;if(draftHistory.length>100){draftHistory.shift();draftHistoryIndex--;}}
    draftGroup={inputType,time};notify();
  }
  function localHistory(redo:boolean){
    if(!draft||!draftCell||composing||view.composing||readOnly()||!current())return false;
    if(objectEditing&&!objectEditing.prepare())return false;const index=draftHistoryIndex+(redo?1:-1);if(index<0||index>=draftHistory.length)return true;
    draftVersion++;draftHistoryIndex=index;draftGroup=undefined;const snapshot=draftHistory[index];snapshot.restore();objectEditing?.refresh();bindDetails();
    const nodeAt=(path:number[])=>{let node:Node=draftCell!;for(const i of path){if(!node.childNodes[i])return undefined;node=node.childNodes[i];}return node;};
    draftCell.focus({preventScroll:true});
    const first=snapshot.start&&nodeAt(snapshot.start.path),last=snapshot.end&&nodeAt(snapshot.end.path),r=document.createRange();
    try{if(first&&last){r.setStart(first,Math.min(snapshot.start!.offset,first instanceof Text?first.length:first.childNodes.length));r.setEnd(last,Math.min(snapshot.end!.offset,last instanceof Text?last.length:last.childNodes.length));}else{r.selectNodeContents(draftCell);r.collapse(false);}const selection=document.getSelection();if(snapshot.backward&&selection?.setBaseAndExtent)selection.setBaseAndExtent(r.endContainer,r.endOffset,r.startContainer,r.startOffset);else{selection?.removeAllRanges();selection?.addRange(r);}}catch{}
    rememberCaret();notify();return true;
  }
  function insertParagraphFallback(){
    const selection=document.getSelection(),r=selection?.rangeCount?selection.getRangeAt(0):undefined;if(!r||!draftCell?.contains(r.commonAncestorContainer))return;
    r.deleteContents();
    if(r.startContainer===draftCell){const previous=draftCell.childNodes[r.startOffset-1],following=draftCell.childNodes[r.startOffset],matches=(node:Node|undefined):node is HTMLElement=>node instanceof HTMLElement&&node.matches('p,div,h1,h2,h3,h4,h5,h6,li');if(matches(previous)){r.setStart(previous,previous.childNodes.length);r.collapse(true);}else if(matches(following)){r.setStart(following,0);r.collapse(true);}else if(draftCell.querySelector('p,div,h1,h2,h3,h4,h5,h6,li')){const paragraph=document.createElement('p');paragraph.append(document.createElement('br'));r.insertNode(paragraph);r.selectNodeContents(paragraph);r.collapse(true);selection!.removeAllRanges();selection!.addRange(r);return;}}
    const element=r.startContainer instanceof Element?r.startContainer:r.startContainer.parentElement,block=element?.closest('p,div,h1,h2,h3,h4,h5,h6,li'),next=document.createElement('p');
    if(block&&draftCell.contains(block)&&block!==draftCell){const tail=r.cloneRange();tail.setEnd(block,block.childNodes.length);next.append(draft!.extractContents(tail));if(block.tagName==='LI'){const before=document.createElement('p');before.append(...Array.from(block.childNodes));block.append(before,next);}else block.after(next);}
    else{const tail=r.cloneRange();tail.setEnd(draftCell,draftCell.childNodes.length);next.append(draft!.extractContents(tail));const paragraph=document.createElement('p');paragraph.append(...Array.from(draftCell.childNodes));draftCell.append(paragraph,next);}
    if(!next.childNodes.length)next.append(document.createElement('br'));r.selectNodeContents(next);r.collapse(true);selection!.removeAllRanges();selection!.addRange(r);
  }
  function insertListItem(){
    const selection=document.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):undefined,anchor=range?.startContainer,element=anchor instanceof Element?anchor:anchor?.parentElement,item=element?.closest('li');
    if(!range||!draftCell?.contains(range.commonAncestorContainer)||!item||!draftCell.contains(item)||!item.parentElement?.matches('ul,ol')||!item.contains(range.endContainer))return false;
    range.deleteContents();const next=document.createElement('li'),tail=range.cloneRange();tail.setEnd(item,item.childNodes.length);next.append(draft!.extractContents(tail));item.after(next);if(!next.childNodes.length)next.append(document.createElement('br'));const caret=document.createRange();caret.selectNodeContents(next);caret.collapse(true);selection!.removeAllRanges();selection!.addRange(caret);recordDraft('insertListItem');return true;
  }
  const review=document.createElement('div');review.className='md-html-table-review';review.hidden=true;review.setAttribute('role','dialog');setUILabel(review,'Review table operation');
  const reviewMessage=document.createElement('p'),reviewData=document.createElement('pre'),reviewActions=document.createElement('div');review.append(reviewMessage,reviewData,reviewActions);wrapper.append(review);
  function closeReview(){review.hidden=true;reviewActions.replaceChildren();elements.get(cell())?.focus({preventScroll:true});}
  function showReview(message:string,text:string,actions:Array<[string,()=>void]>){
    reviewMessage.textContent=message;reviewData.textContent=text;reviewData.hidden=!text;reviewActions.replaceChildren();
    for(const [label,action]of [...actions,['Cancel',closeReview] as [string,()=>void]]){const button=document.createElement('button');button.type='button';setUIText(button,label);button.addEventListener('pointerdown',event=>event.preventDefault());button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();action();});reviewActions.append(button);}
    review.hidden=false;notify();
  }
  function confirmDelete(){if(composing||view.composing)return;if(draft){if(!finish(true))return;if(!current()){queueMicrotask(()=>view.dom.querySelector<HTMLElement>('[data-html-table-from="'+from+'"]')?.dispatchEvent(new CustomEvent('tegg-html-table-command',{detail:'table-delete'})));return;}}const captured=view.state.doc,version=selectionVersion;showReview('Delete this table? Undo can restore it.','',[['Delete table',()=>{if(captured!==view.state.doc||version!==selectionVersion||!current()){report('The table changed. Its content is retained.');return;}if(run({type:'delete-table'}))review.hidden=true;}]]);}
  async function copyCells(cut=false,eventData?:Pick<DataTransfer,'setData'>){
    if(draft||composing||view.composing||pendingCopy||!current())return false;const captured=view.state.doc,context=view.state.facet(resourceContext),version=selectionVersion,target={from:{...range.from},to:{...range.to}},restore={...at};
    pendingCopy=true;notify();
    try{await writeHtmlTableClipboard(wrapper,htmlTableCopy(model,target),eventData);
      if(cut){if(captured!==view.state.doc||view.state.facet(resourceContext)!==context||version!==selectionVersion||!current()||readOnly()||composing||view.composing){report('Copied, but not cut. The original table is retained.');return false;}if(!run({type:'clear',range:target},restore)){report('Copied, but not cut. The original table is retained.');return false;}}
      if(alive)report(cut?'Cut':'Copied');return true;
    }catch(problem){if(alive)report(problem);return false;}finally{pendingCopy=false;if(alive)notify();}
  }
  function applyPaste(plan:HtmlTablePastePlan,captured:typeof view.state.doc,version:number,context=view.state.facet(resourceContext)){
    if(captured!==view.state.doc||view.state.facet(resourceContext)!==context||version!==selectionVersion||!current()||readOnly()||composing||view.composing||draft){report('The table or selection changed. The clipboard input is retained.');return false;}
    if(!plan.patches.length){closeReview();return true;}remember();memories!.set(memoryKey(plan.source),{at:{...at},range:{from:{...range.from},to:{...range.to}},anchor:rangeAnchor?{...rangeAnchor}:undefined});
    review.hidden=true;dispatchSourcePatches(view,plan.patches.map(patch=>({...patch,from:patch.from+from,to:patch.to+from})),{isolateHistory:true});return true;
  }
  function processPaste(data:HtmlTableClipboardData,plain:boolean,captured:typeof view.state.doc,version:number,context=view.state.facet(resourceContext)){
    try{const matrix=readHtmlTablePaste({...data,plain}),plan=prepareHtmlTablePaste(source,range,matrix);
      if(plan.requiresConfirmation){const e=plan.expansion!;showReview('This paste expands the table to '+e.rows+' rows and '+e.columns+' columns; adds '+e.addedRows+' rows and '+e.addedColumns+' columns; overwrites rows '+(e.overwritten.from.row+1)+'–'+(e.overwritten.to.row+1)+', columns '+(e.overwritten.from.column+1)+'–'+(e.overwritten.to.column+1)+'.',data.text,[['Expand and paste',()=>{applyPaste(plan,captured,version,context);}]]);}else applyPaste(plan,captured,version,context);
    }catch(problem){showReview(problem instanceof Error?problem.message:String(problem),data.text,plain?[]:[['Paste plain text',()=>{processPaste(data,true,captured,version,context);}] ]);}
  }
  async function pasteClipboard(plain=false,fallback?:HtmlTableClipboardData){
    if(composing||view.composing||readOnly())return;const captured=view.state.doc,context=view.state.facet(resourceContext),version=selectionVersion,wasDraft=draft,wasDraftVersion=draftVersion,selection=document.getSelection(),caret=selection?.rangeCount?selection.getRangeAt(0).cloneRange():undefined;
    const valid=()=>captured===view.state.doc&&view.state.facet(resourceContext)===context&&version===selectionVersion&&current()&&!composing&&!view.composing&&!readOnly()&&draft===wasDraft&&draftVersion===wasDraftVersion;
    const sameCaret=()=>{const now=document.getSelection();return !!caret&&!!now?.rangeCount&&caret.compareBoundaryPoints(Range.START_TO_START,now.getRangeAt(0))===0&&caret.compareBoundaryPoints(Range.END_TO_END,now.getRangeAt(0))===0;};
    const restore=()=>{const selection=document.getSelection();selection?.removeAllRanges();selection?.addRange(caret!);};
    try{const data=await readHtmlTableClipboard(wrapper,fallback);
      if(!valid()||(draft&&!sameCaret())){report('The table, draft or selection changed. The clipboard input is retained.');return;}
      if(!draft){processPaste(data,plain,captured,version,context);return;}
      if(!caret||!draftCell?.contains(caret.commonAncestorContainer))return;
      const insertPlain=()=>{if(!valid()||!sameCaret()){report('The cell draft changed. The clipboard input is retained.');return;}restore();insertDraftText(data.text);closeReview();};
      if(plain||(!data.html&&!data.structured)){insertPlain();return;}
      try{
        const matrix=readHtmlTablePaste(data);
        if(matrix.rows!==1||matrix.columns!==1||matrix.cells.length!==1||matrix.cells[0].rowspan!==1||matrix.cells[0].colspan!==1)throw new Error('A table matrix cannot be distributed while editing cell text. Review a structure conversion or choose Paste plain text.');
        const controlled=sanitizeRenderedHtml(matrix.cells[0].html),template=document.createElement('template');template.innerHTML=controlled;
        const supported=new Set(['p','div','span','strong','b','em','i','u','s','del','mark','sub','sup','code','pre','br','ul','ol','li','blockquote','h1','h2','h3','h4','h5','h6','a','details','summary','figure','figcaption']);
        if([...template.content.querySelectorAll('*')].some(node=>!supported.has(node.tagName.toLowerCase())||node.hasAttribute('data-tegg-math')))throw new Error('This child object requires an explicit source-aware operation. The cell draft is retained.');
        const blocks=template.content.querySelectorAll('p,div,pre,ul,ol,li,blockquote,h1,h2,h3,h4,h5,h6,details,figure');
        if(blocks.length&&caret.startContainer!==draftCell){
          const only=template.content.firstElementChild;
          if(blocks.length===1&&only?.tagName==='P'&&template.content.childNodes.length===1)only.replaceWith(...Array.from(only.childNodes));
          else throw new Error('Rich blocks at this text caret require an explicit structure conversion. The cell draft is retained.');
        }
        if([...template.content.querySelectorAll('a')].some(node=>!/^(?:https?:|mailto:|#|\.\.?\/)/i.test(node.getAttribute('href')??'')))throw new Error('This link requires an explicit source-aware operation. The cell draft is retained.');
        const insert=()=>{if(!valid()||!sameCaret()){report('The cell draft changed. The clipboard input is retained.');return;}restore();caret.deleteContents();const fragment=template.content.cloneNode(true),last=fragment.lastChild;caret.insertNode(fragment);if(last){caret.setStartAfter(last);caret.collapse(true);const selection=document.getSelection();selection?.removeAllRanges();selection?.addRange(caret);}recordDraft('insertFromPaste');review.hidden=true;};
        if(template.content.querySelectorAll('p,div,pre,ul,ol,li,blockquote,h1,h2,h3,h4,h5,h6,details,figure').length>1)showReview('Insert this rich content into the current cell text selection? It remains one cell draft and does not overwrite neighboring cells.',data.text,[['Insert into cell',insert],['Paste plain text',insertPlain]]);
        else insert();
      }catch(problem){showReview(problem instanceof Error?problem.message:String(problem),data.text,[['Paste plain text',insertPlain]]);}
    }catch(problem){report(problem);}
  }
  const handles=['start','end'].map(endpoint=>{const handle=document.createElement('button');handle.type='button';handle.className='md-html-range-handle md-html-range-handle-'+endpoint;setUILabel(handle,endpoint==='start'?'Range start':'Range end');handle.hidden=true;wrapper.append(handle);
    handle.addEventListener('pointerdown',event=>{if(composing||draft)return;event.preventDefault();event.stopPropagation();handle.setPointerCapture?.(event.pointerId);});
    handle.addEventListener('pointermove',event=>{if(!handle.hasPointerCapture?.(event.pointerId))return;event.preventDefault();const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-html-row][data-html-column]');if(!target||!table.contains(target))return;const position={row:Number(target.dataset.htmlRow),column:Number(target.dataset.htmlColumn)};const requested=endpoint==='start'?{from:position,to:range.to}:{from:range.from,to:position};focus(position,true,requested);});
    handle.addEventListener('pointerup',event=>handle.releasePointerCapture?.(event.pointerId));return handle;});
  function paintHandles(){const coarse=wrapper.closest('.tegg-mobile')||globalThis.matchMedia?.('(pointer: coarse)').matches;if(!coarse){handles.forEach(handle=>handle.hidden=true);return;}const rectangle=htmlTableRectangle(model,range),first=elements.get(model.grid[rectangle.from.row][rectangle.from.column])!.getBoundingClientRect(),last=elements.get(model.grid[rectangle.to.row][rectangle.to.column])!.getBoundingClientRect(),outer=wrapper.getBoundingClientRect();const visible=!draft&&(last.right-first.left>=88||last.bottom-first.top>=88);handles.forEach((handle,index)=>{handle.hidden=!visible;handle.style.left=((index?last.right:first.left)-outer.left-22)+'px';handle.style.top=((index?last.bottom:first.top)-outer.top-22)+'px';});}
  const command=(name:string)=>{
    if(name==='table-cancel')return finish(false);
    if(draft&&(composing||view.composing||readOnly()||!current()))return false;
    if(draft){rememberCaret();restoreCaret(true);}
    if(name==='code'||name==='highlight'){
      if(!draftCell||composing)return false;const selection=document.getSelection(),r=selection?.rangeCount?selection.getRangeAt(0):undefined;
      if(!r||!draftCell.contains(r.commonAncestorContainer))return false;
      const anchor=selection!.anchorNode,element=anchor instanceof Element?anchor:anchor?.parentElement;
      if(element?.closest('pre')||r.cloneContents().querySelector('pre')||name==='highlight'&&element?.closest('code'))return false;
      const tag=name==='code'?'code':'mark',existing=element?.closest(tag);
      if(existing&&draftCell.contains(existing)&&existing.contains(r.commonAncestorContainer)){
        const nodes=Array.from(existing.childNodes),node=selection!.anchorNode,offset=selection!.anchorOffset,collapsed=r.collapsed;existing.replaceWith(...nodes);
        if(collapsed&&node?.isConnected){r.setStart(node,offset);r.collapse(true);}else if(nodes.length){r.setStartBefore(nodes[0]);r.setEndAfter(nodes[nodes.length-1]);}
      }else{if(r.collapsed)return false;const wrapper=document.createElement(tag);wrapper.append(r.extractContents());r.insertNode(wrapper);r.selectNodeContents(wrapper);}
      selection!.removeAllRanges();selection!.addRange(r);recordDraft('format');return true;
    }
    if(name==='undo'||name==='redo'){if(draft)return localHistory(name==='redo');if(composing||view.composing||readOnly()||!current())return false;return name==='undo'?undo(view):redo(view);}
    const inline:Record<string,string>={bold:'bold',italic:'italic',underline:'underline',strike:'strikeThrough',subscript:'subscript',superscript:'superscript'};
    if(inline[name]&&draftCell&&!composing){const anchor=document.getSelection()?.anchorNode,element=anchor instanceof Element?anchor:anchor?.parentElement;if(element?.closest('pre,code'))return false;draftCell.focus({preventScroll:true});restoreCaret(true);const applied=document.execCommand?.(inline[name])??false;if(applied)recordDraft('format');notify();return applied;}
    if(name==='table-range-start'||name==='table-range-end'){if(!finish(true))return false;if(!current()){queueMicrotask(()=>view.dom.querySelector<HTMLElement>('[data-html-table-from="'+from+'"]')?.dispatchEvent(new CustomEvent('tegg-html-table-command',{detail:name})));return true;}if(name==='table-range-start'){rangeAnchor={...at};remember();return true;}if(!rangeAnchor)return false;focus(at,true,{from:rangeAnchor,to:at});return true;}
    if(name==='table-delete'){confirmDelete();return true;}
    if(name==='table-copy'){void copyCells();return true;}if(name==='table-cut'){void copyCells(true);return true;}if(name==='table-paste'){void pasteClipboard();return true;}if(name==='table-paste-plain'){void pasteClipboard(true);return true;}
    if(name==='table-clear')return perform({type:'clear',range});
    if(name==='table-edit')return begin();if(name==='table-apply')return finish(true);
    if(name==='table-break'||name==='table-paragraph'||name==='table-empty-paragraph'||name==='table-list-item'){
      if(!begin()||!draftCell)return false;
      const selection=document.getSelection(),r=selection?.rangeCount?selection.getRangeAt(0):undefined;if(!r||!draftCell.contains(r.commonAncestorContainer))return false;
      if(name==='table-list-item')return insertListItem();
      if(name==='table-break'){let applied=false;try{applied=document.execCommand?.('insertLineBreak')??false;}catch{}if(!applied){const node=document.createElement('br');r.deleteContents();r.insertNode(node);r.setStartAfter(node);r.collapse(true);selection!.removeAllRanges();selection!.addRange(r);}recordDraft('insertLineBreak');return true;}
      if(name==='table-empty-paragraph'){insertParagraphFallback();const now=selection?.rangeCount?selection.getRangeAt(0):undefined,element=now?.startContainer instanceof Element?now.startContainer:now?.startContainer.parentElement,paragraph=element?.closest('p');if(!paragraph||!draftCell.contains(paragraph))return false;if(!paragraph.textContent&&!paragraph.querySelector('img,pre,table,[data-tegg-math]')){paragraph.dataset.teggTemporary='true';for(const child of paragraph.querySelectorAll('br'))child.dataset.teggTemporary='true';}const empty=document.createElement('p');empty.append(document.createElement('br'));paragraph.before(empty);const caret=document.createRange();caret.selectNodeContents(empty);caret.collapse(true);selection!.removeAllRanges();selection!.addRange(caret);recordDraft('insertParagraph');return true;}
      insertParagraphFallback();
      recordDraft('insertParagraph');return true;
    }return false;
  };
  const stopClipboard=attachDomSemanticClipboard(table,{readOnly,composing:()=>composing||view.composing,current:()=>!!draft&&current()});
  const item:Mounted={draftLease:()=>{
    if(!draft||!draftCell?.isConnected||!current())return null;
    const owner=draft,panel=draftCell,doc=view.state.doc,context=view.state.facet(resourceContext);
    return {panel,current:()=>mounted.get(view)?.has(item)===true&&draft===owner&&draftCell===panel&&
      panel.isConnected&&view.state.doc===doc&&view.state.facet(resourceContext)===context&&current()};
  },commit:()=>finish(true),composing:()=>composing,command,active:()=>wrapper.contains(document.activeElement)||!!auxiliary?.owns(document.activeElement),editing:()=>!!draft,canUndo:()=>draftHistoryIndex>0,canRedo:()=>draftHistoryIndex<draftHistory.length-1};
  let registry=mounted.get(view);if(!registry){registry=new Set();mounted.set(view,registry);}registry.add(item);
  const touchBindings:Array<()=>void>=[];
  for(const [item,element]of elements) {
    element.dataset.htmlRow=String(item.row);element.dataset.htmlColumn=String(item.column);element.tabIndex=item.row===0&&item.column===0?0:-1;
    setUILabel(element,'Cell {value}',{value:`${item.row+1}, ${item.column+1}`});
    element.addEventListener('focus',()=>{if(!draft&&!focusing){selectionVersion++;at={row:item.row,column:item.column};range={from:at,to:at};for(const [candidate,node]of elements){node.classList.toggle('md-html-cell-selected',candidate===item);node.setAttribute('aria-selected',String(candidate===item));}notify();}});
    const linkTarget=(target:EventTarget|null)=>{const node=target instanceof Element?target:target instanceof Node?target.parentElement:null,anchor=node?.closest('a');return anchor instanceof HTMLAnchorElement&&element.contains(anchor)&&anchor.closest('table')===table?anchor:null;};
    const linkDraft=(anchor:HTMLAnchorElement)=>{if(draftCell!==element||!draft||!draft.objects().some(object=>object.kind==='link'&&object.element===anchor))return null;const raw=draft.sourceFor(anchor);if(raw===undefined)return null;const fields=readReferenceObject(raw,false);return fields?.html?{raw,target:fields.url}:null;};
    let linkDown:{x:number;y:number;dragged:boolean;anchor:HTMLAnchorElement;owned?:{raw:string;target:string};current?:()=>boolean}|undefined;
    const linkCurrent=(anchor:HTMLAnchorElement,owned:NonNullable<ReturnType<typeof linkDraft>>,capturedDraft=draft)=>{const doc=view.state.doc,context={...view.state.facet(resourceContext)},controller=editingControllerFor(view),identity=controller?.identity;return()=>alive&&current()&&view.state.doc===doc&&sameResourceContextAuthority(context,view.state.facet(resourceContext))&&editingControllerFor(view)===controller&&(!identity||!!controller&&sameEditingIdentity(identity,controller.identity))&&draft===capturedDraft&&draftCell===element&&anchor.isConnected&&element.contains(anchor)&&draft?.sourceFor(anchor)===owned.raw&&!composing&&!view.composing&&!editingLeaveIsComposing(view)&&!tableWidgetIsComposing(view);};
    const openLink=(anchor:HTMLAnchorElement,owned:NonNullable<ReturnType<typeof linkDraft>>)=>{activateRenderedLink(anchor,owned.target,href=>view.dom.dispatchEvent(new CustomEvent('tegg-open-link',{detail:href,bubbles:true,cancelable:true})),view.dom);};
    element.addEventListener('pointerdown',event=>{const anchor=linkTarget(event.target);if(!anchor)return;closeLinkActions();const owned=linkDraft(anchor);linkDown={x:event.clientX,y:event.clientY,dragged:false,anchor,owned:owned??undefined,current:owned?linkCurrent(anchor,owned):undefined};if(isMacLiveLinkOpen(event,view.dom)||((composing||view.composing||editingLeaveIsComposing(view)||tableWidgetIsComposing(view))&&draftCell!==element)){event.preventDefault();event.stopPropagation();}});
    element.addEventListener('pointermove',event=>{if(linkDown&&event.buttons&&Math.hypot(event.clientX-linkDown.x,event.clientY-linkDown.y)>4)linkDown.dragged=true;});
    element.addEventListener('pointercancel',()=>{if(linkDown)linkDown.dragged=true;});
    element.addEventListener('click',event=>{const anchor=linkTarget(event.target);if(anchor)event.preventDefault();if(draftCell===element){draftGroup=undefined;if(anchor&&isMacLiveLinkOpen(event,view.dom)){event.stopPropagation();const down=linkDown;if(down)linkDown={...down,current:undefined,owned:undefined};if(down?.anchor===anchor&&!down.dragged&&Math.hypot(event.clientX-down.x,event.clientY-down.y)<=4&&down.owned&&down.current?.())openLink(anchor,down.owned);}return;}const target=event.target instanceof Element?event.target:event.target instanceof Node?event.target.parentElement:null;if(target?.closest('summary')?.parentElement instanceof HTMLDetailsElement&&target.closest('table')===table){event.stopPropagation();return;}if(composing||view.composing||editingLeaveIsComposing(view)||tableWidgetIsComposing(view)||!current()){if(anchor)event.stopPropagation();return;}if((event.metaKey||event.ctrlKey)&&!anchor)return;event.preventDefault();event.stopPropagation();focus({row:item.row,column:item.column},event.shiftKey);});
    element.addEventListener('contextmenu',event=>{const anchor=linkTarget(event.target);if(!anchor||draftCell!==element)return;const owned=linkDraft(anchor);if(!owned)return;event.preventDefault();event.stopPropagation();if(linkDown?.dragged||!linkCurrent(anchor,owned)())return;closeLinkActions();rememberCaret();const valid=linkCurrent(anchor,owned);closeLinkMenu=showLiveLinkActions(view,{owner:anchor,target:owned.target,current:valid,open:()=>{if(valid())openLink(anchor,owned);},edit:readOnly()?undefined:()=>{if(valid()&&!readOnly())objectEditing?.editLink(anchor);},restoreFocus:()=>{if(valid()){element.focus({preventScroll:true});restoreCaret(true);}}});});
    element.addEventListener('dblclick',event=>{event.preventDefault();event.stopPropagation();focus({row:item.row,column:item.column});begin();});
    touchBindings.push(bindTableCellTouch(element,{allowLinks:true,enabled:()=>!draft&&!readOnly()&&!composing&&!view.composing,selected:()=>at.row===item.row&&at.column===item.column,select:()=>focus({row:item.row,column:item.column}),edit:()=>{focus({row:item.row,column:item.column});begin();}}));
    element.addEventListener('pointerdown',event=>{
      const target=event.target instanceof Element?event.target:event.target instanceof Node?event.target.parentElement:null;
      if(event.pointerType==='touch'&&readOnly()&&!draft&&!composing&&!view.composing&&target&&!target.closest('input,textarea,select,summary,.md-html-object-actions,.md-object-toolbar')){
        event.preventDefault();event.stopPropagation();focus({row:item.row,column:item.column},event.shiftKey);return;
      }
      if(event.pointerType==='mouse'&&draftCell!==element){if(draft&&!finish(true))return;dragging=true;focus({row:item.row,column:item.column},event.shiftKey);}
    });
    element.addEventListener('pointerenter',()=>{if(dragging)focus({row:item.row,column:item.column},true);});
    element.addEventListener('beforeinput',event=>{const input=event as InputEvent;if(draft&&draftCell&&!composing&&!view.composing&&!readOnly()&&current()&&!input.isComposing&&input.inputType==='insertText'&&input.data!==null){const selection=draftCell.ownerDocument.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):undefined,element=range?.startContainer instanceof Element?range.startContainer:range?.startContainer.parentElement;if(range&&element&&!element.closest('pre,code')&&draft.insertMappedText(range,input.data)){event.preventDefault();event.stopPropagation();recordDraft('insertText');return;}}if(draft&&!composing&&(input.inputType==='historyUndo'||input.inputType==='historyRedo')){event.preventDefault();event.stopPropagation();localHistory(input.inputType==='historyRedo');}});
    element.addEventListener('input',event=>{closeLinkActions();recordDraft((event as InputEvent).inputType);});
    element.addEventListener('compositionstart',()=>{linkDown=undefined;composing=true;notify();});element.addEventListener('compositionend',()=>{composing=false;recordDraft('insertCompositionText');queueMicrotask(detailsDisplay.sync);notify();});
    element.addEventListener('keydown',event=>{
      if(event.isComposing||composing||view.composing||event.keyCode===229)return;
      if(!draft&&(event.metaKey||event.ctrlKey)&&!event.altKey&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();event.stopPropagation();command(event.shiftKey||event.key.toLowerCase()==='y'?'redo':'undo');return;}
      if(draft&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))draftGroup=undefined;
      if(event.key==='Enter'&&event.altKey&&(event.metaKey||event.ctrlKey)){event.preventDefault();event.stopPropagation();command('table-break');return;}
      if(!draft&&event.key==='Enter'&&event.metaKey){event.preventDefault();event.stopPropagation();exitSemanticObject(view,{from,to:from+source.length},true);return;}
      if(!draft&&event.ctrlKey&&event.key.toLowerCase()==='u'){event.preventDefault();event.stopPropagation();begin();return;}
      if(draft&&(event.metaKey||event.ctrlKey)&&!event.altKey&&['b','i','u'].includes(event.key.toLowerCase())){event.preventDefault();event.stopPropagation();command(({b:'bold',i:'italic',u:'underline'} as Record<string,string>)[event.key.toLowerCase()]);return;}
      if(draft){if((event.metaKey||event.ctrlKey)&&!event.altKey&&(event.key.toLowerCase()==='z'||event.key.toLowerCase()==='y')){event.preventDefault();event.stopPropagation();command(event.shiftKey||event.key.toLowerCase()==='y'?'redo':'undo');return;}const anchor=document.getSelection()?.anchorNode,container=anchor instanceof Element?anchor:anchor?.parentElement,code=container?.closest('pre');
        const summary=container?.closest('summary'),details=summary?.parentElement;
        if(event.key==='Enter'&&!event.altKey&&summary&&details instanceof HTMLDetailsElement){event.preventDefault();event.stopPropagation();if(event.shiftKey)command('table-break');else{details.open=true;let body=Array.from(details.children).find(node=>node!==summary) as HTMLElement|undefined;if(!body){body=document.createElement('p');body.dataset.teggTemporary='true';const placeholder=document.createElement('br');placeholder.dataset.teggTemporary='true';body.append(placeholder);summary.after(body);}rememberDetails();const caret=document.createRange();caret.selectNodeContents(body);caret.collapse(true);const selection=document.getSelection();selection?.removeAllRanges();selection?.addRange(caret);notify();}return;}
        if(code&&['Enter','Tab','Escape'].includes(event.key)){event.preventDefault();event.stopPropagation();if(event.key==='Escape'||(event.key==='Enter'&&event.metaKey)){const selection=document.getSelection(),caret=document.createRange();if(event.key==='Enter'&&event.shiftKey)caret.setStartBefore(code);else caret.setStartAfter(code);caret.collapse(true);selection?.removeAllRanges();selection?.addRange(caret);}else if(event.key==='Tab'){draftGroup=undefined;if(indentHtmlLiteral(code as HTMLElement,event.shiftKey))recordDraft('indentCode');draftGroup=undefined;}else{draftGroup=undefined;if(insertHtmlLiteral(code as HTMLElement,'\n'))recordDraft('insertLineBreak');draftGroup=undefined;}notify();return;}
        if(event.key==='Enter'&&event.metaKey){event.preventDefault();event.stopPropagation();if(finish(true))focus(at);return;}
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(false);focus(at);}else if((event.key==='Enter'&&!event.altKey)||event.key==='Tab'){const anchor=document.getSelection()?.anchorNode,container=anchor instanceof Element?anchor:anchor?.parentElement;if(container?.closest('[data-tegg-math]'))return;event.preventDefault();event.stopPropagation();const key=event.key,shift=event.shiftKey;if(finish(true))queueMicrotask(()=>{const panel=view.dom.querySelector<HTMLElement>(`[data-html-table-from="${from}"]`);const target=model.cells[model.cells.indexOf(item)+(key==='Tab'?(shift?-1:1):0)];if(key==='Tab'&&!target){exitSemanticObject(view,{from,to:from+Number(panel?.dataset.htmlTableLength??source.length)},!shift);return;}const row=key==='Enter'?item.row+(shift?-1:item.rowspan):target?.row??item.row,column=key==='Enter'?item.column:target?.column??item.column;const owner=model.grid[Math.max(0,Math.min(model.rows.length-1,row))][Math.max(0,Math.min(model.columns-1,column))];panel?.querySelector<HTMLElement>(`[data-html-row="${owner.row}"][data-html-column="${owner.column}"]`)?.focus();});}return;}
      if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Tab'].includes(event.key)){event.preventDefault();event.stopPropagation();move(event.key,event.shiftKey);}
      else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();focus(range.from);}
      else if(event.key==='F2'){event.preventDefault();event.stopPropagation();begin();}
      else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();event.stopPropagation();run({type:'clear',range},at);}
      else if(event.key.length===1&&!event.metaKey&&!event.ctrlKey&&!event.altKey){event.preventDefault();event.stopPropagation();begin(event.key);}
    });
    element.addEventListener('paste',event=>{
      if(composing||event.clipboardData===null)return;event.preventDefault();event.stopPropagation();
      if(readOnly()){report('This document is read-only. The clipboard input is retained.');return;}
      const captured={text:event.clipboardData.getData('text/plain'),html:event.clipboardData.getData('text/html'),structured:event.clipboardData.getData(htmlTableClipboardType)||event.clipboardData.getData('web '+htmlTableClipboardType)};
      void pasteClipboard(false,captured);
    });
    const copy=(event:ClipboardEvent,cut=false)=>{
      if(draft)return;event.preventDefault();event.stopPropagation();if(composing||view.composing)return;void copyCells(cut,event.clipboardData??undefined);
    };
    element.addEventListener('copy',event=>copy(event));element.addEventListener('cut',event=>copy(event,true));

  }
  const controls=document.createElement('div');controls.className='md-html-table-controls';controls.setAttribute('role','group');setUILabel(controls,'Table actions');
  const button=(label:string,runAction:()=>void)=>{const button=document.createElement('button');button.type='button';setUIText(button,label);button.addEventListener('pointerdown',()=>{if(draft)rememberCaret();});button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();runAction();});return button;};
  const editCell=button('Edit cell',()=>runTableAction('edit-cell')),cancel=button('Cancel',()=>finish(false)),done=button('Done',()=>finish(true)),lineBreak=button('Line break',()=>command('table-break'));
  controls.append(editCell,cancel,done,lineBreak);
  const more=document.createElement('details'),summary=document.createElement('summary');setUIText(summary,'More');summary.addEventListener('pointerdown',()=>{if(draft)rememberCaret();});const menu=document.createElement('div');
  const actionHandlers:Record<string,()=>boolean|void>={
    'edit-cell':()=>begin(),
    'copy-cells':()=>{void copyCells();}, 'cut-cells':()=>{void copyCells(true);},
    'paste-cells':()=>{void pasteClipboard();}, 'paste-plain':()=>{void pasteClipboard(true);},
    'delete-table':()=>confirmDelete(), 'insert-paragraph':()=>command('table-paragraph'),
    'insert-list-item':()=>command('table-list-item'), 'keep-empty-paragraph':()=>command('table-empty-paragraph'),
    'range-start':()=>command('table-range-start'), 'range-end':()=>command('table-range-end'),
    'clear-content':()=>perform({type:'clear',range}), 'merge-cells':()=>perform({type:'merge',range}),
    'unmerge-cell':()=>perform({type:'unmerge',at}), 'row-below':()=>perform({type:'insert-row',index:cell().row+cell().rowspan}),
    'column-after':()=>perform({type:'insert-column',index:cell().column+cell().colspan}),
    'delete-row':()=>perform({type:'delete-row',index:at.row}), 'delete-column':()=>perform({type:'delete-column',index:at.column}),
  };
  const runTableAction=(id:string)=>{const action=actionHandlers[id];return !!action&&action()!==false;};
  for(const {id,label}of htmlTableActions.filter(item=>item.id!=='edit-cell')){const entry=button(label,()=>{runTableAction(id);more.open=false;});if(id==='copy-cells'||id==='cut-cells'){entry.dataset.htmlClipboardAction=id==='cut-cells'?'cut':'copy';clipboardButtons.push(entry);}menu.append(entry);}more.append(summary,menu);controls.append(more);wrapper.append(controls);
  function mountAuxiliary(owner:NonNullable<typeof draft>,element:HTMLTableCellElement){
    const host=contextFor(view.dom).cellDraftAuxiliary;if(!host)return;
    const group=document.createElement('div');group.className='md-cell-draft-auxiliary-controls';group.setAttribute('role','group');setUILabel(group,'Table actions');group.append(cancel,done,lineBreak,more);controls.append(group);
    const previousHidden=controls.hidden;
    auxiliary=mountCellDraftAuxiliary(view,{kind:'html',owner:element,controls:group,actions:{cancel,done,lineBreak,more},draftToken:owner,current:()=>alive&&draft===owner&&draftCell===element&&element.isConnected&&mounted.get(view)?.has(item)===true,composing:()=>composing||view.composing||!!view.compositionStarted||!!objectEditing?.isComposing()||editingLeaveIsComposing(view),releaseControls:()=>{stopAuxiliaryMore?.();stopAuxiliaryMore=undefined;controls.append(cancel,done,lineBreak,more);group.remove();controls.hidden=previousHidden;}},host);
    if(auxiliary){controls.hidden=true;stopAuxiliaryMore=bindCellDraftAuxiliaryMore(view,auxiliary,more,menu);}
  }
  const controlsPlacement=bindHtmlTableControlsPlacement(wrapper,table,controls,()=>draftCell??elements.get(cell()));placeControls=controlsPlacement.sync;
  const stopTableActions=registerTableActions(view,{panel:wrapper,kind:'html',from:()=>from,containsPreview:node=>[...elements.values()].some(element=>element.contains(node)),capture(){
    if(!current()||draft||pendingCopy||composing||view.composing||!review.hidden)return null;
    const doc=view.state.doc,context=view.state.facet(resourceContext),version=selectionVersion,readonly=readOnly();
    const active=()=>current()&&!draft&&!pendingCopy&&!composing&&!view.composing&&readOnly()===readonly&&review.hidden&&view.state.doc===doc&&view.state.facet(resourceContext)===context&&selectionVersion===version;
    return {readOnly:readonly,current:active,execute:id=>active()&&(!readonly||id==='copy-cells')&&runTableAction(id)};
  }});
  const layoutFocus=(event:Event)=>{
    if(!alive||!wrapper.isConnected)return;
    const active=document.activeElement,hidden=(event as CustomEvent<{hiddenControls?:readonly HTMLElement[]}>).detail?.hiddenControls;
    if(!(active instanceof HTMLElement)||!controls.contains(active)||!hidden?.some(node=>node instanceof HTMLElement&&controls.contains(node)&&node.contains(active)))return;
    if(composing||view.composing){event.preventDefault();return;}
    if(draft&&draftCell){draftCell.focus({preventScroll:true});restoreCaret(true);}
    else{focusing=true;try{elements.get(cell())?.focus({preventScroll:true});}finally{focusing=false;}}
  };
  wrapper.addEventListener('tegg-table-controls-layout',layoutFocus);
  bindDetails();
  if(saved){const selected=new Set(htmlTableSelectedCells(model,range));for(const [candidate,node]of elements){node.classList.toggle('md-html-cell-selected',selected.has(candidate));node.setAttribute('aria-selected',String(selected.has(candidate)));}}notify();
  const pointerUp=()=>{dragging=false;};const outside=(event:PointerEvent)=>{
    const target=event.target instanceof Node?event.target:null;
    if(draft&&target&&!ownsDraftInteraction(target)&&!finish(true)){
      event.preventDefault();event.stopImmediatePropagation();
      // A real child C4 choice/field owns focus after prepare. Never steal an
      // IME field or its default Keep action to refocus the parent cell.
      if(!composing&&!view.composing&&!view.compositionStarted&&!objectEditing?.isComposing()&&!editingLeaveIsComposing(view)&&!ownsDraftInteraction(document.activeElement))draftCell?.focus();
    }
  };
  document.addEventListener('pointerup',pointerUp);document.addEventListener('pointerdown',outside,true);
  return ()=>{alive=false;auxiliary?.dispose();auxiliary=null;controlsPlacement.dispose();closeLinkActions();wrapper.removeEventListener('tegg-table-controls-layout',layoutFocus);stopTableActions();detailsDisplay.dispose();touchBindings.forEach(stop=>stop());objectEditing?.dispose();stopClipboard();document.removeEventListener('selectionchange',rememberCaret);alive=false;registry!.delete(item);document.removeEventListener('pointerup',pointerUp);document.removeEventListener('pointerdown',outside,true);};
}
