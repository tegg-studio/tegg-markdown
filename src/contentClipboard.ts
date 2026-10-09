import {buildReferenceLinkIndex,referenceDocumentSource} from './referenceLinkEditing';
import {readerFootnoteDocument} from './readerFootnotes';
import {planSemanticSelectionDeletion,semanticObjectBoundaries,snapSemanticSelection} from './objectBoundary';
import {dispatchSourcePatches} from './editorPatches';
import {syntaxTree,ensureSyntaxTree} from '@codemirror/language';
import {EditorState,type SelectionRange} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {resourceContext} from './editorHost';
import {parserFor} from './markdownParser';
import {inlineHtmlFormatting} from './inlineHtml';
import {scriptFormatting} from './scriptFormatting';
import {analyzeSource} from './sourceAnalysis';
import {contentClipboardType,writeSemanticClipboard,type SemanticClipboardData} from './clipboardTransport';
export {readContentClipboard,controlledClipboardHtml,readableClipboardText} from './contentClipboardText';
export type {ContentClipboard} from './contentClipboardText';
export {attachDomSemanticClipboard} from './renderedClipboard';
import {controlledClipboardHtml,readableClipboardText,type ContentClipboard} from './contentClipboardText';
type Pair={from:number;to:number;contentFrom:number;contentTo:number};
/** Preserve the inline context of partial visible text without copying hidden targets as plain text. */
export function selectedSemanticSource(state:EditorState,selection:SelectionRange):string {
 const tree=ensureSyntaxTree(state,state.doc.length,50)??syntaxTree(state),pairs:Pair[]=[];
 tree.iterate({from:selection.from,to:selection.to,enter(node){
  if(['FencedCode','CodeBlock','HTMLBlock'].includes(node.name))return false;
  const first=node.node.firstChild,last=node.node.lastChild;
  if(['StrongEmphasis','Emphasis','Strikethrough','InlineCode'].includes(node.name)&&first&&last&&first!==last)pairs.push({from:node.from,to:node.to,contentFrom:first.to,contentTo:last.from});
  if(node.name==='Link'){let close=node.node.firstChild;while(close&&!(close.name==='LinkMark'&&state.sliceDoc(close.from,close.from+1)===']'))close=close.nextSibling;if(close)pairs.push({from:node.from,to:node.to,contentFrom:node.from+1,contentTo:close.from});}
 }});
 pairs.push(...inlineHtmlFormatting(state).pairs,...scriptFormatting(state),...analyzeSource(state.doc).highlights);
 const start=pairs.filter(pair=>pair.from<selection.from&&pair.contentFrom<=selection.from&&pair.contentTo>selection.from).sort((a,b)=>b.to-b.from-(a.to-a.from));
 const end=pairs.filter(pair=>pair.to>selection.to&&pair.contentFrom<selection.to&&pair.contentTo>=selection.to).sort((a,b)=>a.to-a.from-(b.to-b.from));
 return start.map(pair=>state.sliceDoc(pair.from,pair.contentFrom)).join('')+state.sliceDoc(selection.from,selection.to)+end.map(pair=>state.sliceDoc(pair.contentTo,pair.to)).join('');
}
export function semanticSelectionClipboard(state:EditorState,documentSource=state.doc.toString()):SemanticClipboardData {
 if(state.selection.ranges.some(range=>range.empty))throw new Error('Select the content to copy.');
 const format=state.facet(resourceContext).profile??'tegg',parser=parserFor(format),source=state.selection.ranges.map(range=>selectedSemanticSource(state,range)).join('\n'),env:{references?:unknown}={};
 // Resolve the selected occurrence against its document definitions without including unrelated definitions.
 parser.parse(documentSource,env);
 const referenceIndex=buildReferenceLinkIndex(state.doc.toString(),format,documentSource),documentIndex=buildReferenceLinkIndex(documentSource,format),keys=new Set(referenceIndex.occurrences.filter(item=>state.selection.ranges.some(range=>range.from<item.to&&range.to>item.from)).map(item=>item.key)),definitions=documentIndex.definitions.filter(item=>keys.has(item.key)&&(documentSource!==state.doc.toString()||!state.selection.ranges.some(range=>range.from<=item.from&&range.to>=item.to))).map(item=>item.raw);
 const localNotes=readerFootnoteDocument(parser,state.doc.toString()),noteKeys=new Set(localNotes.references.filter(item=>state.selection.ranges.some(range=>range.from<item.to&&range.to>item.from)).map(item=>item.label)),notes=readerFootnoteDocument(parser,documentSource);for(const note of notes.definitions)if(noteKeys.has(note.label)&&(documentSource!==state.doc.toString()||!state.selection.ranges.some(range=>range.from<=note.from&&range.to>=note.to)))definitions.push(documentSource.slice(note.from,note.to));
 let html=controlledClipboardHtml(parser.render(source,{references:env.references}));
 const root=document.createElement('div');root.innerHTML=html;
 // Diagram source and TeX are reproducible textual representations, not screenshots.
 root.querySelectorAll('[data-tex]').forEach(node=>{if(!node.textContent)node.textContent=node.getAttribute('data-tex')??'';});html=root.innerHTML;
 return {text:readableClipboardText(root),html,structured:JSON.stringify({version:1,kind:'content',format,source,...(definitions.length?{definitions}:{} )} satisfies ContentClipboard)};
}
function report(root:HTMLElement,error:unknown){root.dispatchEvent(new CustomEvent('tegg-clipboard-error',{bubbles:true,detail:error instanceof Error?error.message:String(error)}));let notice=root.querySelector<HTMLElement>(':scope > .md-clipboard-status');if(!notice){notice=document.createElement('span');notice.className='md-clipboard-status';notice.setAttribute('role','status');root.append(notice);}notice.textContent=error instanceof Error?error.message:String(error);}
/** Capture the actual innermost DOM selection before an asynchronous clipboard read. */
export function captureEditorClipboardSelection(view:EditorView){
 const selected=view.dom.ownerDocument.getSelection();
 if(selected?.anchorNode&&selected.focusNode&&view.contentDOM.contains(selected.anchorNode)&&view.contentDOM.contains(selected.focusNode))try{
  const anchor=view.posAtDOM(selected.anchorNode,selected.anchorOffset),head=view.posAtDOM(selected.focusNode,selected.focusOffset);
  if(anchor>=0&&head>=0&&anchor<=view.state.doc.length&&head<=view.state.doc.length&&(anchor!==view.state.selection.main.anchor||head!==view.state.selection.main.head))view.dispatch({selection:{anchor,head}});
 }catch{/* An unrelated browser range is never mapped into this editor. */}
 return view.state.selection;
}
export type ClipboardDeletion=(view:EditorView)=>boolean;
export async function copySemanticSelection(view:EditorView,options:{cut?:boolean;eventData?:Pick<DataTransfer,'setData'>;delete?:ClipboardDeletion}={}):Promise<boolean>{
 if(view.composing||view.state.selection.main.empty)return false;if(options.cut&&(view.state.readOnly||view.state.facet(EditorView.editable)===false))return false;
 const snapped=snapSemanticSelection(view,view.state.selection);if(!snapped.eq(view.state.selection))view.dispatch({selection:snapped});
 const doc=view.state.doc,selection=view.state.selection,context=view.state.facet(resourceContext);
 try{const data=semanticSelectionClipboard(view.state,referenceDocumentSource(view));await writeSemanticClipboard(view.dom,data,'content',options.eventData);
  if(options.cut){if(view.composing||view.state.readOnly||view.state.facet(EditorView.editable)===false||view.state.doc!==doc||view.state.facet(resourceContext)!==context||!view.state.selection.eq(selection)||!view.dom.isConnected)throw new Error('Copied, but not cut: the original selection changed or is no longer writable.');if(!(options.delete??deleteCopiedSelection)(view))throw new Error('Copied, but not cut: this selection cannot be removed without changing unselected structure.');}return true;
 }catch(error){report(view.dom,error);return false;}
}
export function deleteCopiedSelection(view:EditorView){const plan=planSemanticSelectionDeletion(view.state,view.state.selection,semanticObjectBoundaries(view));if(!plan)return false;dispatchSourcePatches(view,plan.patches,{selection:plan.selection,isolateHistory:true,preserveSelection:true,userEvent:'delete.cut'});return true;}
export function semanticClipboardExtension(remove?:ClipboardDeletion){return EditorView.domEventHandlers({copy(event,view){if(view.state.selection.main.empty)return false;event.preventDefault();if(view.composing)return true;void copySemanticSelection(view,{eventData:event.clipboardData??undefined});return true;},cut(event,view){if(view.state.selection.main.empty)return false;event.preventDefault();if(view.composing)return true;void copySemanticSelection(view,{cut:true,eventData:event.clipboardData??undefined,delete:remove});return true;}});}
export {contentClipboardType};
/** Text controls keep the innermost selection and never cut an outer object. */
export function attachInputSemanticClipboard(input:HTMLTextAreaElement|HTMLInputElement,options:{readOnly:()=>boolean;composing:()=>boolean;current:()=>boolean;format?:'code'|'text'}):()=>void {
 let alive=true;const handler=(rawEvent:Event)=>{
  const event=rawEvent as ClipboardEvent;const from=input.selectionStart??0,to=input.selectionEnd??from;if(from===to)return;
  event.preventDefault();event.stopPropagation();if(options.composing())return;const cut=event.type==='cut';if(cut&&options.readOnly())return;
  const value=input.value,text=value.slice(from,to),escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),html=options.format==='code'?'<pre><code>'+escape(text)+'</code></pre>':escape(text),direction=input.selectionDirection;
  void writeSemanticClipboard(input,{text,html,structured:JSON.stringify({version:1,kind:'content',format:'html',source:html} satisfies ContentClipboard)},'content',event.clipboardData??undefined).then(()=>{
   if(!cut)return;if(!alive||!input.isConnected||options.composing()||options.readOnly()||!options.current()||input.value!==value||input.selectionStart!==from||input.selectionEnd!==to||input.selectionDirection!==direction){report(input.parentElement??input,'Copied, but not cut: the original selection changed or is no longer writable.');return;}
   input.setRangeText('',from,to,'end');input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteByCut'}));
  }).catch(error=>report(input.parentElement??input,error));
 };input.addEventListener('copy',handler);input.addEventListener('cut',handler);return()=>{alive=false;input.removeEventListener('copy',handler);input.removeEventListener('cut',handler);};
}
