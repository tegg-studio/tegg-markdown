// @vitest-environment jsdom
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {EditorState,StateEffect} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {forceParsing} from '@codemirror/language';
import {history,undoDepth,redoDepth} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {EditingController,objectAt,type EditingIdentity} from './editingController';
import {attachEditingUI} from './editingUI';
import {livePreview} from './livePreview';
import {focusedTableCell,tableWidgetOwnsFocus} from './tableWidget';
import {resourceContext} from './editorHost';

const source='Alpha\n\n| Name | State |\n| --- | --- |\n| Task | Ready |\n\n```mermaid\nflowchart LR\nA --> B\n```\n\nEnd';
const teardown:Array<()=>void>=[];
beforeAll(()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}unobserve(){}});
  Range.prototype.getClientRects=()=>({length:0,item:()=>null,[Symbol.iterator]:function*(){}}) as DOMRectList;
  Range.prototype.getBoundingClientRect=()=>new DOMRect();
});
afterEach(()=>{teardown.splice(0).reverse().forEach(dispose=>dispose());});
function fixture(){
  const root=document.body.appendChild(document.createElement('div'));
  const overlays=document.body.appendChild(document.createElement('div'));
  const view=new EditorView({parent:root,state:EditorState.create({doc:source,selection:{anchor:1},extensions:[history(),markdown({extensions:GFM}),resourceContext.of({profile:'tegg',documentPath:'/fixtures/cross-object.md',engines:{}}),livePreview]})});
  forceParsing(view,1000);
  let identity:EditingIdentity={documentId:'cross-object',generation:'g1',profile:'tegg',mode:'live'};
  const controller=new EditingController(view,{identity:()=>identity});
  const onError=vi.fn(),ui=attachEditingUI(controller,overlays,{toolbar:false,onError});
  const preview=root.querySelector<HTMLButtonElement>('button[aria-label="Edit table cell: Name"]')!;
  expect(preview).not.toBeNull();preview.focus();
  expect(document.activeElement).toBe(preview);expect(tableWidgetOwnsFocus(view)).toBe(true);
  const target=objectAt(view.state,source.indexOf('flowchart'),controller.identity.profile)!;
  expect(target).toMatchObject({kind:'mermaid',from:source.indexOf('```mermaid'),to:source.indexOf('\n\nEnd')});
  const snapshot=()=>({source:view.state.doc.toString(),selection:view.state.selection.toJSON(),undo:undoDepth(view.state),redo:redoDepth(view.state)});
  const panel=()=>overlays.querySelector<HTMLElement>('.tegg-editing-panel')!;
  const editEvent=(detail:unknown)=>{const event=new CustomEvent('tegg-edit-object',{bubbles:true,cancelable:true,detail});view.dom.dispatchEvent(event);return event;};
  teardown.push(()=>{ui.destroy();controller.destroy();view.destroy();root.remove();overlays.remove();});
  return {root,view,controller,ui,onError,preview,target,snapshot,panel,editEvent,setIdentity:(patch:Partial<EditingIdentity>)=>{identity={...identity,...patch};}};
}
function cancel(f:ReturnType<typeof fixture>){
  const button=f.panel().querySelector<HTMLButtonElement>('button[data-label="Cancel"]')!;
  expect(button).not.toBeNull();button.click();
  expect(f.panel().hidden).toBe(true);expect(f.controller.session?.status).toBe('cancelled');
}

