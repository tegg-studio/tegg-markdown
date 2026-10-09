// @vitest-environment jsdom
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {Compartment,EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history,undoDepth,redoDepth,undo} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {bindUI} from './uiContext';
import {mountCellDraftAuxiliary,cellDraftAuxiliaryAt,type CellDraftAuxiliaryRequest,type CellDraftAuxiliaryHost} from './cellDraftAuxiliary';
import {createHtmlPreview} from './renderKit';
import {attachHtmlTableEditing,executeHtmlTableCommand,htmlTableWidgetOwnsFocus} from './htmlTableWidget';
import {EditableTableWidget,focusedTableCell,tableWidgetIsComposing,executeFocusedTableCommand} from './tableWidget';
import {liveLinks} from './liveLinks';
import './livePreview';
const stops:Array<()=>void>=[];
beforeAll(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});Range.prototype.getClientRects=()=>({length:0,item:()=>null,[Symbol.iterator]:function*(){}}) as DOMRectList;Range.prototype.getBoundingClientRect=()=>new DOMRect();});
afterEach(()=>{stops.splice(0).reverse().forEach(stop=>stop());vi.restoreAllMocks();document.body.replaceChildren();});
const snapshot=(view:EditorView)=>({source:view.state.doc.toString(),selection:view.state.selection.toJSON(),undo:undoDepth(view.state),redo:redoDepth(view.state)});
const key=(node:HTMLElement,key:string)=>node.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
const pointer=(node:HTMLElement)=>node.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,cancelable:true}));
function host(){const portal=document.body.appendChild(document.createElement('aside')),requests:CellDraftAuxiliaryRequest[]=[];const adapter:CellDraftAuxiliaryHost={mount(request){requests.push(request);const container=portal.appendChild(document.createElement('div'));container.style.overflow='auto';return{container,dispose:()=>container.remove()};}};return{portal,requests,adapter};}
function fixture(kind:'html'|'gfm',optIn=true,locale:'en-US'|'zh-CN'='en-US'){
 const table=kind==='html'?'<table><tr><td><p>Alpha <strong>bold</strong></p></td><td>Beta</td></tr></table>':'| A | B |\n| --- | --- |\n| Alpha | Beta |',prefix='Before\n\n',source=prefix+table+'\n\nAfter';
 const root=document.body.appendChild(document.createElement('div')),overlay=document.body.appendChild(document.createElement('aside')),h=host(),access=new Compartment(),view=new EditorView({parent:root,state:EditorState.create({doc:source,selection:{anchor:2},extensions:[history(),markdown({extensions:GFM}),liveLinks,access.of(EditorState.readOnly.of(false))]})});
 const binding=bindUI(view.dom,{overlayContainer:overlay,mobile:true,locale,...optIn?{cellDraftAuxiliary:h.adapter}:{}});let panel:HTMLElement,stop:()=>void,begin:()=>void;
 if(kind==='html'){panel=createHtmlPreview({kind:'html',source:table,display:'block'});view.dom.append(panel);stop=attachHtmlTableEditing(panel,view,prefix.length,table)!;begin=()=>{const cell=panel.querySelector<HTMLTableCellElement>('td')!;cell.click();key(cell,'F2');};}
 else{const widget=new EditableTableWidget(table,prefix.length,prefix.length+table.length);panel=widget.toDOM(view);view.dom.append(panel);stop=()=>widget.destroy(panel);begin=()=>panel.querySelector<HTMLButtonElement>('[data-table-row="1"][data-table-column="1"] button')!.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));}
 stops.push(()=>{stop();binding.destroy();view.destroy();});return{view,panel,source,begin,h,overlay,binding,readonly:()=>view.dispatch({effects:access.reconfigure(EditorState.readOnly.of(true))}),stop};
}

