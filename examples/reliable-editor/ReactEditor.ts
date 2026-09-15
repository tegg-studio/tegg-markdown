import {createElement,useCallback,useEffect,useRef} from 'react';
import {MarkdownEditor,type MarkdownEditorProps} from '@tegg/markdown/react';
import type {EditorHost,TeggMarkdownEditor} from '@tegg/markdown/editor';
import {attachEditingUI,type EditingUI,type EditingUIHost} from '@tegg/markdown/ui';
import '@tegg/markdown/editor.css';
import '@tegg/markdown/ui.css';

type Props=Omit<MarkdownEditorProps,'host'|'onReady'> & {host?:EditorHost & EditingUIHost};
/** React owns the wrapper lifecycle; the SDK owns the document and the optional UI uses its controller. */
export function ReliableMarkdownEditor(props:Props){
  const toolbar=useRef<HTMLDivElement>(null),ui=useRef<EditingUI|null>(null),latest=useRef(props);latest.current=props;
  const ready=useCallback((editor:TeggMarkdownEditor)=>{
    ui.current?.destroy();
    if(toolbar.current)ui.current=attachEditingUI(editor.editing,toolbar.current,new Proxy({} as EditingUIHost,{get:(_,key)=>latest.current.host?.[key as keyof EditingUIHost]}));
  },[]);
  useEffect(()=>()=>{ui.current?.destroy();ui.current=null;},[]);
  useEffect(()=>{queueMicrotask(()=>ui.current?.attachToCurrentState());},[props.document]);
  return createElement('div',{style:{display:'grid',gridTemplateRows:'auto minmax(320px, 1fr)',height:'min(80vh, 800px)',minWidth:0}},
    createElement('div',{ref:toolbar}),createElement(MarkdownEditor,{...props,onReady:ready}));
}