describe('explicit object range after a real table preview owns focus',()=>{
  it('retains implicit table routing but opens the parser-backed Mermaid event and cancels without source, caret or history changes',()=>{
    const f=fixture(),before=f.snapshot();
    f.ui.openObject('mermaid');expect(f.panel().hidden).toBe(true);expect(f.controller.session).toBeNull();expect(f.snapshot()).toEqual(before);
    const event=f.editEvent(f.target);expect(event.defaultPrevented).toBe(true);
    expect(f.panel().hidden).toBe(false);expect(f.panel().dataset.kind).toBe('mermaid');
    expect(f.controller.session).toMatchObject({...f.target,original:source.slice(f.target.from,f.target.to),status:'editing'});
    expect(f.panel().querySelector<HTMLTextAreaElement>('.tegg-object-body')?.value).toBe('flowchart LR\nA --> B');
    expect(f.snapshot()).toEqual(before);cancel(f);expect(f.snapshot()).toEqual(before);expect(document.activeElement).toBe(f.preview);
  });
  it.each([
    {from:-1,to:4},{from:8,to:7},{from:1.5,to:4},{from:0,to:source.length+1},
  ])('rejects invalid explicit bounds without opening a draft: %j',range=>{
    const f=fixture(),before=f.snapshot();expect(()=>f.ui.openObject('mermaid',range)).toThrow('invalid-range');
    expect(f.panel().hidden).toBe(true);expect(f.controller.session).toBeNull();expect(f.snapshot()).toEqual(before);
  });
  it('reports an invalid object event through the current UI without granting a draft',()=>{
    const f=fixture(),before=f.snapshot();const event=f.editEvent({kind:'mermaid',from:-1,to:8});
    expect(event.defaultPrevented).toBe(true);expect(f.onError).toHaveBeenCalledOnce();expect(f.panel().hidden).toBe(true);expect(f.controller.session).toBeNull();expect(f.snapshot()).toEqual(before);
  });
  it.each(['identity','state'] as const)('keeps the %s readonly gate before explicit range activation',kind=>{
    const f=fixture();if(kind==='identity')f.setIdentity({readOnly:true});else f.view.dispatch({effects:StateEffect.appendConfig.of(EditorState.readOnly.of(true))});
    f.preview.focus();const before=f.snapshot();expect(()=>f.ui.openObject('mermaid',f.target)).toThrow('read-only');
    expect(f.panel().hidden).toBe(true);expect(f.controller.session).toBeNull();expect(f.snapshot()).toEqual(before);
  });
  it('keeps the current profile gate before beginning the explicit object',()=>{
    const f=fixture(),before=f.snapshot();f.setIdentity({profile:'gfm'});
    expect(()=>f.ui.openObject('mermaid',f.target)).toThrow('unsupported-profile');expect(f.controller.session).toBeNull();expect(f.panel().hidden).toBe(true);expect(f.snapshot()).toEqual(before);
  });
  it('does not replace an existing parent draft or inherit its token',()=>{
    const f=fixture(),before=f.snapshot();f.ui.openObject('mermaid',f.target);const old=f.controller.session!;
    f.controller.updateDraft(old.token,old.original.replace('A --> B','A --> C'));
    expect(()=>f.ui.openObject('mermaid',f.target)).toThrow('Finish or cancel the current object draft first');
    expect(f.controller.session).toMatchObject({token:old.token,draft:old.original.replace('A --> B','A --> C')});expect(f.snapshot()).toEqual(before);
    f.ui.close();expect(f.snapshot()).toEqual(before);
  });
  it('retains a genuinely focused dirty cell draft instead of finishing it to open a different parent object',()=>{
    const f=fixture();f.preview.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const child=focusedTableCell(f.view)!;
    expect(child).not.toBeNull();child.dispatch({changes:{from:0,to:child.state.doc.length,insert:'Local unsaved'}});
    const before=f.snapshot();f.ui.openObject('mermaid',f.target);
    expect(f.controller.session).toBeNull();expect(f.panel().hidden).toBe(true);expect(focusedTableCell(f.view)).toBe(child);expect(child.state.doc.toString()).toBe('Local unsaved');expect(f.snapshot()).toEqual(before);
  });
  it('rejects real cell composition and never replays the earlier explicit event after composition ends',()=>{
    const f=fixture();f.preview.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const child=focusedTableCell(f.view)!;
    child.dom.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));const before=f.snapshot();
    f.editEvent(f.target);expect(f.onError).toHaveBeenCalledOnce();expect(f.onError.mock.calls[0][0].message).toBe('composing');expect(f.controller.session).toBeNull();
    child.dom.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));expect(f.panel().hidden).toBe(true);expect(f.controller.session).toBeNull();expect(focusedTableCell(f.view)).toBe(child);expect(f.snapshot()).toEqual(before);
    child.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(focusedTableCell(f.view)).toBeNull();
    f.editEvent(f.target);expect(f.panel().hidden).toBe(false);cancel(f);expect(f.snapshot()).toEqual(before);
  });
});
