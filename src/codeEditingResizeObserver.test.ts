/** @vitest-environment jsdom */
import {EditorState} from '@codemirror/state';
import type {EditorView} from '@codemirror/view';
import {history,undoDepth,redoDepth} from '@codemirror/commands';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {EditableCodeWidget} from './codeEditing';

let frames:Map<number,FrameRequestCallback>,serial:number,observers:Observer[];
const mounted:Array<{widget:EditableCodeWidget;wrapper:HTMLElement}>=[];
class Observer {
  target?:Element;
  disconnect=vi.fn();
  constructor(readonly callback:ResizeObserverCallback){observers.push(this);}
  observe(target:Element){this.target=target;}
  emit(width:number){this.callback([{target:this.target,contentRect:{width}} as ResizeObserverEntry],this as unknown as ResizeObserver);}
}
beforeEach(()=>{
  frames=new Map();serial=0;observers=[];
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{const id=++serial;frames.set(id,callback);return id;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  vi.stubGlobal('ResizeObserver',Observer);
});
afterEach(()=>{for(const item of mounted.splice(0))item.widget.destroy(item.wrapper);document.body.replaceChildren();vi.unstubAllGlobals();});
function flush(){const pending=[...frames.values()];frames.clear();for(const callback of pending)callback(0);}
function mount(){
  const raw='```text\nalpha\nbeta\n```',state=EditorState.create({doc:raw,extensions:[history()]}),measure=vi.fn();
  const view={state,requestMeasure:measure,composing:false} as unknown as EditorView;
  const widget=new EditableCodeWidget(raw,0,raw.length),wrapper=widget.toDOM(view);document.body.append(wrapper);mounted.push({widget,wrapper});
  const input=wrapper.querySelector('textarea')!,pre=wrapper.querySelector('pre')!;
  Object.defineProperty(input,'scrollHeight',{configurable:true,get:()=>72});Object.defineProperty(pre,'scrollHeight',{configurable:true,get:()=>96});
  return{raw,state,view,widget,wrapper,input,measure,observer:observers.at(-1)!};
}
describe('code area ResizeObserver scheduling',()=>{
  it('defers actual resize work out of an observer delivery and coalesces changing widths with paint',()=>{
    const f=mount();flush();expect(f.input.style.height).toBe('96px');expect(f.measure).toHaveBeenCalledTimes(1);
    f.input.scrollLeft=23;f.input.scrollTop=5;f.input.focus();f.input.setSelectionRange(1,3,'backward');
    f.observer.emit(580);f.observer.emit(564);f.widget.updateDOM(f.wrapper);f.observer.emit(564);
    expect(f.measure).toHaveBeenCalledTimes(1);expect(frames.size).toBe(1);expect(f.input.style.height).toBe('96px');
    flush();expect(f.measure).toHaveBeenCalledTimes(2);expect(frames.size).toBe(0);expect(f.input.style.height).toBe('96px');
    expect(f.input.scrollLeft).toBe(23);expect(f.input.scrollTop).toBe(5);expect(document.activeElement).toBe(f.input);expect([f.input.selectionStart,f.input.selectionEnd,f.input.selectionDirection]).toEqual([1,3,'backward']);
    expect(f.view.state).toBe(f.state);expect(f.state.doc.toString()).toBe(f.raw);expect(undoDepth(f.state)).toBe(0);expect(redoDepth(f.state)).toBe(0);
  });
  it('cancels the owned frame on destroy and refuses an already captured or late observer callback',()=>{
    const f=mount();flush();f.widget.updateDOM(f.wrapper);f.observer.emit(580);expect(frames.size).toBe(1);const callback=[...frames.values()][0];
    const before=f.input.style.height;f.widget.destroy(f.wrapper);expect(frames.size).toBe(0);expect(f.observer.disconnect).toHaveBeenCalledTimes(1);
    callback(0);f.observer.emit(564);expect(frames.size).toBe(0);expect(f.measure).toHaveBeenCalledTimes(1);expect(f.input.style.height).toBe(before);expect(f.state.doc.toString()).toBe(f.raw);
  });
  it('also cancels initial paint when ResizeObserver is unavailable',()=>{
    vi.stubGlobal('ResizeObserver',undefined);const f=mount();expect(frames.size).toBe(1);const callback=[...frames.values()][0];
    f.widget.destroy(f.wrapper);expect(frames.size).toBe(0);callback(0);expect(f.measure).not.toHaveBeenCalled();expect(f.input.style.height).toBe('');expect(f.state.doc.toString()).toBe(f.raw);
  });
  it('keeps explicit wrap resizing immediate without changing source or history',()=>{
    const f=mount();flush();f.observer.emit(580);const wrap=f.wrapper.querySelector<HTMLButtonElement>('button[aria-label="Wrap lines"]')!;
    wrap.click();expect(f.input.wrap).toBe('soft');expect(wrap.getAttribute('aria-pressed')).toBe('true');expect(f.measure).toHaveBeenCalledTimes(2);expect(frames.size).toBe(1);
    flush();expect(f.measure).toHaveBeenCalledTimes(3);expect(f.state.doc.toString()).toBe(f.raw);expect(undoDepth(f.state)).toBe(0);expect(redoDepth(f.state)).toBe(0);
  });
});
