import {bindHtmlDetailsDisplay} from './htmlDetailsDisplay';
import {attachHtmlObjectEditing} from './htmlObjectEditing';
import {attachDomSemanticClipboard} from './contentClipboard';
import {htmlLiteralSelection,htmlTextSelection,htmlLiteralText,restoreHtmlTextSelection,insertHtmlLiteral,indentHtmlLiteral,type HtmlLiteralSelection} from './htmlLiteralEditing';
import {EditorView} from '@codemirror/view';
import {undo,redo} from '@codemirror/commands';
import {dispatchSourcePatches} from './editorPatches';
import {sourcePreservingHtmlDraft} from './richHtmlDraft';
import {displaySessionFor,resourceContext,sameResourceContextAuthority} from './editorHost';
import {setUIText,setUILabel,message} from './uiContext';
import type {EditorToolbarState} from './editorToolbar';
type ActiveHtmlDirectInput={panel:HTMLElement;current:()=>boolean};
type Handle={source:string;composing:boolean;active:()=>boolean;canEdit:()=>boolean;captureInput:()=>ActiveHtmlDirectInput|null;command:(name:string)=>boolean;dispose:()=>void};
const mounted=new WeakMap<EditorView,Set<Handle>>();
const restoration=new WeakMap<EditorView,{from:number;selection:HtmlLiteralSelection;selections:Map<string,HtmlLiteralSelection>}>();
export function htmlDirectEditingIsComposing(view:EditorView){return [...mounted.get(view)??[]].some(item=>item.composing);}
export function htmlDirectEditingOwnsFocus(view:EditorView){return [...mounted.get(view)??[]].some(item=>item.active());}
export function focusedHtmlDirectState(view:EditorView):EditorToolbarState|null {
 const handle=[...mounted.get(view)??[]].find(item=>item.active());if(!handle)return null;
 const selection=view.dom.ownerDocument.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null,node=selection?.anchorNode,element=(node instanceof Element?node:node?.parentElement)??(document.activeElement instanceof Element?document.activeElement:null),pre=!!element?.closest('pre')||!!range?.cloneContents().querySelector('pre'),literal=pre||!!element?.closest('code')||!!range?.cloneContents().querySelector('code');
 const has=(tags:string)=>!!element?.closest(tags);return {mixed:[],inlineFormattingEnabled:!handle.composing&&!view.composing&&handle.canEdit()&&!literal,bold:!literal&&has('strong,b'),italic:!literal&&has('em,i'),code:handle.canEdit()&&!pre&&has('code')&&(!range||!!element?.closest('code')?.contains(range.endContainer)),underline:!literal&&has('u'),strike:!literal&&has('s,del'),highlight:!literal&&has('mark'),subscript:!literal&&has('sub'),superscript:!literal&&has('sup'),task:false,heading:null,callout:null,calloutEnabled:false,calloutContext:''};
}
export function executeHtmlDirectCommand(view:EditorView,name:string){return [...mounted.get(view)??[]].find(item=>item.active())?.command(name)??false;}
/** Captures only a registered, continuously focused safe-HTML text input. */
export function captureActiveHtmlDirectInput(view:EditorView):ActiveHtmlDirectInput|null {
 for(const handle of mounted.get(view)??[]){const captured=handle.captureInput();if(captured)return captured;}return null;
}
/** Direct safe-HTML text input writes only a source-mappable range; unknown projections remain intact. */
export function attachHtmlDirectEditing(wrapper:HTMLElement,view:EditorView,from:number,source:string):Handle|null{
 let draft:ReturnType<typeof sourcePreservingHtmlDraft>;try{draft=sourcePreservingHtmlDraft(wrapper,source);}catch{return null;}
 if(view.state.readOnly||view.state.facet(EditorView.editable)===false)return null;
 let alive=true,inputFocusEpoch=0,inputDocumentEpoch=0,inputDocument=view.state.doc;const inputContext={...view.state.facet(resourceContext)};const notice=document.createElement('div');notice.className='md-html-direct-notice';notice.setAttribute('role','status');notice.hidden=true;notice.contentEditable='false';notice.setAttribute('contenteditable','false');wrapper.append(notice);wrapper.contentEditable='true';wrapper.setAttribute('contenteditable','true');wrapper.classList.add('cm-html-direct-editor');
 const report=(error:unknown)=>{setUIText(notice,error instanceof Error?error.message:String(error));notice.hidden=false;};
 const notify=()=>view.dom.dispatchEvent(new CustomEvent('tegg-toolbar-state',{bubbles:true}));
 const current=()=>!view.state.readOnly&&view.state.facet(EditorView.editable)!==false&&view.state.doc.sliceString(from,from+handle.source.length)===handle.source;
 const selectionContext=()=>{const selection=wrapper.ownerDocument.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null;if(!range||!wrapper.contains(range.startContainer)||!wrapper.contains(range.endContainer)||notice.contains(range.startContainer)||notice.contains(range.endContainer))return null;const element=range.startContainer instanceof Element?range.startContainer:range.startContainer.parentElement,last=range.endContainer instanceof Element?range.endContainer:range.endContainer.parentElement,pre=element?.closest<HTMLElement>('pre'),code=element?.closest<HTMLElement>('code'),insidePre=!!pre||!!last?.closest('pre')||!!range.cloneContents().querySelector('pre'),literal=insidePre||!!code||!!last?.closest('code')||!!range.cloneContents().querySelector('code');return {selection:selection!,range,element,pre,code,insidePre,literal};};
 // Keep native child selections in editable author content, outside generated
 // status/controls and opaque objects. A nested contenteditable can otherwise
 // receive a Range whose other endpoint belongs to the outer CodeMirror line.
 const editableText=(container:HTMLElement)=>{
  const nodes:Text[]=[],walker=container.ownerDocument.createTreeWalker(container,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){const node=walker.currentNode as Text;if(!node.length)continue;let supported=true;for(let parent=node.parentElement;parent&&parent!==container;parent=parent.parentElement){if(parent===notice||parent.getAttribute('contenteditable')==='false'){supported=false;break;}}if(supported&&!notice.contains(node))nodes.push(node);}
  return nodes;
 };
 const textEdge=(container:HTMLElement,end:boolean)=>{const nodes=editableText(container),node=end?nodes.at(-1):nodes[0];if(node)return {node:node as Node,offset:end?node.length:0};if(container!==wrapper&&container!==notice&&container.matches('p,div,summary,code,figcaption')&&container.getAttribute('contenteditable')!=='false'&&draft.sourceFor(container)!==undefined)return {node:container as Node,offset:end?container.childNodes.length:0};const blocks=Array.from(container.querySelectorAll<HTMLElement>('p,div,summary,code,figcaption')).filter(element=>!notice.contains(element)&&element.getAttribute('contenteditable')!=='false'&&draft.sourceFor(element)!==undefined),block=end?blocks.at(-1):blocks[0];return block?{node:block as Node,offset:end?block.childNodes.length:0}:null;};
 const normalizeActivationSelection=()=>{
  if(!alive||handle.composing||view.composing||!textFocus())return;const selected=wrapper.ownerDocument.getSelection();if(!selected?.rangeCount)return;const range=selected.getRangeAt(0),starts=wrapper.contains(range.startContainer),ends=wrapper.contains(range.endContainer);if(!starts&&!ends)return;
  // Internal semantic selections (for example all of a <code> or <strong>)
  // already have valid author DOM authority. Flattening them to wrapper text
  // offsets would place a boundary in an adjacent run and lose that semantic.
  if(starts&&ends&&range.startContainer!==wrapper&&range.endContainer!==wrapper)return;
  const edgeAt=(at:number,end:boolean)=>{for(let index=end?at-1:at;index>=0&&index<wrapper.childNodes.length;index+=end?-1:1){const child=wrapper.childNodes[index];if(child instanceof Text&&child.length)return {node:child as Node,offset:end?child.length:0};if(child instanceof HTMLElement&&child!==notice&&child.getAttribute('contenteditable')!=='false'){const point=textEdge(child,end);if(point)return point;}}return textEdge(wrapper,!end);};
  if(range.collapsed&&range.startContainer===wrapper){const point=edgeAt(range.startOffset,false);if(point){const caret=range.cloneRange();caret.setStart(point.node,point.offset);caret.collapse(true);selected.removeAllRanges();selected.addRange(caret);}return;}
  const first=starts?(range.startContainer===wrapper?edgeAt(range.startOffset,false):{node:range.startContainer,offset:range.startOffset}):textEdge(wrapper,false),last=ends?(range.endContainer===wrapper?edgeAt(range.endOffset,true):{node:range.endContainer,offset:range.endOffset}):textEdge(wrapper,true);if(!first||!last)return;
  const backward=!range.collapsed&&selected.anchorNode===range.endContainer&&selected.anchorOffset===range.endOffset,next=range.cloneRange();next.setStart(first.node,first.offset);next.setEnd(last.node,last.offset);if(backward&&selected.setBaseAndExtent)selected.setBaseAndExtent(next.endContainer,next.endOffset,next.startContainer,next.startOffset);else{selected.removeAllRanges();selected.addRange(next);}
 };
 const moveTextEdge=(container:HTMLElement,end:boolean,extend:boolean)=>{
  const point=textEdge(container,end);if(!point)return false;const selected=wrapper.ownerDocument.getSelection();if(!selected)return false;
  if(extend&&selected.anchorNode&&container.contains(selected.anchorNode)&&!notice.contains(selected.anchorNode)&&selected.setBaseAndExtent)selected.setBaseAndExtent(selected.anchorNode,selected.anchorOffset,point.node,point.offset);
  else{const range=wrapper.ownerDocument.createRange();range.setStart(point.node,point.offset);range.collapse(true);selected.removeAllRanges();selected.addRange(range);}notify();return true;
 };
 const savedRestoration=restoration.get(view),selections=savedRestoration?.from===from?savedRestoration.selections:new Map<string,HtmlLiteralSelection>();
 const capture=()=>{const selection=htmlTextSelection(wrapper);if(selection){selections.delete(handle.source);selections.set(handle.source,selection);if(selections.size>100)selections.delete(selections.keys().next().value!);}};
 const isTextFocus=(active:EventTarget|null)=>active instanceof Element&&wrapper.contains(active)&&active.closest('[contenteditable]')?.getAttribute('contenteditable')==='true'&&!notice.contains(active)&&!active.matches('input,textarea,select,button');
 const textFocus=()=>isTextFocus(wrapper.ownerDocument.activeElement);
 const inputCurrent=()=>alive&&mounted.get(view)?.has(handle)===true&&wrapper.isConnected&&wrapper.getAttribute('contenteditable')==='true'&&sameResourceContextAuthority(view.state.facet(resourceContext),inputContext)&&handle.canEdit();
 const syncInputDocument=()=>{if(view.state.doc!==inputDocument){inputDocumentEpoch++;inputDocument=view.state.doc;}};
 const leaveInput=(event:FocusEvent)=>{if(!isTextFocus(event.relatedTarget))inputFocusEpoch++;};
 const blurInput=()=>{inputFocusEpoch++;};
 wrapper.addEventListener('focusout',leaveInput);wrapper.ownerDocument.defaultView?.addEventListener('blur',blurInput);
 const handle:Handle={source,composing:false,active:()=>wrapper.contains(document.activeElement),canEdit:()=>current()&&textFocus(),captureInput:()=>{
  if(!inputCurrent())return null;syncInputDocument();const epoch=inputFocusEpoch,documentEpoch=inputDocumentEpoch;let retained=true;return {panel:wrapper,current:()=>{if(retained&&(epoch!==inputFocusEpoch||documentEpoch!==inputDocumentEpoch||view.state.doc!==inputDocument||!inputCurrent()))retained=false;return retained;}};
 },command:name=>{
  if(handle.composing||view.composing||!handle.canEdit())return false;
  if(name==='undo'||name==='redo'){const selection=htmlTextSelection(wrapper);if(selection)restoration.set(view,{from,selection,selections});const result=name==='undo'?undo(view):redo(view);if(!result||alive&&wrapper.isConnected)restoration.delete(view);return result;}
  const context=selectionContext();if(!context)return false;const {selection,range,element,insidePre,literal}=context;
  capture();
  if(name==='code'||name==='highlight'){
   if(insidePre||name==='highlight'&&literal)return false;
   const tag=name==='code'?'code':'mark',existing=element?.closest(tag);
   if(existing&&wrapper.contains(existing)&&existing.contains(range.endContainer)){existing.replaceWith(...Array.from(existing.childNodes));}
   else{if(range.collapsed||literal)return false;const mark=document.createElement(tag);mark.append(range.extractContents());range.insertNode(mark);range.selectNodeContents(mark);selection.removeAllRanges();selection.addRange(range);}
   wrapper.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'format'+name}));return true;
  }
  if(literal)return false;
  const commands:Record<string,string>={bold:'bold',italic:'italic',underline:'underline',strike:'strikeThrough',subscript:'subscript',superscript:'superscript'};
  if(!commands[name])return false;wrapper.focus({preventScroll:true});return document.execCommand?.(commands[name])??false;
 },dispose:()=>{alive=false;inputFocusEpoch++;wrapper.removeEventListener('focusout',leaveInput);wrapper.ownerDocument.defaultView?.removeEventListener('blur',blurInput);registry!.delete(handle);}};
 let registry=mounted.get(view);if(!registry){registry=new Set();mounted.set(view,registry);}registry.add(handle);
 const commit=(inputType='input.type')=>{
  if(!alive||handle.composing||view.composing)return false;
  try{notice.remove();const next=draft.serialize();wrapper.append(notice);if(next===handle.source)return true;if(!current()){report('The original content changed or became read-only. Your input is retained.');return false;}const expected=handle.source,selection=htmlTextSelection(wrapper),ownedFocus=textFocus();handle.source=next;if(selection&&ownedFocus){selections.set(next,selection);restoration.set(view,{from,selection,selections});}try{syncInputDocument();dispatchSourcePatches(view,[{from,to:from+expected.length,expected,insert:next}],{userEvent:inputType.startsWith('format')?'input.format':inputType==='insertFromPaste'?'input.paste':'input.type',isolateHistory:inputType.startsWith('format')||inputType==='insertFromPaste'});inputDocument=view.state.doc;}catch(error){handle.source=expected;restoration.delete(view);throw error;}if(alive&&wrapper.isConnected&&ownedFocus&&selection){wrapper.focus({preventScroll:true});restoreHtmlTextSelection(wrapper,selection);restoration.delete(view);}notice.hidden=true;return true;}catch(error){if(!notice.isConnected)wrapper.append(notice);report(error);return false;}
 };
 wrapper.addEventListener('input',event=>{draft.markChanged();if(!handle.composing){commit((event as InputEvent).inputType);capture();}notify();});
 wrapper.addEventListener('compositionstart',()=>{capture();handle.composing=true;notify();});wrapper.addEventListener('compositionend',()=>{handle.composing=false;draft.markChanged();queueMicrotask(()=>{commit();capture();notify();});});
 const publish=(inputType:string)=>wrapper.dispatchEvent(new InputEvent('input',{bubbles:true,inputType}));
 const prepareLiteral=()=>{if(handle.composing||view.composing)return false;if(current())return true;report('The original content changed or became read-only. Your input is retained.');return false;};
 const exitCode=(pre:HTMLElement,after:boolean)=>{const next=after?pre.nextElementSibling:pre.previousElementSibling;let target=next?.matches('p')?next as HTMLElement:null;if(!target){target=document.createElement('p');target.dataset.teggTemporary='true';const line=document.createElement('br');line.dataset.teggTemporary='true';target.append(line);if(after)pre.after(target);else pre.before(target);}const range=document.createRange();range.selectNodeContents(target);range.collapse(after);const selection=wrapper.ownerDocument.getSelection();selection?.removeAllRanges();selection?.addRange(range);notify();};
 for(const pre of wrapper.querySelectorAll<HTMLElement>('pre')){pre.spellcheck=false;pre.setAttribute('autocorrect','off');pre.setAttribute('autocapitalize','off');}
 wrapper.addEventListener('beforeinput',event=>{if(event.target instanceof Element&&event.target.matches('input,textarea,select,button'))return;const input=event as InputEvent,context=selectionContext();if(!context){event.preventDefault();event.stopPropagation();report('This selection is outside the editable content. Your source is preserved.');return;}if(input.isComposing||handle.composing||view.composing)return;capture();if(!current()){event.preventDefault();event.stopPropagation();report('The original content changed or became read-only. Your input is retained.');return;}if(!context.literal&&input.inputType==='insertText'&&input.data!==null){const selection=wrapper.ownerDocument.getSelection();if(selection?.rangeCount&&draft.insertMappedText(selection.getRangeAt(0),input.data)){event.preventDefault();event.stopPropagation();publish('insertText');return;}}if(context.literal&&input.inputType.startsWith('format')){event.preventDefault();event.stopPropagation();return;}if(context.pre&&['insertParagraph','insertLineBreak'].includes(input.inputType)){event.preventDefault();event.stopPropagation();if(prepareLiteral()&&insertHtmlLiteral(context.pre,'\n'))publish('insertLineBreak');}});
 wrapper.addEventListener('paste',event=>{if(event.target instanceof Element&&event.target.matches('input,textarea,select,button'))return;const context=selectionContext(),literal=context?.pre??context?.code;if(!literal||!event.clipboardData||handle.composing||view.composing)return;event.preventDefault();event.stopPropagation();if(!prepareLiteral())return;capture();const text=event.clipboardData.getData('text/plain');if(!text&&event.clipboardData.getData('text/html')){report('Code input requires plain text. The clipboard input is retained.');return;}if(insertHtmlLiteral(literal,text))publish('insertFromPaste');});
 wrapper.addEventListener('keydown',event=>{
  if(event.target instanceof Element&&event.target.matches('input,textarea,select,button'))return;
  if(event.isComposing||handle.composing||view.composing||event.keyCode===229)return;
  const context=selectionContext(),pre=context?.pre;
  if((event.metaKey||event.ctrlKey)&&!event.altKey&&(['Home','End'].includes(event.key)||event.metaKey&&['ArrowUp','ArrowDown'].includes(event.key))){event.preventDefault();event.stopPropagation();if(current())moveTextEdge(pre??wrapper,event.key==='End'||event.key==='ArrowDown',event.shiftKey);return;}
  if((event.metaKey||event.ctrlKey)&&!event.altKey&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();event.stopPropagation();handle.command(event.shiftKey||event.key.toLowerCase()==='y'?'redo':'undo');return;}
  if(context?.literal&&(event.metaKey||event.ctrlKey)&&!event.altKey&&['b','i','u'].includes(event.key.toLowerCase())){event.preventDefault();event.stopPropagation();return;}
  if(pre&&['Enter','Tab','Escape','Backspace','Delete'].includes(event.key)){
   const selected=htmlLiteralSelection(pre);if(!selected){event.preventDefault();event.stopPropagation();report('This code selection cannot be edited without changing an unsupported structure. Your content is retained.');return;}
   if(event.key==='Backspace'||event.key==='Delete'){if(!selected.end||event.key==='Delete'&&selected.start===htmlLiteralText(pre).length&&selected.start===selected.end){event.preventDefault();event.stopPropagation();return;}if(selected.start===selected.end)return;}
   event.preventDefault();event.stopPropagation();if(!prepareLiteral())return;capture();
   if(event.key==='Enter'&&event.metaKey){exitCode(pre,!event.shiftKey);return;}
   if(event.key==='Escape'){const language=pre.closest('.md-code-editor')?.querySelector<HTMLElement>('.md-code-language');if(language)language.focus({preventScroll:true});else{pre.tabIndex=-1;pre.focus({preventScroll:true});wrapper.ownerDocument.getSelection()?.removeAllRanges();}return;}
   const changed=event.key==='Tab'?indentHtmlLiteral(pre,event.shiftKey):insertHtmlLiteral(pre,event.key==='Enter'?'\n':'');if(changed)publish(event.key==='Tab'?(event.shiftKey?'formatOutdent':'formatIndent'):event.key==='Enter'?'insertLineBreak':'deleteContent');return;
  }
  const selection=wrapper.ownerDocument.getSelection(),anchor=selection?.anchorNode,element=anchor instanceof Element?anchor:anchor?.parentElement,summary=element?.closest('summary'),details=summary?.parentElement;
  if(event.key==='Enter'&&summary&&details instanceof HTMLDetailsElement){
   event.preventDefault();event.stopPropagation();if(!prepareLiteral())return;
   if(event.shiftKey){const range=selection?.rangeCount?selection.getRangeAt(0):null;if(!range||!summary.contains(range.startContainer)||!summary.contains(range.endContainer))return;capture();range.deleteContents();const br=document.createElement('br');range.insertNode(br);if(!br.nextSibling){const placeholder=document.createElement('br');placeholder.dataset.teggTemporary='true';br.after(placeholder);}range.setStartAfter(br);range.collapse(true);selection!.removeAllRanges();selection!.addRange(range);publish('insertLineBreak');return;}
   details.open=true;
   let target=Array.from(details.children).find(node=>node!==summary) as HTMLElement|undefined;
   if(!target){target=document.createElement('p');target.dataset.teggTemporary='true';const placeholder=document.createElement('br');placeholder.dataset.teggTemporary='true';target.append(placeholder);summary.after(target);}
   const caret=document.createRange();caret.selectNodeContents(target);caret.collapse(true);selection?.removeAllRanges();selection?.addRange(caret);return;
  }
 });
 const objectEditing=attachHtmlObjectEditing(wrapper,view,draft,{uiRoot:wrapper.parentElement??wrapper,readOnly:()=>view.state.readOnly,composing:()=>handle.composing||view.composing,current,changed:inputType=>{capture();commit(inputType);notify();},report});
 let rememberDetails=()=>{};
 const preflight=(event:Event)=>{rememberDetails();if(!commit())event.preventDefault();};view.dom.addEventListener('tegg-editing-preflight',preflight);
 const stopClipboard=attachDomSemanticClipboard(wrapper,{readOnly:()=>view.state.readOnly||view.state.facet(EditorView.editable)===false,composing:()=>handle.composing||view.composing,current:()=>current()});
 const dispose=handle.dispose;handle.dispose=()=>{objectEditing.dispose();stopClipboard();view.dom.removeEventListener('tegg-editing-preflight',preflight);dispose();};
 wrapper.addEventListener('dblclick',()=>{normalizeActivationSelection();notify();});
 wrapper.addEventListener('focusin',()=>{const capturedDoc=view.state.doc;queueMicrotask(()=>{if(alive&&view.state.doc===capturedDoc)normalizeActivationSelection();});notify();});wrapper.addEventListener('mouseup',notify);wrapper.addEventListener('keyup',notify);
 const session=displaySessionFor(view),detailElements=Array.from(wrapper.querySelectorAll('details'));
 detailElements.forEach(details=>{
  if(!details.querySelector(':scope > summary')){const summary=document.createElement('summary');summary.dataset.teggTemporary='true';summary.dataset.placeholder=message(wrapper,'Details');setUILabel(summary,'Details');details.prepend(summary);}
  details.querySelector('summary')?.addEventListener('click',event=>{if(handle.composing){event.preventDefault();event.stopPropagation();}});
 });
 const detailsDisplay=bindHtmlDetailsDisplay(session,()=>detailElements.map((element,index)=>({element,from:from+index,to:from+handle.source.length})),()=>!handle.composing&&!view.composing);
 rememberDetails=detailsDisplay.remember;const disposeDisplay=handle.dispose;handle.dispose=()=>{detailsDisplay.dispose();disposeDisplay();};
 wrapper.addEventListener('compositionend',()=>queueMicrotask(detailsDisplay.sync));
 const saved=restoration.get(view);if(saved?.from===from){restoration.delete(view);queueMicrotask(()=>{if(alive){wrapper.focus({preventScroll:true});restoreHtmlTextSelection(wrapper,saved.selections.get(source)??saved.selection);}});}
 return handle;
}
