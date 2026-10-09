import {registerRenderedClipboardOpaque} from './renderedSourceClipboard';
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history} from '@codemirror/commands';
import {resourceContext} from './editorHost';
import {attachNestedEditingScope,type NestedEditingScope} from './nestedEditingScope';
import {prepareEditingLeave} from './editingLeave';
import {registerEditingLeave} from './editingPreflight';
import {renderMathInto} from './renderKit';
import {technicalDraft} from './technicalDraft';
import {bindEngines} from './renderEngines';
import {objectIcon,enhanceFigures,disposeRenderedImageView,attachRenderedImageEditAction} from './renderInteraction';
import {setUIText,setUILabel} from './uiContext';
import type {sourcePreservingHtmlDraft} from './richHtmlDraft';
type RichDraft=ReturnType<typeof sourcePreservingHtmlDraft>;
/** Each supported HTML subobject owns a child draft; the containing projection owns its commit. */
export function attachHtmlObjectEditing(root:HTMLElement,parent:EditorView,draft:RichDraft,hooks:{uiRoot:HTMLElement;readOnly:()=>boolean;composing:()=>boolean;current:()=>boolean;changed:(inputType:string)=>void;report:(error:unknown)=>void;linkActionsInMenu?:boolean;draftCurrent?:()=>boolean}){
 let alive=true;const scopes=new Map<HTMLElement,{editor:EditorView;scope:NestedEditingScope;host:HTMLElement}>(),bars=new Set<HTMLElement>();
 const destroyScopes=()=>{for(const {editor,scope,host}of scopes.values()){scope.destroy();editor.destroy();host.remove();}scopes.clear();};
 const composing=()=>hooks.composing()||[...scopes.values()].some(({editor,scope})=>editor.composing||scope.ui.isComposing);
 const prepare=()=>{if(composing()||hooks.readOnly()||!hooks.current())return false;for(const {editor,scope}of scopes.values())if(!prepareEditingLeave(editor,scope.ui.element,scope.controller))return false;return true;};
 // Explicit discard owns the actual draft, independently of source/write authority.
 const draftCurrent=()=>alive&&root.isConnected&&(hooks.draftCurrent?.()??true);
 const cancelComposing=()=>composing()||parent.compositionStarted||[...scopes.values()].some(({editor})=>editor.compositionStarted);
 const cancel=()=>{
  if(!draftCurrent()||cancelComposing())return false;
  for(const [element,managed]of [...scopes]){
   if(!draftCurrent()||cancelComposing())return false;if(scopes.get(element)!==managed)continue;
   managed.scope.ui.close(false);
   if(!draftCurrent())return false;if(scopes.get(element)!==managed)continue;
   scopes.delete(element);managed.scope.destroy();managed.editor.destroy();managed.host.remove();
  }
  return draftCurrent();
 };
 const stop=registerEditingLeave({view:parent,composing,awaitingChoice:()=>[...scopes.values()].some(({scope})=>scope.ui.awaitingLeaveChoice),prepare:()=>!scopes.size||prepare(),cancelPending:()=>scopes.forEach(({scope})=>scope.ui.cancelPendingLeave())});
 function open(element:HTMLElement,kind:'image'|'math'|'link'){
  if(!alive||hooks.readOnly()||composing()||!hooks.current())return;
  try{const raw=draft.sourceFor(element);if(raw===undefined)throw new Error('This object has no safe source mapping.');let managed=scopes.get(element);
   if(managed&&managed.editor.state.doc.toString()!==raw){if(!prepareEditingLeave(managed.editor,managed.scope.ui.element,managed.scope.controller))return;managed.scope.destroy();managed.editor.destroy();managed.host.remove();scopes.delete(element);managed=undefined;}
   if(!managed){const host=document.createElement('div');registerRenderedClipboardOpaque(host);host.hidden=true;host.className='md-html-object-editor-host';host.dataset.teggEditorProjection='true';hooks.uiRoot.append(host);const editor=new EditorView({parent:host,state:EditorState.create({doc:raw,extensions:[history(),resourceContext.of(parent.state.facet(resourceContext)),EditorView.editable.of(false)]}),dispatchTransactions:transactions=>{
     const changed=transactions.some(tr=>tr.docChanged),next=transactions.at(-1)?.newDoc.toString()??editor.state.doc.toString();if(changed){if(!alive||hooks.readOnly()||hooks.composing()||!hooks.current()||!root.contains(element))throw new Error('The containing object changed. Your object draft is retained.');draft.validateReplacement(element,next);}editor.update(transactions);if(!changed)return;try{draft.replaceSource(element,next);if(kind==='math'){const formula=technicalDraft('math',next);if(formula){bindEngines(element,parent.state.facet(resourceContext).engines);renderMathInto(element,{kind:'math',source:formula.body,display:element.getAttribute('data-tegg-math')==='block'?'block':'inline'});}}hooks.changed('formatObject');}catch(error){hooks.report(error);}
    }});const scope=attachNestedEditingScope(parent,editor,{literalObject:true});if(!scope){editor.destroy();host.remove();throw new Error('This Host has no object editing surface.');}managed={editor,scope,host};scopes.set(element,managed);}
   managed.scope.ui.openObject(kind,{from:0,to:managed.editor.state.doc.length});
  }catch(error){hooks.report(error);}
 }
 function refresh(){for(const bar of bars)bar.remove();bars.clear();destroyScopes();for(const image of root.querySelectorAll<HTMLImageElement>('img'))disposeRenderedImageView(image);enhanceFigures(root);for(const {element,kind}of draft.objects()){
   if(kind==='link'&&hooks.linkActionsInMenu)continue;
   const bar=document.createElement('span');registerRenderedClipboardOpaque(bar);bar.className='md-html-object-actions';bar.dataset.teggEditorProjection='true';bar.contentEditable='false';const button=document.createElement('button');button.type='button';const label=kind==='image'?'Edit image':kind==='math'?'Edit formula':'Edit link';setUIText(button,label);setUILabel(button,label);objectIcon(button,'edit');button.addEventListener('pointerdown',event=>event.preventDefault());button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();open(element,kind);});bar.append(button);element.after(bar);bars.add(bar);if(kind==='image'&&element instanceof HTMLImageElement)attachRenderedImageEditAction(element,bar);
  }}
 // A retained stale/readonly draft still owns its real child window. This is
 // focus/leave membership only; prepare/edit/commit retain their own guards.
 const ownsNode=(node:Node)=>draftCurrent()&&[...scopes.values()].some(({scope,host})=>{
  const session=scope.controller.session;
  return host.isConnected&&scope.ui.element.isConnected&&scope.ui.element.contains(node)&&
   !!session&&['editing','stale'].includes(session.status);
 });
 refresh();return {prepare,cancel,isComposing:cancelComposing,ownsNode,refresh,editLink(anchor:HTMLAnchorElement):boolean{
  if(!alive||hooks.readOnly()||composing()||!hooks.current()||!root.contains(anchor)||!draft.objects().some(item=>item.kind==='link'&&item.element===anchor))return false;
  open(anchor,'link');const session=scopes.get(anchor)?.scope.controller.session;return session?.kind==='link'&&session.status==='editing';
 },dispose(){alive=false;stop();destroyScopes();for(const bar of bars)bar.remove();bars.clear();}};
}
