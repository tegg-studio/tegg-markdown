import {livePreview} from '@tegg/markdown/core';
import {EditorState} from '@codemirror/state';
import {EditorView,keymap} from '@codemirror/view';
import {history,historyKeymap,undo} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {forceParsing,ParseContext} from '@codemirror/language';
import {GFM} from '@lezer/markdown';
import type {ParseWrapper} from '@lezer/common';
import {TeggMarkdownEditor,bindObjectViewerHost,type ObjectViewerHost,type EditorDocument,type EditorHost,type ClipboardFile,type StoreResourceContext} from '@tegg/markdown/editor';
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
let parserProbe:EditorView|undefined,releaseParser:(()=>void)|undefined;
const parserSource='before\n\n| A | B |\n| --- | --- |\n| old | 2 |\n\nafter';
const api={
  deferredTableParsing(){
    parserProbe?.destroy();const probe=document.querySelector<HTMLElement>('#parser-probe')??document.body.appendChild(document.createElement('main'));probe.id='parser-probe';probe.className='tegg-sdk-editor tegg-surface';
    let released=false;const pending=new Promise<void>(resolve=>{releaseParser=()=>{released=true;resolve();};});const wrap:ParseWrapper=(inner,input,fragments,ranges)=>released?inner:ParseContext.getSkippingParser(pending).startParse(input,fragments,ranges);const delayed={wrap};
    parserProbe=new EditorView({parent:probe,state:EditorState.create({doc:parserSource,selection:{anchor:parserSource.length},extensions:[history(),keymap.of(historyKeymap),markdown({extensions:[GFM,delayed]}),livePreview]})});
    return {initialCell:!!probe.querySelector('[aria-label="Edit table cell: 2"]'),source:parserProbe.state.doc.toString()};
  },
  completeTableParsing(){releaseParser?.();return !!parserProbe&&forceParsing(parserProbe,parserProbe.state.doc.length,1000);},
  parserSnapshot(){return {source:parserProbe?.state.doc.toString(),selection:parserProbe?{anchor:parserProbe.state.selection.main.anchor,head:parserProbe.state.selection.main.head}:null};},
  undoParser(){return !!parserProbe&&undo(parserProbe);},
  bindViewer(host:ObjectViewerHost){return bindObjectViewerHost(editorRoot,host);},
  get editor(){return editor;},get ui(){return ui;},get errors(){return errors;},get resources(){return savedResources;},get storage(){return {calls:storageCalls,aborts};},
  load(source:string,options:Partial<EditorDocument>&Pick<EditorHost,'copyText'|'engines'|'openLink'>={}){
    const {copyText,engines,openLink,...documentOptions}=options;
    ui?.destroy();editor?.destroy();errors.length=0;storageCalls=0;aborts=0;storageMode='normal';
    editor=new TeggMarkdownEditor(editorRoot,{documentId:'document-'+(++documentNumber),revision:'disk-1',source,profile:'tegg',...documentOptions},{copyText,openLink,engines:engines??{math:katexEngine,mermaid:mermaidEngine,graphviz:graphvizEngine},resourcePolicy:{allowRelative:true},resolveImage:src=>src,onError:error=>errors.push(String(error))},'live');
    editor.view.dispatch({selection:{anchor:editor.view.state.doc.length}});
    ui=attachEditingUI(editor.editing,toolsRoot,{copyText,storeResource,extensions:[{id:'example.relabel',version:'1.0.0',label:'Prepare revised link',profiles:['tegg'],kinds:['link'],prepare:async context=>({draft:context.session.original.replace('[old]','[reviewed]')})}],onError:error=>errors.push(error instanceof Error?error.message:String(error))});return editor.snapshot();
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
