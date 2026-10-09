/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest';
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {markdown} from '@codemirror/lang-markdown';
import {history,undo} from '@codemirror/commands';
import {liveLinks,editCurrentLink} from './liveLinks';
import {bindUI} from './uiContext';
import {resourceContext} from './editorHost';
const views:EditorView[]=[],bindings:ReturnType<typeof bindUI>[]=[];
afterEach(()=>{for(const view of views.splice(0))view.destroy();for(const binding of bindings.splice(0))binding.destroy();vi.restoreAllMocks();document.body.replaceChildren();});
const box=(left:number,width:number,top=900,height=0)=>new DOMRect(left,top,width,height);
function open(overlay?:HTMLElement,frame?:HTMLElement){
  const source='[old](old.md)',view=new EditorView({parent:frame??document.body,state:EditorState.create({doc:source,selection:{anchor:2},extensions:[markdown(),history(),resourceContext.of({profile:'tegg',documentPath:''}),liveLinks]})});views.push(view);
  vi.spyOn(view.dom,'getBoundingClientRect').mockReturnValue(box(89.5,1,200,18));
  bindings.push(bindUI(view.dom,{overlayContainer:overlay,mobile:false}));
  expect(editCurrentLink(view)).toBe(true);return {view,source,panel:document.querySelector<HTMLElement>('.md-link-editor')!};
}
it('uses a real zero-height Host overlay width instead of the narrow child or its unrelated vertical position',()=>{
  const overlay=document.body.appendChild(document.createElement('aside'));vi.spyOn(overlay,'getBoundingClientRect').mockReturnValue(box(120,520));
  const {view,source,panel}=open(overlay);expect(panel.style.width).toBe('440px');expect(panel.style.left).toBe('160px');expect(panel.style.top).toBe('20px');
  const field=panel.querySelector<HTMLInputElement>('[aria-label="Link destination"]')!;field.value='nested.md';field.dispatchEvent(new Event('input'));expect(view.state.doc.toString()).toBe(source);
  panel.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));expect(view.state.doc.toString()).toBe('[old](<nested.md>)');expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(source);expect(undo(view)).toBe(false);
});
it('clips an offset Host pane to the actual viewport and recomputes the same retained dialog after resize',()=>{
  const overlay=document.body.appendChild(document.createElement('aside'));let rect=box(window.innerWidth-240,800);vi.spyOn(overlay,'getBoundingClientRect').mockImplementation(()=>rect);
  const {view,source,panel}=open(overlay);expect(panel.style.width).toBe('208px');expect(parseFloat(panel.style.left)+208).toBe(window.innerWidth-16);
  rect=box(100,520);window.dispatchEvent(new Event('resize'));expect(document.querySelector('.md-link-editor')).toBe(panel);expect(panel.style.width).toBe('440px');expect(panel.style.left).toBe('140px');expect(view.state.doc.toString()).toBe(source);
});
it('falls back from an unallocated overlay to the actual SDK frame without measuring the nested source editor',()=>{
  const frame=document.body.appendChild(document.createElement('section'));frame.className='tegg-sdk-frame';vi.spyOn(frame,'getBoundingClientRect').mockReturnValue(box(60,360,0,600));
  const overlay=document.body.appendChild(document.createElement('aside'));vi.spyOn(overlay,'getBoundingClientRect').mockReturnValue(box(0,0));
  const {panel,view,source}=open(overlay,frame);expect(panel.style.width).toBe('328px');expect(panel.style.left).toBe('76px');expect(view.state.doc.toString()).toBe(source);
});
it('uses the viewport when no allocated Host surface exists, preserving the independent dialog margin',()=>{
  const {panel}=open();const width=Math.min(440,window.innerWidth-32);expect(panel.style.width).toBe(width+'px');expect(parseFloat(panel.style.left)).toBe((window.innerWidth-width)/2);
});
