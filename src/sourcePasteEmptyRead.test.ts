// @vitest-environment jsdom
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history,undo,undoDepth} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {EditingController,type EditingIdentity} from './editingController';
import {attachEditingUI,type EditingUIHost} from './editingUI';
import {resourceContext} from './editorHost';
import {contentClipboardType,type SemanticClipboardRead} from './clipboardTransport';

const uuid='298FB1C1-4035-4688-9802-E00E092D33F4';
const original=`# Mac external window ${uuid}\n\n`+Array.from({length:24},(_,i)=>`Line ${i+1}: synthetic Markdown with **formatting** and a visible final character.`).join('\n\n')+`\n\nEND ${uuid}\n`;
const replacement=`MAC_WINDOW_REPLACED_${uuid}`;
const cleanups:(()=>void)[]=[];
beforeAll(()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  Range.prototype.getClientRects=()=>[] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect=()=>new DOMRect();
});
afterEach(()=>{while(cleanups.length)cleanups.pop()!();document.body.replaceChildren();});
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function surface(host:EditingUIHost={}){
  const root=document.body.appendChild(document.createElement('div'));
  const view=new EditorView({parent:root,state:EditorState.create({doc:original,selection:{anchor:0,head:original.length},extensions:[markdown(),history(),resourceContext.of({documentPath:'',profile:'tegg'})]})});
  let identity:EditingIdentity={documentId:'synthetic-source-paste',generation:'one',mode:'source',profile:'tegg'};
  const controller=new EditingController(view,{identity:()=>identity}),ui=attachEditingUI(controller,root,{toolbar:false,...host});
  cleanups.push(()=>{ui.destroy();controller.destroy();view.destroy();});
  return {root,view,controller,ui,setIdentity:(value:EditingIdentity)=>{identity=value;}};
}
function nativeRead(root:HTMLElement){
  let callback:((data?:SemanticClipboardRead,error?:string)=>void)|undefined;
  root.addEventListener('tegg-read-content',event=>{event.preventDefault();callback=(event as CustomEvent).detail.complete;});
  return (data?:SemanticClipboardRead,error?:string)=>{expect(callback).toBeTypeOf('function');callback!(data,error);};
}
function paste(view:EditorView,representations:Record<string,string>,files:File[]=[]){
  const event=new Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(event,'clipboardData',{value:{types:Object.keys(representations),getData:(type:string)=>representations[type]??'',files}});
  view.contentDOM.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);
}

