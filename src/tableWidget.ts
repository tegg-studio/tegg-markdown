import {tableCellCaret} from './tableCellCaret';
import {mountCellDraftAuxiliary,bindCellDraftAuxiliaryMore,cellDraftAuxiliaryAt,type CellDraftAuxiliaryLease} from "./cellDraftAuxiliary";
import {bindTableCellTouch} from './tableCellTouch';
import {gfmTableActions,registerTableActions} from './tableActionCatalog';
import {requestSemanticClipboardRead} from './clipboardTransport';
import {registerReferenceLinkContext,referenceLinkContext,referenceDocumentSource} from './referenceLinkEditing';
import {applySourcePatches,validateSourcePatches,type SourcePatch} from './sourcePatch';
import {nestedInlineProjection} from './nestedEditingScope';
import {prepareEditingLeave} from './editingLeave';
import {semanticClipboardExtension,captureEditorClipboardSelection,readContentClipboard} from './contentClipboard';
import {markdownTableCopy,prepareMarkdownTablePaste,convertMarkdownTable} from './markdownTableClipboard';
import {writeHtmlTableClipboard,readHtmlTableClipboard,htmlTableClipboardType,type HtmlTableClipboardData} from './htmlTableClipboard';
import {attachNestedEditingScope as attachNestedEditingUI} from './nestedEditingScope';
import {prepareIndependentEditingLeave} from './editingPreflight';
import {bindContentScroll} from './contentScroll';
import {displaySessionFor} from './editorHost';
import {undo, redo} from "./selectionHistory";
import {history,isolateHistory} from '@codemirror/commands';
import {exitSemanticObject} from './semanticEditing';
import {WidgetType, EditorView} from '@codemirror/view';
import {EditorState,Transaction,StateEffect,StateField,ChangeSet} from '@codemirror/state';
import {markdown} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {editorToolbarState,executeEditorCommand,type EditorToolbarState} from './editorToolbar';
import {tableCellProjection} from './tableCellProjection';
import {editCurrentLink,liveLinks,captureLiveLinkInteraction} from './liveLinks';

import {resourceContext} from './editorHost';
import {parseMarkdownTable} from './table';
import {applyTableOperation,copyTableRectangle,nextTablePosition,TableEditingError,type TablePosition,type TableRectangle,type TableOperation} from './tableEditing';
import {captureClipboard,preparePaste,type PastePreparation,type ClipboardInput} from './clipboard';
import {dispatchSourcePatches} from './editorPatches';
import {parserFor} from './markdownParser';
import {sanitizeRenderedHtml} from './renderKit';
import {setUIText,setUILabel,contextFor,message} from './uiContext';
import {makeHorizontalScrollRegion} from './localScroll';
import './tableEditing.css';

export const tableSourceRequest=StateEffect.define<{from:number;to:number}|null>();
export const tableSourceState=StateField.define<{from:number;to:number}|null>({create:()=>null,update(value,tr){if(value&&tr.docChanged)value={from:tr.changes.mapPos(value.from),to:tr.changes.mapPos(value.to)};for(const effect of tr.effects)if(effect.is(tableSourceRequest))value=effect.value;if(value&&tr.selection&&!(tr.newSelection.main.head>=value.from&&tr.newSelection.main.head<=value.to))value=null;return value;}});
type FocusRequest={from:number;at:TablePosition;edit:boolean};
type ActiveCell={editor:EditorView;nested:ReturnType<typeof attachNestedEditingUI>;history:(redo:boolean)=>boolean;composing:()=>boolean;ownsFocus:()=>boolean};
const activeCells=new WeakMap<EditorView,ActiveCell>();
const inlineCellCommands=new Set(['bold','italic','underline','strike','highlight','subscript','superscript','code','link','wikilink']);
// Capturing rich paste precedes CodeMirror's own paste handler. The browser may
// already have changed a DOM selection that its observer has not read yet.
function clipboardCellRange(view:EditorView){
  const selected=view.dom.ownerDocument.getSelection();
  if(selected?.anchorNode&&selected.focusNode&&view.contentDOM.contains(selected.anchorNode)&&view.contentDOM.contains(selected.focusNode)){
    try{const anchor=view.posAtDOM(selected.anchorNode,selected.anchorOffset),head=view.posAtDOM(selected.focusNode,selected.focusOffset);
      if(anchor>=0&&head>=0&&anchor<=view.state.doc.length&&head<=view.state.doc.length){
        if(view.state.selection.main.anchor!==anchor||view.state.selection.main.head!==head)view.dispatch({selection:{anchor,head}});
        return {from:Math.min(anchor,head),to:Math.max(anchor,head)};
      }
    }catch{/* A DOM node being replaced cannot provide a reliable position. */}
  }
  return {from:view.state.selection.main.from,to:view.state.selection.main.to};
}