describe('finite real cell auxiliary controls',()=>{
 it.each(['mouse','touch'] as const)('routes the actual GFM cell padding through the existing %s selection/edit sequence',device=>{
  const f=fixture('gfm'),cell=f.panel.querySelector<HTMLElement>('[data-table-row="1"][data-table-column="0"]')!,before=snapshot(f.view);
  const touch=(type:string)=>{const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:50,clientY:60});Object.defineProperties(event,{pointerType:{value:'touch'},pointerId:{value:1}});cell.dispatchEvent(event);};
  if(device==='touch'){touch('pointerdown');touch('pointerup');}cell.click();expect(f.h.requests).toHaveLength(0);expect(cell.getAttribute('aria-selected')).toBe('true');
  if(device==='touch'){touch('pointerdown');touch('pointerup');}else cell.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:50,clientY:60}));
  expect(f.h.requests).toHaveLength(1);const r=f.h.requests[0];expect(r.owner).toBe(cell);expect(focusedTableCell(f.view)!.state.doc.toString()).toBe('Alpha');expect(snapshot(f.view)).toEqual(before);
  focusedTableCell(f.view)!.contentDOM.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));expect(f.h.requests).toHaveLength(1);expect(r.current()).toBe(true);r.actions.cancel.click();expect(snapshot(f.view)).toEqual(before);
 });
 it.each(['html','gfm'] as const)('uses the complete Chinese labels for actual %s actions',kind=>{const f=fixture(kind,true,'zh-CN');f.begin();const a=f.h.requests[0].actions;expect([a.cancel.textContent,a.done.textContent,a.lineBreak.textContent,a.more.querySelector('summary')!.textContent]).toEqual(['取消','完成','换行','更多']);});
 it.each(['html','gfm'] as const)('updates the actual detached %s labels when the source locale changes',async kind=>{const f=fixture(kind);f.begin();const r=f.h.requests[0];expect(r.actions.cancel.textContent).toBe('Cancel');f.binding.update({locale:'zh-CN'});await Promise.resolve();await Promise.resolve();expect([r.actions.cancel.textContent,r.actions.done.textContent,r.actions.lineBreak.textContent,r.actions.more.querySelector('summary')!.textContent]).toEqual(['取消','完成','换行','更多']);r.actions.cancel.click();expect(r.current()).toBe(false);});
 it.each(['html','gfm'] as const)('keeps %s stale-source actions owned without committing over the new source',kind=>{
  const f=fixture(kind);f.begin();const r=f.h.requests[0];f.view.dispatch({changes:{from:0,to:f.view.state.doc.length,insert:f.source.replace('Alpha','Remote')}});const before=snapshot(f.view);expect(r.current()).toBe(true);r.actions.done.click();expect(r.current()).toBe(true);expect(snapshot(f.view)).toEqual(before);r.actions.cancel.click();expect(r.current()).toBe(kind==='html');if(kind==='html')expect(f.panel.querySelector('.md-html-table-error')!.textContent).toContain('current document projection could not be refreshed');expect(snapshot(f.view)).toEqual(before);
 });
 it('keeps read-only GFM Cancel ownership and rejects dirty child Done',()=>{const f=fixture('gfm');f.begin();const r=f.h.requests[0],child=focusedTableCell(f.view)!;child.dispatch({changes:{from:0,to:child.state.doc.length,insert:'local'}});f.readonly();const before=snapshot(f.view);expect(r.current()).toBe(true);r.actions.done.click();expect(r.current()).toBe(true);expect(snapshot(f.view)).toEqual(before);r.actions.cancel.click();expect(r.current()).toBe(false);expect(snapshot(f.view)).toEqual(before);});

 it.each(['html','gfm'] as const)('does not mount new controls without explicit %s Host opt-in',kind=>{const f=fixture(kind,false);f.begin();expect(f.h.requests).toHaveLength(0);expect(document.querySelector('.md-cell-draft-auxiliary-controls')).toBeNull();});
 it.each(['html','gfm'] as const)('mounts actual %s actions in fixed order and expires on cancel/reopen',kind=>{
  const f=fixture(kind),before=snapshot(f.view);f.begin();const first=f.h.requests[0];expect(first.kind).toBe(kind);expect(first.owner.closest('td')).not.toBeNull();expect(first.current()).toBe(true);expect([...first.controls.children]).toEqual([first.actions.cancel,first.actions.done,first.actions.lineBreak,first.actions.more]);expect(f.h.portal.contains(first.controls)).toBe(true);expect(snapshot(f.view)).toEqual(before);
  first.actions.cancel.click();expect(first.current()).toBe(false);expect(first.controls.isConnected).toBe(false);expect(snapshot(f.view)).toEqual(before);f.begin();expect(f.h.requests).toHaveLength(2);expect(f.h.requests[1].current()).toBe(true);expect(first.current()).toBe(false);first.actions.done.click();expect(snapshot(f.view)).toEqual(before);
 });
 it('preserves dirty HTML and backward DOM text selection when auxiliary controls receive real focus',()=>{
  const f=fixture('html');f.begin();const request=f.h.requests[0],cell=request.owner,text=cell.querySelector('p')!.firstChild!;const selection=document.getSelection()!;selection.setBaseAndExtent(text,4,text,1);document.dispatchEvent(new Event('selectionchange'));cell.querySelector('strong')!.textContent='local';cell.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));const before=snapshot(f.view);
  pointer(request.actions.lineBreak);request.actions.lineBreak.focus();expect(htmlTableWidgetOwnsFocus(f.view)).toBe(true);expect(cell.contentEditable).toBe('true');expect(cell.textContent).toContain('local');expect(snapshot(f.view)).toEqual(before);
  const exec=vi.fn(()=>{expect(selection.anchorNode).toBe(text);expect(selection.anchorOffset).toBe(4);expect(selection.focusOffset).toBe(1);return false;});Object.defineProperty(document,'execCommand',{configurable:true,value:exec});expect(executeHtmlTableCommand(f.view,'bold')).toBe(false);expect(exec).toHaveBeenCalledOnce();expect(snapshot(f.view)).toEqual(before);
  request.actions.cancel.click();expect(snapshot(f.view)).toEqual(before);expect(cell.textContent).toContain('bold');
 });
 it('owns only the actual detached More menu and restores summary focus on Escape',()=>{
  const f=fixture('html');f.begin();const r=f.h.requests[0],before=snapshot(f.view),more=r.actions.more as HTMLDetailsElement,summary=more.querySelector('summary')!;r.controls.style.fontSize='12px';summary.style.fontSize='17px';summary.style.lineHeight='22px';more.open=true;more.dispatchEvent(new Event('toggle'));const menu=f.overlay.querySelector<HTMLElement>('.md-cell-draft-more-menu')!;expect(menu).not.toBeNull();expect(menu.style.fontSize).toBe('17px');expect(menu.style.lineHeight).toBe('22px');expect(r.controls.contains(menu)).toBe(false);expect(cellDraftAuxiliaryAt(f.view,menu.querySelector('button'))?.owner).toBe(r.owner);pointer(menu.querySelector('button')!);expect(r.current()).toBe(true);expect(snapshot(f.view)).toEqual(before);
  const fake=document.body.appendChild(document.createElement('div'));fake.className=menu.className;expect(cellDraftAuxiliaryAt(f.view,fake)).toBeNull();menu.querySelector<HTMLButtonElement>('button')!.focus();key(menu,'Escape');expect(document.activeElement).toBe(summary);expect(more.open).toBe(false);expect(menu.parentElement).toBe(more);expect(f.overlay.querySelector('.md-cell-draft-more-menu')).toBeNull();expect(snapshot(f.view)).toEqual(before);
 });
 it('keeps read-only HTML Cancel ownership while blocking Done and inline writes',()=>{const f=fixture('html');f.begin();const r=f.h.requests[0];r.owner.querySelector('strong')!.textContent='local';r.owner.dispatchEvent(new InputEvent('input',{bubbles:true}));f.readonly();const before=snapshot(f.view);expect(r.current()).toBe(true);r.actions.done.click();expect(r.current()).toBe(true);expect(snapshot(f.view)).toEqual(before);r.actions.cancel.click();expect(r.current()).toBe(false);expect(snapshot(f.view)).toEqual(before);});
 it('directs GFM line break and Done to cell B only with one parent Undo',()=>{
  const f=fixture('gfm');f.begin();const r=f.h.requests[0],child=focusedTableCell(f.view)!;expect(child.state.doc.toString()).toBe('Beta');child.dispatch({selection:{anchor:child.state.doc.length}});const childSelection=child.state.selection.toJSON();r.actions.lineBreak.focus();expect(child.state.selection.toJSON()).toEqual(childSelection);expect(focusedTableCell(f.view)).toBe(child);r.actions.lineBreak.click();expect(child.state.doc.toString()).toBe('Beta<br>');expect(f.view.state.doc.toString()).toBe(f.source);expect(undoDepth(f.view.state)).toBe(0);r.actions.done.click();expect(f.view.state.doc.toString()).toBe(f.source.replace('| Alpha | Beta |','| Alpha | Beta<br> |'));expect(r.current()).toBe(false);expect(undoDepth(f.view.state)).toBe(1);expect(undo(f.view)).toBe(true);expect(f.view.state.doc.toString()).toBe(f.source);
 });
 it('keeps real GFM child IME when focus moves into owned auxiliary controls and never replays',()=>{
  const f=fixture('gfm');f.begin();const r=f.h.requests[0],child=focusedTableCell(f.view)!;child.contentDOM.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));r.actions.lineBreak.focus();expect(tableWidgetIsComposing(f.view)).toBe(true);const before=snapshot(f.view),body=child.state.doc.toString();r.actions.lineBreak.click();r.actions.done.click();r.actions.cancel.click();expect(r.current()).toBe(true);expect(child.state.doc.toString()).toBe(body);expect(snapshot(f.view)).toEqual(before);child.contentDOM.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));expect(child.state.doc.toString()).toBe(body);expect(snapshot(f.view)).toEqual(before);
 });
 it('routes a command from the actual GFM auxiliary control to its own child and not the parent caret',()=>{
  const f=fixture('gfm');f.begin();const r=f.h.requests[0],child=focusedTableCell(f.view)!;child.dispatch({selection:{anchor:0,head:4}});const before=snapshot(f.view);r.actions.done.focus();expect(executeFocusedTableCommand(f.view,'bold')).toBe(true);expect(child.state.doc.toString()).toBe('**Beta**');expect(snapshot(f.view)).toEqual(before);r.actions.cancel.click();expect(snapshot(f.view)).toEqual(before);
 });
 it('revokes registered menus and controls before Host disposal without author class authorization',()=>{
  const parent=document.body.appendChild(document.createElement('div')),view=new EditorView({parent,state:EditorState.create({doc:'Source',extensions:[history()]})});stops.push(()=>view.destroy());const owner=parent.appendChild(document.createElement('div')),controls=owner.appendChild(document.createElement('div')),cancel=document.createElement('button'),done=document.createElement('button'),lineBreak=document.createElement('button'),more=document.createElement('details');controls.append(cancel,done,lineBreak,more);const token={},menu=document.body.appendChild(document.createElement('div')),slot=document.body.appendChild(document.createElement('aside'));let current=true,lease:ReturnType<typeof mountCellDraftAuxiliary>;
  lease=mountCellDraftAuxiliary(view,{kind:'html',owner,controls,actions:{cancel,done,lineBreak,more},draftToken:token,current:()=>current,composing:()=>false,releaseControls:()=>owner.append(controls)},{mount:()=>({container:slot,dispose:()=>{expect(cellDraftAuxiliaryAt(view,controls)).toBeNull();expect(cellDraftAuxiliaryAt(view,menu)).toBeNull();}})});expect(lease).not.toBeNull();const old=lease!.ownMenu(menu),newer=lease!.ownMenu(menu);old();expect(cellDraftAuxiliaryAt(view,menu)?.token).toBe(token);newer();expect(cellDraftAuxiliaryAt(view,menu)).toBeNull();lease!.ownMenu(menu);lease!.dispose();current=false;expect(lease!.owns(menu)).toBe(false);expect(snapshot(view).source).toBe('Source');
 });
});

