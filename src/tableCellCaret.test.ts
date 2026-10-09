// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {EditorState,StateEffect} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history,undoDepth} from '@codemirror/commands';
import {bindTableCellCaret,tableCellCaret} from './tableCellCaret';

let view:EditorView,dispose:()=>void,time:number;
beforeEach(()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}unobserve(){}});
  Range.prototype.getClientRects=()=>({length:0,item:()=>null,[Symbol.iterator]:function*(){}}) as DOMRectList;
  Range.prototype.getBoundingClientRect=()=>new DOMRect();
  vi.spyOn(navigator,'vendor','get').mockReturnValue('Apple Computer, Inc.');
  vi.spyOn(navigator,'userAgent','get').mockReturnValue('Mobile/15E148');
  time=10000;vi.spyOn(performance,'now').mockImplementation(()=>time);
  view=new EditorView({parent:document.body,state:EditorState.create({doc:'Gamma',extensions:[history()]})});
  view.dispatch({selection:{anchor:3}});view.focus();dispose=bindTableCellCaret(view);
});
afterEach(()=>{dispose();view.destroy();document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();});
function pointer(type:string,x=86,y=90,pointerType='touch',primary=true){
  const e=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y});
  Object.defineProperties(e,{pointerType:{value:pointerType},pointerId:{value:1},isPrimary:{value:primary}});
  view.contentDOM.dispatchEvent(e);expect(e.defaultPrevented).toBe(false);
}
function caret(at:number,head=at){
  const text=view.contentDOM.querySelector('.cm-line')!.firstChild!;
  document.getSelection()!.setBaseAndExtent(text,at,text,head);
  document.dispatchEvent(new Event('selectionchange'));
}
function tap(){
  expect(view.hasFocus).toBe(true);expect(document.activeElement).toBe(view.contentDOM);
  expect(document.getSelection()!.anchorOffset).toBe(view.state.selection.main.anchor);
  pointer('pointerdown');time+=70;pointer('pointerup');
}
it('retains the actual native end caret after immediate stale rollback without adding a content Undo',()=>{
  tap();caret(5);time+=13;caret(3);expect(view.state.selection.main.head).toBe(5);expect(view.state.doc.toString()).toBe('Gamma');expect(undoDepth(view.state)).toBe(0);
  view.dispatch({changes:{from:view.state.selection.main.head,insert:'X'},userEvent:'input.type'});expect(view.state.doc.toString()).toBe('GammaX');expect(undoDepth(view.state)).toBe(1);
});
it('retains a native interior caret without forcing the end of the cell',()=>{tap();caret(1);time+=13;caret(3);expect(view.state.selection.main.head).toBe(1);});
it('leaves a different second native position alone',()=>{tap();caret(5);time+=13;caret(1);expect(view.state.selection.main.head).toBe(1);});
it('leaves a normal tap with no rollback alone',()=>{tap();caret(5);expect(view.state.selection.main.head).toBe(5);});
it.each(['pointercancel','beforeinput','compositionstart','blur'])('invalidates correction on %s',type=>{tap();caret(5);view.contentDOM.dispatchEvent(new Event(type,{bubbles:true}));caret(3);expect(view.state.selection.main.head).toBe(3);});
it('does not restore after the bounded native rollback interval',()=>{tap();caret(5);time+=101;caret(3);expect(view.state.selection.main.head).toBe(3);});
it('does not restore after a text transaction changes the identity of the draft',()=>{tap();caret(5);view.dispatch({changes:{from:5,insert:'Z'}});caret(3);expect(view.state.selection.main.head).toBe(3);expect(view.state.doc.toString()).toBe('GammaZ');});
it('does not interfere with a dragged touch or a long press',()=>{
  pointer('pointerdown');pointer('pointermove',96,105);pointer('pointerup',96,105);caret(5);caret(3);expect(view.state.selection.main.head).toBe(3);
  time+=1000;pointer('pointerdown');time+=501;pointer('pointerup');caret(5);caret(3);expect(view.state.selection.main.head).toBe(3);
});
it('does not interfere with a double tap word selection or a nonempty range',()=>{
  tap();caret(5);time+=100;pointer('pointerdown');pointer('pointerup');caret(3);expect(view.state.selection.main.head).toBe(3);
  time+=1000;tap();caret(1,4);expect(view.state.selection.main.from).toBe(1);expect(view.state.selection.main.to).toBe(4);caret(3);expect(view.state.selection.main.head).toBe(3);
});
it.each([['mouse',true],['touch',false]])('ignores %s primary=%s', (type,primary)=>{pointer('pointerdown',86,90,type as string,primary as boolean);pointer('pointerup',86,90,type as string,primary as boolean);caret(5);caret(3);expect(view.state.selection.main.head).toBe(3);});
it('removes its listener lease when the child editor is destroyed',()=>{tap();caret(5);dispose();caret(3);expect(view.state.selection.main.head).toBe(3);});
it('registers the actual ViewPlugin after CodeMirror initializes its native selection observer',async()=>{
  dispose();view.destroy();document.body.replaceChildren();
  view=new EditorView({parent:document.body,state:EditorState.create({doc:'Gamma',extensions:[history(),tableCellCaret]})});
  view.dispatch({selection:{anchor:3}});view.focus();await Promise.resolve();
  tap();caret(5);time+=13;caret(3);expect(view.state.selection.main.head).toBe(5);expect(document.getSelection()!.anchorOffset).toBe(5);expect(undoDepth(view.state)).toBe(0);
});
it('does not arm on an already read-only draft',()=>{
  view.dispatch({effects:StateEffect.appendConfig.of(EditorState.readOnly.of(true))});tap();caret(5);caret(3);expect(view.state.selection.main.head).toBe(3);expect(undoDepth(view.state)).toBe(0);
});
it('drops a pending correction when write permission changes',()=>{
  tap();caret(5);view.dispatch({effects:StateEffect.appendConfig.of(EditorState.readOnly.of(true))});caret(3);expect(view.state.selection.main.head).toBe(3);
});
it('does not attach a queued lease after an editor has already been destroyed',async()=>{
  dispose();view.destroy();document.body.replaceChildren();
  const obsolete=new EditorView({parent:document.body,state:EditorState.create({doc:'obsolete',extensions:[tableCellCaret]})});obsolete.destroy();
  view=new EditorView({parent:document.body,state:EditorState.create({doc:'Gamma',extensions:[history()]})});view.dispatch({selection:{anchor:3}});view.focus();await Promise.resolve();
  tap();caret(5);caret(3);expect(view.state.selection.main.head).toBe(3);
});