function activeCellForCommand(view:EditorView){const active=activeCells.get(view);return active?.editor.dom.isConnected&&(active.editor.hasFocus||active.ownsFocus())?active:null;}
/** A focused table control owns keyboard context even after its cell editor exits. */
export function tableWidgetOwnsFocus(view:EditorView):boolean {
  const active=view.dom.ownerDocument.activeElement;
  const panel=active instanceof Element&&view.dom.contains(active)?active.closest<HTMLElement>('.cm-live-table'):null;
  return !!cellDraftAuxiliaryAt(view,active)||!!panel&&!!viewPanels.get(view)?.has(panel)&&mounted.has(panel);
}
/** A table cell has a transient view, but the outer CodeMirror document owns history. */
export function focusedTableCell(view:EditorView):EditorView|null {
  return activeCellForCommand(view)?.editor??null;
}
export function tableWidgetIsComposing(view:EditorView):boolean {
  const active=activeCellForCommand(view);
  return view.composing||!!active&&(active.editor.composing||active.composing());
}
export function focusedTableToolbarState(view:EditorView):EditorToolbarState|null {
  const cell=focusedTableCell(view);
  if(cell)return editorToolbarState(cell.state);
  if(!tableWidgetOwnsFocus(view))return null;
  return {mixed:[],inlineFormattingEnabled:false,bold:false,italic:false,code:false,
    underline:false,strike:false,highlight:false,subscript:false,superscript:false,
    task:false,heading:0,callout:null,calloutEnabled:false,calloutContext:''};
}
export function routeTableCommand(view:EditorView,name:string):boolean {const active=activeCellForCommand(view);if(!active?.nested||view.state.readOnly||tableWidgetIsComposing(view))return false;const objects:Record<string,string>={formula:'math',math:'math',image:'image',mermaid:'mermaid',graphviz:'graphviz'};if(name==='link')return editCurrentLink(active.editor);if(!objects[name]&&name!=='edit-object')return false;active.nested.ui.openObject(objects[name] as Parameters<typeof active.nested.ui.openObject>[0]);return true;}
export function executeFocusedTableCommand(view:EditorView,command:string):boolean {
  const active=activeCellForCommand(view);
  if(!active){
    if(!tableWidgetOwnsFocus(view))return false;
    const panel=view.dom.ownerDocument.activeElement?.closest<HTMLElement>('.cm-live-table');
    if(mounted.get(panel!)?.command(command))return true;
    if(command==='undo'||command==='redo'){
      const panel=view.dom.ownerDocument.activeElement?.closest<HTMLElement>('.cm-live-table');
      mounted.get(panel!)?.history(command==='redo');
    }
    // A preview/control has no text selection. Never apply a command to the
    // outer view's retained selection in a different block.
    return true;
  }
  if(view.state.readOnly||tableWidgetIsComposing(view))return true;
  if(command==='undo'||command==='redo'){
    if(!view.state.readOnly&&!view.composing&&!active.editor.composing)active.history(command==='redo');
    return true;
  }
  if(command.startsWith('table-')){const panel=active.editor.dom.closest<HTMLElement>('.cm-live-table');return mounted.get(panel!)?.command(command)??false;}
  if(routeTableCommand(view,command))return true;
  if(!inlineCellCommands.has(command))return true;
  if(command==='link'&&editCurrentLink(active.editor))return true;
  executeEditorCommand(active.editor,command,'live');
  if(command==='link')editCurrentLink(active.editor);
  return true;
}
const focusRequests=new WeakMap<EditorView,FocusRequest>();
const mounted=new WeakMap<HTMLElement,{update(source:string,from:number,to:number):boolean;history(redo:boolean):boolean;commit():boolean;command(name:string):boolean;destroy():void}>();
const viewPanels=new WeakMap<EditorView,Set<HTMLElement>>();
const rangeMemory=new WeakMap<EditorView,Map<string,{selected:TablePosition;rectangle:TableRectangle;anchor:TablePosition|null}>>();
/** Finish valid cell drafts before a Host changes mode/document or closes its editor. */
export function commitTableDrafts(view:EditorView):boolean {
  for(const panel of viewPanels.get(view)??[])if(!mounted.get(panel)?.commit())return false;
  return true;
}
export class EditableTableWidget extends WidgetType {
  constructor(readonly source:string,readonly from:number,readonly to:number){super();}
  eq(other:WidgetType){return other instanceof EditableTableWidget&&other.source===this.source&&other.from===this.from&&other.to===this.to;}
  updateDOM(dom:HTMLElement){return mounted.get(dom)?.update(this.source,this.from,this.to)??false;}
  toDOM(view:EditorView){
    const labelCell=(node:HTMLElement,value:string)=>setUILabel(node,'Table cell: {value}',{get value(){return value||message(view.dom,'Empty');}});
    let source=this.source,from=this.from,to=this.to,latest=this.source,stale=false,destroyed=false;
    let selected:TablePosition={row:0,column:0},anchor:TablePosition|null=null,rectangle:TableRectangle={from:selected,to:selected};
    let editing:{at:TablePosition;input:HTMLInputElement;original:string;preview:HTMLButtonElement;composing:boolean;lastMirrored:string;editor?:EditorView;nested?:ReturnType<typeof attachNestedEditingUI>;mount?:HTMLElement;pendingResources?:boolean;cancelResource?:()=>void;referenceCleanup?:()=>void;referencePatches?:readonly SourcePatch[];referenceSource?:string;auxiliary?:CellDraftAuxiliaryLease}|null=null;
    let ownSource:string|null=null,acceptHistory=false,rebuilding=false;
    let selectionVersion=0,pendingCopy=false;
    let pendingCommit:{source:string;doc:typeof view.state.doc;selectedVersion:number}|null=null;
    let pendingPaste:PastePreparation|null=null,pendingOperation:TableOperation|null=null;
    let pendingCellPaste:{prepared:PastePreparation;child:EditorView;range:{from:number;to:number}}|null=null;
    const panel=document.createElement('section');panel.className='cm-live-table md-render-table';panel.dataset.teggTableFrom=String(from);panel.dataset.sourceFrom=String(from);panel.dataset.sourceTo=String(to);
    makeHorizontalScrollRegion(panel,'Editable table. Scroll horizontally for more columns.');
    const session=displaySessionFor(view),id=session.objectId('table',from,to),stopScroll=bindContentScroll(panel,session,'table',()=>({from,to}));let memory=rangeMemory.get(view);if(!memory){memory=new Map();rangeMemory.set(view,memory);}const memoryKey=(value:string)=>id+'\n'+value,saved=memory.get(memoryKey(source));if(saved){selected={...saved.selected};rectangle={from:{...saved.rectangle.from},to:{...saved.rectangle.to}};anchor=saved.anchor?{...saved.anchor}:null;}
    const remember=(value=source)=>{memory!.set(memoryKey(value),{selected:{...selected},rectangle:{from:{...rectangle.from},to:{...rectangle.to}},anchor:anchor?{...anchor}:null});if(memory!.size>80)memory!.delete(memory!.keys().next().value!);};
    const error=document.createElement('div');error.className='md-table-error';error.setAttribute('role','alert');
    const status=document.createElement('div');status.className='md-table-status';status.setAttribute('role','status');
    const sheet=document.createElement('div');sheet.className='md-table-cell-panel';sheet.hidden=true;sheet.setAttribute('role','group');setUILabel(sheet,'Current table cell');
    const sheetPosition=document.createElement('div');sheetPosition.className='md-table-position';
    const field=document.createElement('input');field.className='md-table-sheet-input';setUILabel(field,'Cell value');
    const review=document.createElement('div');review.className='md-table-paste-review';review.hidden=true;review.setAttribute('role','group');setUILabel(review,'Review table paste');
    const reviewText=document.createElement('p'),reviewData=document.createElement('pre');reviewData.className='md-table-paste-preview';
    let stopTableActions=()=>{};
    let toolbarNode:HTMLElement|undefined;
    const touchBindings:Array<()=>void>=[];
    const controls=new Map<string,{button:HTMLButtonElement;input:HTMLInputElement;mount:HTMLElement;cell:HTMLElement;value:string}>();
    const key=(at:TablePosition)=>at.row+':'+at.column;
    const report=(failure:unknown)=>{setUIText(error,failure instanceof Error?failure.message:String(failure));};
    const notifyToolbar=()=>queueMicrotask(()=>{if(!destroyed)view.dom.dispatchEvent(new CustomEvent('tegg-toolbar-state',{bubbles:true}));});
    const button=(title:string,run:()=>void)=>{const result=document.createElement('button');result.type='button';setUIText(result,title);result.addEventListener('click',run);return result;};
    const selectedLabel=()=>{
      const table=parseMarkdownTable(source),header=table?.headers[selected.column]??'';
      setUIText(sheetPosition,'Row {row}, column {column}: {header}',{row:String(selected.row+1),column:String(selected.column+1),header});
      setUIText(status,'Row {row}, column {column}: {header}',{row:String(selected.row+1),column:String(selected.column+1),header});
    };
    const paintSelection=()=>{
      const top=Math.min(rectangle.from.row,rectangle.to.row),bottom=Math.max(rectangle.from.row,rectangle.to.row),left=Math.min(rectangle.from.column,rectangle.to.column),right=Math.max(rectangle.from.column,rectangle.to.column);
      controls.forEach(({cell},id)=>{const [row,column]=id.split(':').map(Number);const active=row>=top&&row<=bottom&&column>=left&&column<=right;cell.classList.toggle('is-selected',active);cell.dataset.cellState=editing&&key(editing.at)===id?'editing':active?'selected':'idle';cell.setAttribute('aria-selected',String(active));});selectedLabel();
    };
    const select=(at:TablePosition,extend=false)=>{selectionVersion++;selected={...at};rectangle=extend?{from:anchor??rectangle.from,to:selected}:{from:selected,to:selected};if(!extend)anchor=null;paintSelection();remember();};
    const safe=()=>{if(destroyed||stale||view.state.doc.sliceString(from,to)!==source)throw new Error('The table changed. Your cell draft is retained. Cancel to reload the table.');if(view.state.readOnly)throw new Error('This document is read-only.');if(editing?.pendingResources)throw new Error('Wait for the attachment to finish preparing, or cancel it.');if(view.composing||editing?.composing)throw new Error('Finish composing text before changing the table.');};
    const cellValue=()=>{if(!editing)return '';const editorValue=editing.editor?.state.doc.toString();return editorValue!==undefined&&editing.input.value===editing.lastMirrored?editorValue:editing.input.value;};
    const sharedPatches=()=>{const shared=editing?.referencePatches??[];if(shared.length&&editing?.referenceSource!==referenceDocumentSource(view))throw new Error('The shared reference source changed. Your cell draft is retained.');return shared;};
    const prepareChild=()=>!editing?.editor||(editing.nested?prepareEditingLeave(editing.editor,editing.nested.ui.element,editing.nested.controller):prepareIndependentEditingLeave(editing.editor));
    const commitTableSource=(next:string)=>{
      safe();if(!prepareChild())return false;const local=next===source?[]:[{from,to,expected:source,insert:next}],shared=sharedPatches(),context=referenceLinkContext(view);
      if(!context)validateSourcePatches(view.state.doc.toString(),[...local,...shared]);rebuilding=true;try{if(shared.length&&context){if(!context.applyShared(shared,local))throw new Error('The reference changes could not be committed. Your cell draft is retained.');}else if(local.length||shared.length)dispatchSourcePatches(view,[...local,...shared],{isolateHistory:true});return true;}finally{rebuilding=false;}
    };
    const syncCell=(value:string,history:{userEvent?:string;isolate?:boolean}={})=>{
      if(!editing)return false;
      try{
        safe();const result=applyTableOperation(source,{type:'cell',at:editing.at,value});
        const local=result.patches.map(patch=>({...patch,from:from+patch.from,to:from+patch.to})),shared=sharedPatches();
        if(!local.length&&!shared.length)return true;ownSource=result.source;const context=referenceLinkContext(view);if(shared.length&&context){if(!context.applyShared(shared,local))throw new Error('The reference changes could not be committed. Your cell draft is retained.');return true;}
        dispatchSourcePatches(view,[...local,...shared],{
          userEvent:history.userEvent??'input.type',isolateHistory:history.isolate,
        });
        return true;
      }catch(failure){report(failure);return false;}
    };
    const focus=(at:TablePosition,edit=false)=>{
      const control=controls.get(key(at));if(!control)return;select(at);if(edit)start(at);else control.button.focus({preventScroll:true});
    };
    const apply=(operation:TableOperation,options:{allowExpansion?:boolean;focus?:TablePosition;edit?:boolean}={})=>{
      try{
        safe();const result=applyTableOperation(source,operation,{allowExpansion:options.allowExpansion});
        if(result.requiresConfirmation){pendingOperation=operation;review.hidden=false;setUIText(reviewText,'This paste expands the table to {rows} rows and {columns} columns.',{rows:String(result.expansion!.rows),columns:String(result.expansion!.columns)});reviewData.textContent=operation.type==='paste'?operation.cells.map(row=>row.join('\t')).join('\n'):'';return false;}
        if(!result.patches.length){if(options.focus)focus(options.focus,options.edit);return true;}
        remember();if(operation.type==='clear')remember(result.source);else focusRequests.set(view,{from,at:options.focus??result.selection,edit:options.edit??false});
        dispatchSourcePatches(view,result.patches.map(patch=>({...patch,from:from+patch.from,to:from+patch.to})),{isolateHistory:true});
        if(operation.type==='delete-table'){view.dispatch({selection:{anchor:Math.min(from,view.state.doc.length)}});view.focus();}
        return true;
      }catch(failure){report(failure);return false;}
    };
    const ownsCellInteraction=(node:Node|null,owner=editing):boolean=>{
      if(!node||!owner||destroyed||!panel.isConnected||editing!==owner)return false;
      if(panel.contains(node)||owner.auxiliary?.owns(node))return true;
      const child=owner.nested?.ui.element;
      if(child?.isConnected&&child.contains(node))return true;
      return !!owner.editor&&!!captureLiveLinkInteraction(owner.editor)?.owns(node);
    };
    const release=()=>{const current=editing;if(!current)return;current.auxiliary?.dispose();editing=null;current.cancelResource?.();current.referenceCleanup?.();activeCells.delete(view);current.nested?.destroy();current.editor?.destroy();current.mount?.replaceChildren();current.input.hidden=true;current.preview.hidden=false;sheet.hidden=true;notifyToolbar();};
    const finish=(save:boolean,destination?:TablePosition)=>{
      if(!editing)return true;
      const current=editing;if(view.composing||view.compositionStarted||current.composing||current.editor?.composing||current.nested?.ui.isComposing)return false;if(save&&current.pendingResources){report('Wait for the attachment to finish preparing, or cancel it.');return false;}if(save&&current.editor&&!(current.nested?prepareEditingLeave(current.editor,current.nested.ui.element,current.nested.controller):prepareIndependentEditingLeave(current.editor)))return false;if(save&&current.pendingResources){report('Wait for the attachment to finish preparing, or cancel it.');return false;}
      const value=cellValue();
      if(save){try{safe();}catch(failure){report(failure);return false;}}
      const pending=value;
      if(save&&((pending!==current.original&&pending!==sourceCell(current.at))||current.referencePatches?.length)){
        if(!syncCell(pending,{isolate:true})){current.editor?.focus();return false;}
      }

      release();
      if(!save){current.input.value=current.original;field.value=current.original;if(stale){source=latest;stale=false;render();}else current.preview.focus({preventScroll:true});return true;}
      if(destination)focus(destination,false);else current.preview.focus({preventScroll:true});
      return true;
    };
    const sourceCell=(at:TablePosition)=>{const model=parseMarkdownTable(source);return at.row===0?model?.headers[at.column]:model?.rows[at.row-1]?.[at.column];};
    const navigate=(direction:1|-1)=>{
      try{
        const at=editing?.at??selected;
        const current=editing,original=current?.original,value=current?cellValue():undefined;
        if(current?.composing)return;
        safe();
        const step=nextTablePosition(source,at,direction);
        if(step.exit){if(finish(true))exitTable(false);return;}
        if(step.appendRow){
          // Save the current cell and append in one source transaction.
          let next=source;if(value!==undefined&&value!==original)next=applyTableOperation(next,{type:'cell',at,value}).source;
          next=applyTableOperation(next,{type:'insert-row',index:step.position.row}).source;
          focusRequests.set(view,{from,at:step.position,edit:false});if(!commitTableSource(next)){focusRequests.delete(view);return;}release();
        }else if(current)finish(true,step.position);else focus(step.position,false);
      }catch(failure){report(failure);}
    };
    const start=(at:TablePosition,point?:{x:number;y:number})=>{
      if(view.composing)return;
      if(view.state.readOnly){report('This document is read-only.');return;}
      if(editing){if(key(editing.at)===key(at))return;if(!finish(true,at))return;}
      const control=controls.get(key(at));if(!control)return;select(at);error.textContent='';
      editing={at:{...at},input:control.input,original:control.value,preview:control.button,composing:false,lastMirrored:control.value,mount:control.mount};
      control.input.value=control.value;field.value=control.value;
      control.button.hidden=true;control.input.hidden=false;paintSelection();
      const editor=new EditorView({parent:control.mount,state:EditorState.create({doc:control.value,extensions:[history(),tableCellCaret,markdown({extensions:GFM}),resourceContext.of({...view.state.facet(resourceContext),editingContext:'table-cell'}),tableCellProjection,nestedInlineProjection(),liveLinks,semanticClipboardExtension(),EditorView.lineWrapping,EditorView.editorAttributes.of({class:'md-table-inline-editor'}),EditorView.updateListener.of(update=>{if(update.docChanged||update.selectionSet||update.focusChanged)notifyToolbar();})]}),dispatchTransactions:transactions=>{
        editor.update(transactions);
        if(!transactions.some(transaction=>transaction.docChanged)||!editing||editing.editor!==editor)return;
        const value=editor.state.doc.toString();editing.input.value=value;editing.lastMirrored=editing.input.value;

      }});
      editing.editor=editor;const draft=editing;const virtualReferenceSource=()=>{const original=referenceDocumentSource(view);return draft.referenceSource===original?applySourcePatches(original,draft.referencePatches??[]):original;};
      draft.referenceCleanup=registerReferenceLinkContext(editor,{source:virtualReferenceSource,applyShared:(patches,local=[])=>{
        try{safe();if(editing!==draft||editor.composing)return false;const original=referenceDocumentSource(view);if(draft.referenceSource&&draft.referenceSource!==original)return false;
          const virtual=virtualReferenceSource();validateSourcePatches(virtual,patches);validateSourcePatches(editor.state.doc.toString(),local);
          const previous=ChangeSet.of((draft.referencePatches??[]).map(({from,to,insert})=>({from,to,insert})),original.length),next=previous.compose(ChangeSet.of(patches.map(({from,to,insert})=>({from,to,insert})),virtual.length)),combined:SourcePatch[]=[];
          next.iterChanges((from,to,_newFrom,_newTo,insert)=>combined.push({from,to,expected:original.slice(from,to),insert:insert.toString()}));validateSourcePatches(original,combined);
          draft.referenceSource=original;draft.referencePatches=combined;
          if(local.length)dispatchSourcePatches(editor,local,{isolateHistory:true});return true;
        }catch(failure){report(failure);return false;}
      }});editing.nested=attachNestedEditingUI(view,editor);activeCells.set(view,{editor,nested:editing.nested,composing:()=>editing?.editor===editor&&editing.composing,ownsFocus:()=>editing===draft&&!!draft.auxiliary?.owns(document.activeElement),history:(isRedo)=>{
        if(view.state.readOnly||view.composing||editor.composing)return false;
        return (isRedo?redo:undo)(editor);
      }});
      labelCell(editor.contentDOM,control.value);
      editor.dom.addEventListener('keydown',inputKeys);
      editor.dom.addEventListener('compositionstart',()=>{if(editing?.editor===editor){editing.composing=true;notifyToolbar();}});
      editor.dom.addEventListener('compositionend',()=>{if(editing?.editor===editor){editing.composing=false;notifyToolbar();}});
      editor.dom.addEventListener('paste',paste,true);
      mountAuxiliary(draft,control.cell);
      const anchor=point?editor.posAtCoords(point)??editor.state.doc.length:editor.state.doc.length;
      editor.dispatch({selection:{anchor}});
      editor.focus();notifyToolbar();
    };
    const copy=async(cut=false,eventData?:Pick<DataTransfer,'setData'>)=>{
      if(editing||pendingCopy||view.composing)return;
      const doc=view.state.doc,context=view.state.facet(resourceContext),version=selectionVersion,chosen={from:{...rectangle.from},to:{...rectangle.to}},original=source;
      pendingCopy=true;
      try{if(cut)safe();const data=markdownTableCopy(source,chosen,view.state.doc.toString());await writeHtmlTableClipboard(panel,data,eventData);
        if(cut){if(destroyed||stale||view.state.doc!==doc||source!==original||view.state.facet(resourceContext)!==context||selectionVersion!==version||view.state.readOnly||view.composing)throw new Error('Copied, but not cut: the original range changed or is no longer writable.');if(!apply({type:'clear',rectangle:chosen}))throw new Error('Copied, but not cut: the selected cells could not be cleared.');}
        setUIText(status,cut?'Cut':'Copied');
      }catch(failure){report(failure);}finally{pendingCopy=false;}
    };
    const reviewConversion=(next:string,message:string)=>{safe();pendingCommit={source:next,doc:view.state.doc,selectedVersion:selectionVersion};pendingOperation=null;pendingPaste=null;pendingCellPaste=null;review.hidden=false;reviewText.textContent=message;reviewData.textContent=next;};
    const commitReviewed=()=>{
      if(!pendingCommit)return false;const pending=pendingCommit;
      try{safe();if(view.state.doc!==pending.doc||selectionVersion!==pending.selectedVersion)throw new Error('The original table or range changed. Review this operation again.');if(editing?.editor&&!prepareIndependentEditingLeave(editing.editor))return false;
        if(!commitTableSource(pending.source))return false;release();pendingCommit=null;review.hidden=true;return true;
      }catch(failure){report(failure);return false;}
    };
    const pasteData=(data:HtmlTableClipboardData,plain=false)=>{
      try{safe();const plan=prepareMarkdownTablePaste(source,rectangle,{...data,plain},view.state.doc.toString());if(plan.requiresConfirmation){reviewConversion(plan.source,plan.message??'Review this table conversion.');return;}
        dispatchSourcePatches(view,[{from,to,expected:source,insert:plan.source}],{isolateHistory:true});
      }catch(failure){report(failure);}
    };
    const pasteClipboard=async(plain=false)=>{if(editing||view.composing)return;const doc=view.state.doc,context=view.state.facet(resourceContext),version=selectionVersion;try{const data=await readHtmlTableClipboard(panel);safe();if(view.state.doc!==doc||view.state.facet(resourceContext)!==context||selectionVersion!==version)throw new Error('The table or range changed. Paste again.');pasteData(data,plain);}catch(failure){report(failure);}};
    const convert=(empty=false,merge=false)=>{
      try{safe();let current=source,at=editing?.at??selected,before=sourceCell(at)??'',after='';
        if(editing){const value=cellValue();current=applyTableOperation(current,{type:'cell',at,value}).source;const selection=editing.editor?.state.selection.main;const point=selection?.head??value.length;before=value.slice(0,point);after=value.slice(point);}
        const next=convertMarkdownTable(current,merge?{type:'merge',rectangle}:{type:'paragraph',at,before,after,empty},view.state.doc.toString());
        reviewConversion(next,'This operation converts the entire GFM table to HTML so it can preserve merged cells or block paragraphs. Header roles, alignment and other cell formatting are retained. Conversion and insertion form one Undo step.');
      }catch(failure){report(failure);}
    };
    const cellPaste=(prepared:PastePreparation,child:EditorView,range:{from:number;to:number})=>{
      try{safe();if(editing?.editor!==child)throw new Error('The cell changed. Paste again.');
        const markdown=(prepared.cells?prepared.cells.map(row=>row.join('\t')).join('<br>'):prepared.markdown).replace(/\r?\n/g,'<br>');
        const value={...prepared,markdown,cells:undefined};
        if(prepared.resources.length){const current=editing;current.pendingResources=true;
          const delegated=new CustomEvent('tegg-table-resource-paste',{bubbles:true,cancelable:true,detail:{from,to,expected:source,prepared:value,cellDraft:{view:child,range,current:()=>editing===current&&!destroyed&&!stale&&view.state.doc.sliceString(from,to)===source,complete:()=>{current.pendingResources=false;current.cancelResource=undefined;},cancelWith:(cancel:()=>void)=>{current.cancelResource=cancel;}}}});
          if(panel.dispatchEvent(delegated)){current.pendingResources=false;report('This Host does not support storing attachments.');return false;}return true;
        }
        if(prepared.sharedDefinitions?.length){const context=referenceLinkContext(child),original=referenceDocumentSource(child);if(!context||!context.applyShared([{from:original.length,to:original.length,expected:'',insert:'\n\n'+prepared.sharedDefinitions.join('\n\n')}],[{from:range.from,to:range.to,expected:child.state.sliceDoc(range.from,range.to),insert:markdown}]))throw new Error('The shared definitions could not be staged. The original cell is retained.');}
        else child.dispatch({changes:{from:range.from,to:range.to,insert:markdown},selection:{anchor:range.from+markdown.length},userEvent:'input.paste'});child.focus();return true;
      }catch(failure){report(failure);return false;}
    };
    const consumePaste=(captured:ClipboardInput,capturedRange?:{from:number;to:number})=>{
      const prepared=preparePaste(captured,{target:'table-cell',documentSource:editing?.editor?referenceDocumentSource(editing.editor):view.state.doc.toString()});
      if(editing?.editor){
        const child=editing.editor;
        if(editing.composing||child.composing)return;
        const range=capturedRange??clipboardCellRange(child);
        if(!prepared.cells&&!prepared.resources.length&&!prepared.original.html&&!prepared.original.markdown&&!prepared.original.structured&&!/[\r\n]/.test(prepared.markdown))return;
        pendingOperation=null;pendingPaste=null;
        if(prepared.status!=='ready'||prepared.cells&&(prepared.cells.length!==1||prepared.cells[0].length!==1)||/[\r\n]/.test(prepared.markdown)){
          pendingCellPaste={prepared,child,range};review.hidden=false;reviewText.textContent=prepared.issues.map(issue=>issue.message).join(' ')||'This content will be simplified to inline text in the current cell.';reviewData.textContent=prepared.plainText||prepared.markdown||prepared.cells?.map(row=>row.join('\t')).join('\n')||'';return;
        }
        cellPaste(prepared,child,range);return;
      }
      if(!prepared.cells)return; // ordinary cell text stays in its own input history
      pendingPaste=prepared;
      if(prepared.status!=='ready'){review.hidden=false;reviewText.textContent=prepared.issues.map(issue=>issue.message).join(' ');reviewData.textContent=prepared.plainText||prepared.cells.map(row=>row.join('\t')).join('\n');return;}
      const at=editing?.at??selected;if(editing?.composing)return;
      if(prepared.resources.length){
        try{safe();
          const planned=applyTableOperation(source,{type:'paste',at,cells:prepared.cells});
          if(planned.requiresConfirmation){pendingOperation={type:'paste',at,cells:prepared.cells};review.hidden=false;setUIText(reviewText,'This paste expands the table to {rows} rows and {columns} columns.',{rows:String(planned.expansion!.rows),columns:String(planned.expansion!.columns)});reviewData.textContent=prepared.plainText;return;}
          const delegated=new CustomEvent('tegg-table-resource-paste',{bubbles:true,cancelable:true,detail:{from,to,expected:source,prepared:{...prepared,markdown:planned.source,cells:undefined}}});
          if(panel.dispatchEvent(delegated))report('This Host does not support storing attachments.');else release();
        }catch(failure){report(failure);}return;
      }
      try{safe();const operation:TableOperation={type:'paste',at,cells:prepared.cells};const planned=applyTableOperation(source,operation);if(planned.requiresConfirmation){apply(operation);return;}release();apply(operation);}catch(failure){report(failure);}
    };
    const paste=(event:ClipboardEvent)=>{
      if(!event.clipboardData||editing?.composing||view.composing)return;
      if(!editing){const fallback={text:event.clipboardData.getData('text/plain'),html:event.clipboardData.getData('text/html'),structured:event.clipboardData.getData(htmlTableClipboardType)},doc=view.state.doc,version=selectionVersion,context=view.state.facet(resourceContext);
        const read=requestSemanticClipboardRead(panel,'table',fallback);
        if(read instanceof Promise){event.preventDefault();event.stopPropagation();void read.then(data=>{safe();if(view.state.doc!==doc||view.state.facet(resourceContext)!==context||selectionVersion!==version||editing)throw new Error('The table or range changed. Paste again.');pasteData(data);}).catch(report);return;}
        if(fallback.structured||fallback.html&&!event.clipboardData.files.length){event.preventDefault();event.stopPropagation();pasteData(fallback);return;}
      }
      const captured=captureClipboard(event.clipboardData),child=editing?.editor;
      if(child){const owner=editing,selection=captureEditorClipboardSelection(child),doc=child.state.doc,parentDoc=view.state.doc,context=child.state.facet(resourceContext),parentContext=view.state.facet(resourceContext);
        const read=requestSemanticClipboardRead(child.dom,'content',{text:captured.text??'',html:captured.html,structured:captured.structured});
        if(read instanceof Promise){event.preventDefault();event.stopPropagation();void read.then(data=>{safe();if(editing!==owner||child.composing||child.state.readOnly||child.state.doc!==doc||view.state.doc!==parentDoc||child.state.facet(resourceContext)!==context||view.state.facet(resourceContext)!==parentContext||!child.state.selection.eq(selection))throw new Error('The cell paste target changed. Paste again.');consumePaste({...data,files:captured.files},{from:selection.main.from,to:selection.main.to});}).catch(report);return;}
      }
      const prepared=preparePaste(captured,{target:'table-cell'});
      if(child&&!captured.structured&&!captured.html&&!captured.markdown&&!prepared.cells&&!prepared.resources.length&&!/[\r\n]/.test(prepared.markdown))return;
      if(!child&&!prepared.cells)return;
      event.preventDefault();event.stopPropagation();consumePaste(captured);
    };
    const exitTable=(after:boolean)=>exitSemanticObject(view,{from,to},after);
    const vertical=(direction:1|-1)=>{
      const at=editing?.at??selected,model=parseMarkdownTable(source);if(!model)return;
      finish(true,{row:Math.max(0,Math.min(model.rows.length,at.row+direction)),column:at.column});
    };
    const inputKeys=(event:KeyboardEvent)=>{
      event.stopPropagation();if(event.isComposing||event.keyCode===229||editing?.composing)return;
      if(event.key==='Escape'){event.preventDefault();finish(false);}
      if(event.key==='Enter'){
        event.preventDefault();
        if(event.altKey&&(event.metaKey||event.ctrlKey)){
          const child=editing?.editor;if(child){const selection=child.state.selection.main;child.dispatch({changes:{from:selection.from,to:selection.to,insert:'<br>'},selection:{anchor:selection.from+4},userEvent:'input'});}
        }else if(event.metaKey)finish(true);else vertical(event.shiftKey?-1:1);
      }
      if(event.key==='Tab'){event.preventDefault();navigate(event.shiftKey?-1:1);}
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){
        event.preventDefault();const child=editing?.editor;if(child)(event.shiftKey?redo:undo)(child);
      }
    };
    field.addEventListener('keydown',inputKeys);field.addEventListener('paste',paste);
    field.addEventListener('compositionstart',()=>{if(editing)editing.composing=true;});field.addEventListener('compositionend',()=>{if(editing)editing.composing=false;});
    const sheetActions=document.createElement('div');sheetActions.className='md-table-cell-actions';
    sheetActions.append(button('Previous cell',()=>navigate(-1)),button('Next cell',()=>navigate(1)),button('Apply',()=>finish(true)),button('Cancel',()=>finish(false)));
    sheet.append(sheetPosition,field,sheetActions);
    review.append(reviewText,reviewData,button('Apply reviewed change',()=>{if(pendingCommit)commitReviewed();}),button('Apply simplified paste',()=>{
      if(pendingCommit){commitReviewed();return;}
      if(pendingCellPaste){const pending=pendingCellPaste,prepared=preparePaste(pending.prepared.original,{target:'table-cell',acceptSimplification:true});if(prepared.status!=='ready'){report('The paste cannot be simplified safely. The original input is retained.');return;}if(!cellPaste(prepared,pending.child,pending.range))return;pendingCellPaste=null;review.hidden=true;return;}
      if(pendingPaste){const prepared=preparePaste(pendingPaste.original,{target:'table-cell',acceptSimplification:true});if(prepared.status!=='ready'||!prepared.cells){report('The paste cannot be simplified safely. The original input is retained.');return;}pendingPaste=prepared;pendingOperation={type:'paste',at:editing?.at??selected,cells:prepared.cells};}
      if(!pendingOperation)return;
      if(pendingPaste?.resources.length){
        try{safe();const prepared=pendingPaste;const planned=applyTableOperation(source,pendingOperation,{allowExpansion:true});
          const delegated=new CustomEvent('tegg-table-resource-paste',{bubbles:true,cancelable:true,detail:{from,to,expected:source,prepared:{...prepared,markdown:planned.source,cells:undefined}}});
          if(panel.dispatchEvent(delegated))report('This Host does not support storing attachments.');else{release();review.hidden=true;pendingPaste=null;pendingOperation=null;}
        }catch(failure){report(failure);}return;
      }
      release();
      if(apply(pendingOperation,{allowExpansion:true})){pendingPaste=null;pendingOperation=null;review.hidden=true;}
    }),button('Cancel paste',()=>{pendingCommit=null;pendingCellPaste=null;pendingPaste=null;pendingOperation=null;review.hidden=true;}));
    const action=(operation:TableOperation)=>{
        if(!editing)return apply(operation);
        try{
          safe();const current=editing,value=cellValue();
          let next=value===current.original?source:applyTableOperation(source,{type:'cell',at:current.at,value}).source;
          const result=applyTableOperation(next,operation);next=result.source;
          focusRequests.set(view,{from,at:result.selection,edit:false});if(!commitTableSource(next)){focusRequests.delete(view);return false;}release();return true;
        }catch(failure){report(failure);return false;}
      };
    const runTableAction=(value:string):boolean=>{
      if(value==='edit-cell'){try{safe();if(!controls.has(key(selected)))return false;start(selected);return !!editing;}catch(failure){report(failure);return false;}}
      if(value==='add-row'||value==='add-column'){
        const model=parseMarkdownTable(source);if(!model)return false;
        return action(value==='add-row'?{type:'insert-row',index:model.rows.length+1}:{type:'insert-column',index:model.headers.length});
      }
        if(value==='select-range'){if(editing&&!finish(true))return false;anchor={...selected};setUIText(status,'Select the opposite corner of the range.');return true;}
        if(value==='copy-cells'){void copy();return true;}
        if(value==='cut-cells'){void copy(true);return true;}
        if(value==='paste-cells'||value==='paste-plain'){void pasteClipboard(value==='paste-plain');return true;}
        if(value==='merge-cells'){convert(false,true);return true;}
        if(value==='insert-paragraph'||value==='keep-empty-paragraph'){convert(value==='keep-empty-paragraph');return true;}
        if(value==='edit-source'){if(editing&&!finish(true))return false;const request=new CustomEvent('tegg-source-mode-request',{detail:{from},bubbles:true,cancelable:true});if(view.dom.dispatchEvent(request))view.dispatch({effects:tableSourceRequest.of({from,to}),selection:{anchor:from},scrollIntoView:true});view.focus();return true;}
        if(value==='delete-table'){review.hidden=false;setUIText(reviewText,'Delete this table? Undo can restore it.');reviewData.textContent=source;pendingOperation={type:'delete-table'};pendingPaste=null;return true;}
        if(value==='row-before')return action({type:'insert-row',index:selected.row});
        if(value==='row-after')return action({type:'insert-row',index:selected.row+1});
        if(value==='delete-row')return action({type:'delete-row',index:selected.row});
        if(value==='column-before')return action({type:'insert-column',index:selected.column});
        if(value==='column-after')return action({type:'insert-column',index:selected.column+1});
        if(value==='delete-column')return action({type:'delete-column',index:selected.column});
        if(value.startsWith('align-'))return action({type:'align',column:selected.column,alignment:value==='align-none'?null:value.slice(6) as 'left'|'center'|'right'});
      return false;
    };
    function mountAuxiliary(owner:NonNullable<typeof editing>,cell:HTMLElement){
      const host=contextFor(view.dom).cellDraftAuxiliary;if(!host)return;
      const group=document.createElement('div');group.className='md-cell-draft-auxiliary-controls';group.setAttribute('role','group');setUILabel(group,'Table actions');
      const cancel=button('Cancel',()=>{finish(false);}),done=button('Done',()=>{finish(true);}),lineBreak=button('Line break',()=>{
        if(editing!==owner||view.composing||view.compositionStarted||owner.composing||owner.editor?.composing)return;
        try{safe();if(view.state.facet(EditorView.editable)===false||!prepareChild())return;const child=owner.editor;if(!child)return;const range=child.state.selection.main;child.dispatch({changes:{from:range.from,to:range.to,insert:'<br>'},selection:{anchor:range.from+4},userEvent:'input'});child.focus();}catch(failure){report(failure);}
      });
      const more=document.createElement('details'),summary=document.createElement('summary'),menu=document.createElement('div');setUIText(summary,'More');setUILabel(summary,'More');more.append(summary,menu);
      for(const {id,label}of gfmTableActions.filter(action=>action.id!=='edit-cell')){
        const entry=button(label,()=>{if(editing!==owner||owner.composing||owner.editor?.composing||view.composing||view.compositionStarted)return;try{safe();if(view.state.facet(EditorView.editable)===false)return;runTableAction(id);more.open=false;}catch(failure){report(failure);}});
        if(['copy-cells','cut-cells','paste-cells','paste-plain'].includes(id))entry.disabled=true;
        menu.append(entry);
      }
      group.append(cancel,done,lineBreak,more);panel.append(group);let stopMore:(()=>void)|undefined;
      owner.auxiliary=mountCellDraftAuxiliary(view,{kind:'gfm',owner:cell,controls:group,actions:{cancel,done,lineBreak,more},draftToken:owner,current:()=>!destroyed&&editing===owner&&cell.isConnected&&panel.isConnected&&!!owner.editor?.dom.isConnected,composing:()=>view.composing||!!view.compositionStarted||owner.composing||!!owner.editor?.composing||!!owner.nested?.ui.isComposing,releaseControls:()=>{stopMore?.();group.remove();}},host)??undefined;
      if(owner.auxiliary)stopMore=bindCellDraftAuxiliaryMore(view,owner.auxiliary,more,menu);else group.remove();
    }
    const render=()=>{
      const model=parseMarkdownTable(source);if(!model){panel.textContent=source;return;}
      touchBindings.splice(0).forEach(stop=>stop());controls.clear();panel.replaceChildren();panel.dataset.teggTableFrom=String(from);panel.dataset.sourceFrom=String(from);panel.dataset.sourceTo=String(to);
      const toolbar=document.createElement('div');toolbarNode=toolbar;toolbar.className='cm-preview-toolbar md-table-toolbar';toolbar.contentEditable='false';
      const label=document.createElement('span');label.className='md-table-dimensions';setUIText(label,'{rows} rows × {columns} columns',{rows:String(model.rows.length),columns:String(model.headers.length)});
      const actions=document.createElement('div');actions.className='md-table-actions';
      actions.append(button('Add Row',()=>runTableAction('add-row')),button('Add Column',()=>runTableAction('add-column')));
      const menu=document.createElement('select');setUILabel(menu,'Table actions');
      for(const {id,label} of [{id:'',label:'Table actions'},...gfmTableActions]){const option=document.createElement('option');option.value=id;setUIText(option,label);menu.append(option);}
      menu.addEventListener('change',()=>{const value=menu.value;menu.value='';runTableAction(value);});actions.append(menu);
      toolbar.append(label,actions);
      const table=document.createElement('table');table.setAttribute('role','grid');setUILabel(table,'Editable Markdown table');
      const head=document.createElement('thead'),body=document.createElement('tbody');
      [model.headers,...model.rows].forEach((row,r)=>{
        const tr=document.createElement('tr');row.forEach((value,c)=>{
          const at={row:r,column:c},cell=document.createElement(r===0?'th':'td');cell.dataset.tableRow=String(r);cell.dataset.tableColumn=String(c);cell.setAttribute('role',r===0?'columnheader':'gridcell');
          const shell=document.createElement('div');shell.className='cm-live-table-cell';if(model.alignments[c])shell.dataset.align=model.alignments[c]!;
          const preview=document.createElement('button');preview.type='button';preview.className='cm-live-table-preview';setUILabel(preview,'Edit table cell: {value}',{value});
          const context=view.state.facet(resourceContext);preview.innerHTML=sanitizeRenderedHtml(parserFor(context.profile).renderInline(value),context.documentPath,context.resolveImage);
          if(!value)preview.textContent='\u00a0';
          const input=document.createElement('input');input.className='md-table-source-input';input.value=value;input.hidden=true;labelCell(input,value);
          const editorMount=document.createElement('div');editorMount.className='md-table-inline-mount';
          preview.addEventListener('focus',()=>{if(selected.row!==at.row||selected.column!==at.column)select(at);});
          // The whole physical cell is the same selection target. Keep nested
          // editors/inputs outside this route; preview links retain their existing
          // explicit first-select/second-edit contract.
          const previewTarget=(target:EventTarget|null)=>target instanceof Node&&(preview.contains(target)||target===cell||target===shell||target===editorMount&&!editorMount.firstChild);
          cell.addEventListener('click',event=>{if(!previewTarget(event.target))return;if(event.target instanceof Element&&event.target.closest('a')){event.preventDefault();event.stopPropagation();}if(view.composing||editing&&key(editing.at)===key(at))return;if(event.shiftKey||anchor){if(editing&&!finish(true))return;select(at,true);}else {if(editing&&!finish(true))return;select(at);preview.focus({preventScroll:true});}});
          cell.addEventListener('dblclick',event=>{if(!previewTarget(event.target))return;if(event.target instanceof Element&&event.target.closest('a')){event.preventDefault();event.stopPropagation();}start(at,{x:event.clientX,y:event.clientY});});
          touchBindings.push(bindTableCellTouch(cell,{allowLinks:true,enabled:()=>!editing&&!view.state.readOnly&&!view.composing,selected:()=>selected.row===at.row&&selected.column===at.column,select:()=>{select(at);preview.focus({preventScroll:true});},edit:point=>start(at,point)}));
          preview.addEventListener('keydown',event=>{
            if(event.isComposing||event.keyCode===229)return;
            if(event.key==='F2'||event.ctrlKey&&event.key.toLowerCase()==='u'){event.preventDefault();start(at);}
            if(event.key==='Enter'){event.preventDefault();if(event.metaKey){exitTable(true);return;}focus({row:Math.max(0,Math.min(model.rows.length,at.row+(event.shiftKey?-1:1))),column:at.column});}
            if(event.key.length===1&&!event.metaKey&&!event.ctrlKey&&!event.altKey){event.preventDefault();start(at);const child=editing?.editor;if(child)child.dispatch({changes:{from:0,to:child.state.doc.length,insert:event.key},selection:{anchor:event.key.length},userEvent:'input'});}
            if(event.key==='Backspace'||event.key==='Delete'){event.preventDefault();apply({type:'clear',rectangle});}
            if(event.key==='Tab'){event.preventDefault();select(at);navigate(event.shiftKey?-1:1);}
            if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){
              event.preventDefault();const destination={row:Math.max(0,Math.min(model.rows.length,at.row+(event.key==='ArrowDown'?1:event.key==='ArrowUp'?-1:0))),column:Math.max(0,Math.min(model.headers.length-1,at.column+(event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0)))};
              if(event.shiftKey){anchor??={...at};select(destination,true);controls.get(key(destination))?.button.focus();}else focus(destination);
            }
            if((event.metaKey||event.ctrlKey)&&!event.altKey&&['c','x'].includes(event.key.toLowerCase())){event.preventDefault();void copy(event.key.toLowerCase()==='x');}
            if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='v'&&event.shiftKey){event.preventDefault();void pasteClipboard(true);}
            if((event.metaKey||event.ctrlKey)&&['z','y'].includes(event.key.toLowerCase())){
              event.preventDefault();
              // History replaces the rendered table widget. Re-focus the matching
              // preview so the next native shortcut still reaches this document.
              const request=mounted.get(panel);
              request?.history(event.shiftKey||event.key.toLowerCase()==='y');
            }
          });preview.addEventListener('paste',paste);
          input.addEventListener('keydown',inputKeys);input.addEventListener('paste',paste);
          input.addEventListener('compositionstart',()=>{if(editing)editing.composing=true;});input.addEventListener('compositionend',()=>{if(editing)editing.composing=false;});
          input.addEventListener('blur',event=>{if(editing?.input!==input||editing.composing)return;if(!event.relatedTarget||event.relatedTarget instanceof Node&&ownsCellInteraction(event.relatedTarget))return;finish(true);});
          controls.set(key(at),{button:preview,input,mount:editorMount,cell,value});shell.append(preview,input,editorMount);cell.append(shell);tr.append(cell);
        });(r===0?head:body).append(tr);
      });table.append(head,body);panel.append(toolbar,status,table,sheet,review,error);paintSelection();
      const request=focusRequests.get(view);if(request?.from===from){focusRequests.delete(view);queueMicrotask(()=>{if(destroyed||!panel.isConnected)return;const retained=memory!.get(memoryKey(source));if(retained&&!request.edit){selected={...retained.selected};rectangle={from:{...retained.rectangle.from},to:{...retained.rectangle.to}};anchor=retained.anchor;paintSelection();controls.get(key(selected))?.button.focus({preventScroll:true});}else focus(request.at,request.edit);});}
    };
    panel.addEventListener('keydown',event=>{
      if(event.defaultPrevented||event.isComposing||editing?.composing)return;
      const target=event.target;
      if((event.metaKey||event.ctrlKey)&&['z','y'].includes(event.key.toLowerCase())&&
        !(target instanceof Element&&target.closest('input,textarea,.md-table-inline-editor'))){
        event.preventDefault();
        mounted.get(panel)?.history(event.shiftKey||event.key.toLowerCase()==='y');
        return;
      }
      if(event.key==='Escape'&&!editing){anchor=null;rectangle={from:selected,to:selected};paintSelection();}
    });
    panel.addEventListener('copy',event=>{if(editing)return;event.preventDefault();event.stopPropagation();void copy(false,event.clipboardData??undefined);});
    panel.addEventListener('cut',event=>{if(editing)return;event.preventDefault();event.stopPropagation();void copy(true,event.clipboardData??undefined);});
    // Host dispatches before hiding the actual focused controls on a settled layout change.
    // This moves only DOM focus. It never commits a draft or changes the main selection.
    panel.addEventListener('tegg-table-controls-layout',event=>{
      if(destroyed||stale||!panel.isConnected||!toolbarNode)return;
      const active=document.activeElement,hidden=(event as CustomEvent<{hiddenControls?:readonly HTMLElement[]}>).detail?.hiddenControls;
      if(!(active instanceof HTMLElement)||!toolbarNode.contains(active)||!hidden?.some(node=>node instanceof HTMLElement&&toolbarNode!.contains(node)&&node.contains(active)))return;
      if(view.composing||editing?.composing||editing?.editor?.composing){event.preventDefault();return;}
      if(editing){if(editing.editor)editing.editor.focus();else editing.input.focus({preventScroll:true});}
      else controls.get(key(selected))?.button.focus({preventScroll:true});
    });
    const panels=viewPanels.get(view)??new Set<HTMLElement>();panels.add(panel);viewPanels.set(view,panels);
    panel.addEventListener('focusout',event=>{
      if(!editing||editing.composing||!event.relatedTarget)return;
      const requestedFocus=event.relatedTarget;
      if(requestedFocus instanceof Node&&ownsCellInteraction(requestedFocus))return;
      const owner=editing;
      if(finish(true)||!owner.editor)return;
      const choice=captureLiveLinkInteraction(owner.editor)?.leaveChoice;
      if(!choice)return;
      // Native focus completes after focusout. Keep the actual C4 default only
      // while that same rejected target still owns focus, never a later field.
      queueMicrotask(()=>{
        if(!destroyed&&panel.isConnected&&editing===owner&&choice.current()&&
          !view.composing&&!view.compositionStarted&&!owner.composing&&
          !owner.editor?.composing&&document.activeElement===requestedFocus)choice.keep.focus({preventScroll:true});
      });
    });
    mounted.set(panel,{commit:()=>finish(true),command(name){if(name==='table-copy'||name==='table-cut'){void copy(name==='table-cut');return true;}if(name==='table-paste'||name==='table-paste-plain'){void pasteClipboard(name==='table-paste-plain');return true;}if(name==='table-paragraph'||name==='table-empty-paragraph'||name==='table-merge'){convert(name==='table-empty-paragraph',name==='table-merge');return true;}return false;},history(isRedo){if(view.state.readOnly||view.composing||editing?.composing)return false;remember();focusRequests.set(view,{from,at:selected,edit:false});if(!(isRedo?redo:undo)(view)){focusRequests.delete(view);return false;}return true;},update(next,start,end){from=start;to=end;latest=next;panel.dataset.teggTableFrom=String(from);panel.dataset.sourceFrom=String(from);panel.dataset.sourceTo=String(to);if(next===source)return true;if(rebuilding)return false;if(ownSource===next||acceptHistory){
        ownSource=null;source=next;latest=next;stale=false;const current=editing;if(current){const value=sourceCell(current.at);if(value!==undefined){current.original=value;current.input.value=value;current.lastMirrored=current.input.value;if(current.editor&&current.editor.state.doc.toString()!==value){const cell=current.editor;cell.dispatch({changes:{from:0,to:cell.state.doc.length,insert:value}});}}const control=controls.get(key(current.at));if(control){control.value=value??'';setUILabel(control.button,'Edit table cell: {value}',{value:value??''});const context=view.state.facet(resourceContext);control.button.innerHTML=sanitizeRenderedHtml(parserFor(context.profile).renderInline(value??''),context.documentPath,context.resolveImage);if(!value)control.button.textContent='\u00a0';}}return true;}if(editing||!review.hidden){stale=true;report('The table changed. Your cell draft is retained. Cancel to reload the table.');return true;}return false;},destroy(){stopTableActions();touchBindings.forEach(stop=>stop());stopScroll();release();destroyed=true;mounted.delete(panel);panels.delete(panel);}});
    stopTableActions=registerTableActions(view,{panel,kind:'gfm',from:()=>from,containsPreview:node=>[...controls.values()].some(control=>control.cell.contains(node)),capture(){
      if(destroyed||stale||editing||pendingCopy||!review.hidden||view.composing||view.state.doc.sliceString(from,to)!==source)return null;
      const doc=view.state.doc,context=view.state.facet(resourceContext),start=from,end=to,original=source,version=selectionVersion,readOnly=view.state.readOnly||view.state.facet(EditorView.editable)===false;
      const current=()=>!destroyed&&!stale&&!editing&&!pendingCopy&&review.hidden&&view.state.doc===doc&&view.state.facet(resourceContext)===context&&from===start&&to===end&&source===original&&selectionVersion===version&&(view.state.readOnly||view.state.facet(EditorView.editable)===false)===readOnly&&!view.composing&&view.state.doc.sliceString(from,to)===original;
      return {readOnly,current,execute:name=>current()&&(!readOnly||name==='copy-cells')&&runTableAction(name)};
    }});
    render();return panel;
  }
  destroy(dom:HTMLElement){mounted.get(dom)?.destroy();}
  ignoreEvent(){return true;}
}
