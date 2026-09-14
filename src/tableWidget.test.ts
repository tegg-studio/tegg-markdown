// @vitest-environment jsdom
import {beforeAll,afterEach,describe,it,expect,vi} from 'vitest';
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history,undo} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {ensureSyntaxTree} from '@codemirror/language';
import {GFM} from '@lezer/markdown';
import {livePreview} from './livePreview';
const source='before\n\n| A | B |\n| --- | --- |\n| old | 2 |\n\nafter';
const views:EditorView[]=[];
beforeAll(()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}unobserve(){}});
  Range.prototype.getClientRects=()=>({length:0,item:()=>null,[Symbol.iterator]:function*(){}}) as DOMRectList;
  Range.prototype.getBoundingClientRect=()=>new DOMRect();
});
afterEach(()=>{views.forEach(view=>{view.destroy();view.dom.parentElement?.remove();});views.length=0;Object.defineProperty(window,'innerWidth',{value:1024,configurable:true});});
function mount(){const parent=document.body.appendChild(document.createElement('div'));const view=new EditorView({parent,state:EditorState.create({doc:source,selection:{anchor:source.length},extensions:[history(),markdown({extensions:GFM}),livePreview]})});ensureSyntaxTree(view.state,view.state.doc.length,1000);view.dispatch({});views.push(view);return {view,parent};}
function cell(parent:HTMLElement,value:string){return parent.querySelector<HTMLButtonElement>(`button[aria-label="Edit table cell: ${value}"]`)!;}
function active(parent:HTMLElement){return parent.querySelector<HTMLInputElement>('.cm-live-table-cell input:not([hidden])')!;}
function press(input:HTMLElement,key:string,shiftKey=false){input.dispatchEvent(new KeyboardEvent('keydown',{key,shiftKey,bubbles:true,cancelable:true}));}
function clickText(parent:HTMLElement,label:string){[...parent.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===label)!.click();}
function paste(target:HTMLElement,text:string){const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:(type:string)=>type==='text/plain'?text:'',types:['text/plain'],files:[]}});target.dispatchEvent(event);return event;}
describe('table user operations',()=>{
  it('commits a cell and navigates with Tab, preserving one-step undo',async()=>{
    const {view,parent}=mount();cell(parent,'old').click();active(parent).value='cat';press(active(parent),'Tab');await Promise.resolve();
    expect(view.state.doc.toString()).toBe(source.replace('old','cat'));expect(active(parent).value).toBe('2');
    press(active(parent),'Escape');expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(source);
  });
  it('appends the final row with its edited cell in one transaction',async()=>{
    const {view,parent}=mount();cell(parent,'2').click();active(parent).value='3';press(active(parent),'Tab');await Promise.resolve();
    expect(view.state.doc.toString()).toContain('| old | 3 |\n|  |  |');expect(active(parent).value).toBe('');press(active(parent),'Escape');undo(view);expect(view.state.doc.toString()).toBe(source);
  });
  it('combines a pending cell value and a column operation without using a stale range',()=>{
    const {view,parent}=mount();cell(parent,'old').click();active(parent).value='cat';clickText(parent,'Add Column');expect(view.state.doc.toString()).toContain('| cat | 2 |  |');undo(view);expect(view.state.doc.toString()).toBe(source);
  });
  it('retains editing when text before the table moves its offsets',()=>{
    const {view,parent}=mount();cell(parent,'old').click();active(parent).value='cat';view.dispatch({changes:{from:0,insert:'prefix\n'}});press(active(parent),'Enter');expect(view.state.doc.toString()).toBe('prefix\n'+source.replace('old','cat'));
  });
  it('rejects a changed target while preserving the cell draft until cancel',()=>{
    const {view,parent}=mount();cell(parent,'old').click();const input=active(parent);input.value='my draft';const at=source.indexOf('old');view.dispatch({changes:{from:at,to:at+3,insert:'external'}});
    press(input,'Enter');expect(view.state.doc.toString()).toContain('external');expect(view.state.doc.toString()).not.toContain('my draft');expect(input.value).toBe('my draft');expect(parent.querySelector('[role="alert"]')?.textContent).toContain('draft is retained');press(input,'Escape');expect(cell(parent,'external')).not.toBeNull();
  });
  it('reviews an expanding rectangle before one atomic paste',()=>{
    const {view,parent}=mount();cell(parent,'2').click();const event=paste(active(parent),'x\ty\nz\tw');expect(event.defaultPrevented).toBe(true);expect(view.state.doc.toString()).toBe(source);
    expect(parent.querySelector<HTMLElement>('.md-table-paste-review')!.hidden).toBe(false);clickText(parent,'Apply simplified paste');expect(view.state.doc.toString()).toContain('| old | x | y |\n|  | z | w |');undo(view);expect(view.state.doc.toString()).toBe(source);
  });
  it('copies a shift-selected rectangle through the Host clipboard event',()=>{
    const {parent}=mount();let copied='';parent.addEventListener('tegg-copy-text',event=>{copied=(event as CustomEvent<string>).detail;event.preventDefault();});
    cell(parent,'A').dispatchEvent(new MouseEvent('click',{shiftKey:true,bubbles:true}));cell(parent,'2').dispatchEvent(new MouseEvent('click',{shiftKey:true,bubbles:true}));clickText(parent,'Copy cells');expect(copied).toBe('A\tB\nold\t2');
  });
  it('provides a narrow-screen current-cell panel with apply and cancel',()=>{
    Object.defineProperty(window,'innerWidth',{value:375,configurable:true});const {view,parent}=mount();cell(parent,'old').click();const panel=parent.querySelector<HTMLElement>('.md-table-cell-panel')!;
    expect(panel.hidden).toBe(false);expect(panel.textContent).toContain('Row 2, column 1: A');const input=panel.querySelector('input')!;input.value='mobile';clickText(panel,'Cancel');expect(view.state.doc.toString()).toBe(source);
    cell(parent,'old').click();panel.querySelector('input')!.value='mobile';clickText(panel,'Apply');expect(view.state.doc.toString()).toBe(source.replace('old','mobile'));
  });
  it('delegates resource cells atomically and never writes temporary tokens without a Host',()=>{
    const {view,parent}=mount();cell(parent,'A').click();let detail:any;
    parent.addEventListener('tegg-table-resource-paste',event=>{detail=(event as CustomEvent).detail;event.preventDefault();});
    const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:(type:string)=>type==='text/html'?'<table><tr><th>Image</th></tr><tr><td><img src="a.png" alt="cat"></td></tr></table>':'',types:['text/html'],files:[new File([new Uint8Array([1])],'a.png',{type:'image/png'})]}});active(parent).dispatchEvent(event);
    expect(view.state.doc.toString()).toBe(source);expect(detail.expected).toContain('| old | 2 |');expect(detail.prepared.resources).toHaveLength(1);expect(detail.prepared.markdown).toContain('tegg-paste-resource-');expect(detail.prepared.cells).toBeUndefined();
  });
  it('changes delimiter alignment through the public table actions control',()=>{
    const {view,parent}=mount();cell(parent,'2').click();press(active(parent),'Escape');const menu=parent.querySelector<HTMLSelectElement>('select[aria-label="Table actions"]')!;menu.value='align-center';menu.dispatchEvent(new Event('change',{bubbles:true}));expect(view.state.doc.toString()).toContain('| --- | :---: |');
  });
});