describe('Source paste capture and empty native read',()=>{
  it('retains the captured 56 bytes when a delayed native success is empty, in one undo step',async()=>{
    expect(new TextEncoder().encode(original)).toHaveLength(2012);
    expect(new TextEncoder().encode(replacement)).toHaveLength(56);
    const {root,view}=surface(),complete=nativeRead(root);
    paste(view,{'text/plain':replacement});expect(view.state.doc.toString()).toBe(original);
    complete({text:'',html:'',structured:''});await settle();
    expect(view.state.doc.toString()).toBe(replacement);expect(undoDepth(view.state)).toBe(1);
    expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(original);
  });
  it('leaves the full selection, history and session untouched when both sources are empty',async()=>{
    const {root,view,controller}=surface(),complete=nativeRead(root),selected=view.state.selection;
    paste(view,{'text/plain':''});complete({text:''});await settle();
    expect(view.state.doc.toString()).toBe(original);expect(view.state.selection.eq(selected)).toBe(true);
    expect(undoDepth(view.state)).toBe(0);expect(controller.session).toBeNull();
  });
  it('also treats directly supplied empty payloads as no insertion',async()=>{
    const {view,controller,ui}=surface(),selected=view.state.selection;
    await ui.paste({text:'',html:'',markdown:'',structured:'',files:[]});
    expect(view.state.doc.toString()).toBe(original);expect(view.state.selection.eq(selected)).toBe(true);
    expect(controller.session).toBeNull();expect(undoDepth(view.state)).toBe(0);
  });
  it('retains captured HTML when the delayed native representations are all empty',async()=>{
    const {root,view}=surface(),complete=nativeRead(root);
    paste(view,{'text/html':'<strong>captured</strong>'});complete({text:''});await settle();
    expect(view.state.doc.toString()).toBe('**captured**');
  });
  it('retains valid nonempty native semantic data over contradictory event text',async()=>{
    const {root,view}=surface(),complete=nativeRead(root);
    paste(view,{'text/plain':'event fallback'});
    complete({text:'native readable',structured:JSON.stringify({version:1,kind:'content',format:'tegg',source:'**native source**'})});await settle();
    expect(view.state.doc.toString()).toBe('**native source**');
  });
  it('keeps whitespace as nonempty native input instead of choosing the event fallback',async()=>{
    const {root,view}=surface(),complete=nativeRead(root);
    paste(view,{'text/plain':'fallback'});complete({text:'  '});await settle();
    expect(view.state.doc.toString()).toBe('  ');
  });
  it('does not silently downgrade invalid nonempty native semantic data to event text',async()=>{
    const {root,view,ui}=surface(),complete=nativeRead(root);
    paste(view,{'text/plain':'fallback'});complete({text:'native',structured:'{invalid'});await settle();
    expect(view.state.doc.toString()).toBe(original);expect(ui.element.textContent).toContain('Review paste');
  });
  it('refuses the captured fallback when the actual target selection changes before native completion',async()=>{
    const {root,view,ui}=surface(),complete=nativeRead(root);
    paste(view,{'text/plain':replacement});view.dispatch({selection:{anchor:5}});complete({text:''});await settle();
    expect(view.state.doc.toString()).toBe(original);expect(view.state.selection.main.anchor).toBe(5);
    expect(ui.element.textContent).toContain('The paste target changed. Paste again.');
  });
  it('does not use the event fallback after a native refusal',async()=>{
    const {root,view,ui}=surface(),complete=nativeRead(root);
    paste(view,{'text/plain':replacement});complete(undefined,'native read refused');await settle();
    expect(view.state.doc.toString()).toBe(original);expect(ui.element.textContent).toContain('native read refused');
  });
  it('keeps a captured image and its HTML alt through native empty read and resource acknowledgement',async()=>{
    let finish!:(result:{reference:string})=>void;
    const store=vi.fn(()=>new Promise<{reference:string}>(resolve=>{finish=resolve;}));
    const {root,view}=surface({storeResource:store}),complete=nativeRead(root);
    paste(view,{'text/html':'<img src="pixel.png" alt="captured image">'},[new File([new Uint8Array([1,2])],'pixel.png',{type:'image/png'})]);
    complete({text:''});await settle();expect(store).toHaveBeenCalledOnce();expect(view.state.doc.toString()).toBe(original);
    finish({reference:'Attachments/pixel.png'});await settle();expect(view.state.doc.toString()).toBe('![captured image](<Attachments/pixel.png>)');
  });
  it('keeps a file-only clipboard as a resource import and commits only its stored reference',async()=>{
    const store=vi.fn(async()=>({reference:'Attachments/report.pdf'}));
    const {root,view}=surface({storeResource:store}),complete=nativeRead(root);
    paste(view,{},[new File([new Uint8Array([1])],'report.pdf',{type:'application/pdf'})]);complete({text:''});await settle();
    expect(store).toHaveBeenCalledOnce();expect(view.state.doc.toString()).toBe('[report.pdf](<Attachments/report.pdf>)');
  });
  it('retains captured structured input on empty native read without dropping its source format',async()=>{
    const {root,view}=surface(),complete=nativeRead(root);
    paste(view,{[contentClipboardType]:JSON.stringify({version:1,kind:'content',format:'tegg',source:'`captured literal`'})});complete({text:''});await settle();
    expect(view.state.doc.toString()).toBe('`captured literal`');
  });
});
