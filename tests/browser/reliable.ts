import {TeggMarkdownEditor,type EditorDocument,type ClipboardFile,type StoreResourceContext} from '@tegg/markdown/editor';
import {attachEditingUI,type EditingUI} from '@tegg/markdown/ui';
import {katexEngine} from '@tegg/markdown/engines/katex';
import {mermaidEngine} from '@tegg/markdown/engines/mermaid';
import {graphvizEngine} from '@tegg/markdown/engines/graphviz';
import '@tegg/markdown/editor.css';
import '@tegg/markdown/ui.css';
import 'katex/dist/katex.min.css';
const editorRoot=document.querySelector<HTMLElement>('#editor')!,toolsRoot=document.querySelector<HTMLElement>('#tools')!;
let editor:TeggMarkdownEditor,ui:EditingUI,documentNumber=0;
let storageMode:'normal'|'deferred'|'fail-once'='normal',storageCalls=0,aborts=0;
const errors:string[]=[],savedResources:{reference:string;name:string;size:number}[]=[];
async function storeResource(file:ClipboardFile,context:StoreResourceContext){
  storageCalls++;context.onProgress(0);context.signal.addEventListener('abort',()=>{aborts++;},{once:true});
  if(!file.blob)throw new Error('This example requires a Blob from the system file picker.');
  const mode=storageMode;if(mode==='fail-once')storageMode='normal';
  // Deliberately allow a test upload to finish after cancellation to verify late-result guards.
  const response=await fetch('/api/attachments?delay='+(mode==='deferred'?'600':'0')+'&fail='+(mode==='fail-once'?'1':'0'),{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file.blob});
  if(!response.ok)throw new Error('Attachment storage returned HTTP '+response.status);
  const stored=await response.json() as {reference:string};savedResources.push({...stored,name:file.name,size:file.size});context.onProgress(1);return stored;
}
const api={
  get editor(){return editor;},get ui(){return ui;},get errors(){return errors;},get resources(){return savedResources;},get storage(){return {calls:storageCalls,aborts};},
  load(source:string,options:Partial<EditorDocument>={}){
    ui?.destroy();editor?.destroy();errors.length=0;storageCalls=0;aborts=0;storageMode='normal';
    editor=new TeggMarkdownEditor(editorRoot,{documentId:'document-'+(++documentNumber),revision:'disk-1',source,profile:'tegg',...options},{engines:{math:katexEngine,mermaid:mermaidEngine,graphviz:graphvizEngine},resourcePolicy:{allowRelative:true},resolveImage:src=>src,onError:error=>errors.push(String(error))},'live');
    editor.view.dispatch({selection:{anchor:editor.view.state.doc.length}});
    ui=attachEditingUI(editor.editing,toolsRoot,{storeResource,extensions:[{id:'example.relabel',version:'1.0.0',label:'Prepare revised link',profiles:['tegg'],kinds:['link'],prepare:async context=>({draft:context.session.original.replace('[old]','[reviewed]')})}],onError:error=>errors.push(error instanceof Error?error.message:String(error))});return editor.snapshot();
  },
  select(text:string){const source=editor.source,from=source.indexOf(text);if(from<0)throw new Error('Selection text is absent');editor.view.dispatch({selection:{anchor:from,head:from+text.length}});},
  setStorage(mode:typeof storageMode){storageMode=mode;},
  switchDocument(source:string){const result=editor.replaceDocument({documentId:'document-'+(++documentNumber),revision:'disk-new',source,profile:'tegg'});ui.attachToCurrentState();return result;},
  async pasteHTML(html:string){const item=new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob(['plain fallback'],{type:'text/plain'})});await navigator.clipboard.write([item]);},
  async resourceFiles(){return await (await fetch('/api/resources')).json();},
  destroy(){ui.destroy();editor.destroy();},
  cycles(count:number){for(let index=0;index<count;index++){api.load('# Cycle\n\ntext');const session=editor.editing.begin('selection',{from:0,to:0});editor.editing.updateDraft(session.token,'draft');editor.editing.cancel(session.token);}api.destroy();},
};
(window as unknown as {host:typeof api}).host=api;
api.load('# Draft\n\n[Old link](old.md)\n\n| Name | Value |\n| --- | --- |\n| cat | old |\n\nEnd');