it.each(['html','gfm'] as const)('selects the actual %s cell on first touchup and edits on the second without compatibility click',kind=>{
 const f=fixture(kind),before=snapshot(f.view),cell=f.panel.querySelector<HTMLElement>(kind==='gfm'?'[data-table-row="1"][data-table-column="0"]':'td')!;
 const target=kind==='gfm'?cell.querySelector<HTMLElement>('button')!:cell.querySelector<HTMLElement>('strong')!;
 let id=1;const touch=(type:string)=>{const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:50,clientY:60});Object.defineProperties(event,{pointerType:{value:'touch'},pointerId:{value:id}});target.dispatchEvent(event);};
 touch('pointerdown');touch('pointerup');expect(cell.getAttribute('aria-selected')).toBe('true');expect(f.h.requests).toHaveLength(0);expect(snapshot(f.view)).toEqual(before);
 id++;touch('pointerdown');touch('pointerup');expect(f.h.requests).toHaveLength(1);expect(f.h.requests[0].owner).toBe(cell);expect(snapshot(f.view)).toEqual(before);
 if(kind==='gfm')expect(focusedTableCell(f.view)!.state.doc.toString()).toBe('Alpha');else expect(cell.contentEditable).toBe('true');
 f.h.requests[0].actions.cancel.click();expect(snapshot(f.view)).toEqual(before);
});

