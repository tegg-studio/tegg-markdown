const w=window as any;
import {EditorState,EditorSelection} from '@codemirror/state';
w.cmTypes={EditorState,EditorSelection};
import * as taskCore from '@tegg/markdown/core';
import * as taskReader from '@tegg/markdown/reader';
import type {ReaderInput} from '@tegg/markdown/reader';
const {TechnicalMarkdownReader,toggleTaskSource}=taskCore;
w.taskAPI={core:taskCore,reader:taskReader};
const root=document.querySelector<HTMLElement>('#reader')!;
let input:ReaderInput={documentId:'own',generation:'g1',sequence:0,revision:'base',source:'- [ ] first\n- [X] second',taskToggleEnabled:true};
w.calls=[];w.errors=[];w.reject=false;
const reader=new TechnicalMarkdownReader(root,{onError:error=>w.errors.push(String(error)),onTaskToggle:request=>{
 w.calls.push({task:request.task,patch:request.patch,source:request.source});
 if(w.reject)return {accepted:false};
 input={...input,source:toggleTaskSource(request.source,request.task.marker),sequence:request.task.sequence+1,profileVersion:request.task.profileVersion};return {accepted:true,input};
}});
w.taskFixture={reader,root,getSource:()=>input.source};await reader.render(input);w.ready=true;