it.each(['html','gfm'] as const)('preserves the actual %s draft caret before native More mouse activation and cleans up the listener',kind=>{
 const f=fixture(kind);f.begin();const r=f.h.requests[0],summary=r.actions.more.querySelector('summary')!,before=snapshot(f.view);
 const owner=kind==='gfm'?focusedTableCell(f.view)!.contentDOM:r.owner;
 owner.focus();const selection=document.getSelection()!,range=document.createRange();range.selectNodeContents(owner);range.collapse(false);selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));
 const anchor=selection.anchorNode,offset=selection.anchorOffset,focus=selection.focusNode,focusOffset=selection.focusOffset;
 const event=new MouseEvent('mousedown',{button:0,bubbles:true,cancelable:true});summary.dispatchEvent(event);
 expect(event.defaultPrevented).toBe(true);expect(document.activeElement).toBe(owner);expect([selection.anchorNode,selection.anchorOffset,selection.focusNode,selection.focusOffset]).toEqual([anchor,offset,focus,focusOffset]);expect(snapshot(f.view)).toEqual(before);
 const secondary=new MouseEvent('mousedown',{button:2,bubbles:true,cancelable:true});summary.dispatchEvent(secondary);expect(secondary.defaultPrevented).toBe(false);
 r.actions.cancel.click();const retired=new MouseEvent('mousedown',{button:0,bubbles:true,cancelable:true});summary.dispatchEvent(retired);expect(retired.defaultPrevented).toBe(false);expect(snapshot(f.view)).toEqual(before);
});
