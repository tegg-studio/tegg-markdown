// @vitest-environment jsdom
import {afterEach, beforeAll, expect, it, vi} from 'vitest';
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history, undoDepth} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {ensureSyntaxTree} from '@codemirror/language';
import {GFM} from '@lezer/markdown';
import {livePreview} from './livePreview';
import {focusedTableCell} from './tableWidget';
import {bindUI} from './uiContext';
import {calloutTypeButton} from './calloutInteraction';
const cleanup:(()=>void)[]=[];
beforeAll(()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}unobserve(){}});
 Range.prototype.getClientRects=()=>({length:0,item:()=>null,[Symbol.iterator]:function*(){}}) as DOMRectList;
 Range.prototype.getBoundingClientRect=()=>new DOMRect();
});
afterEach(()=>{for(const stop of cleanup.splice(0).reverse())stop();});
function mount(source:string,preview=true){
 const parent=document.body.appendChild(document.createElement('div')),ui=bindUI(parent,{locale:'en-US'});
 const view=new EditorView({parent,state:EditorState.create({doc:source,selection:{anchor:source.length},extensions:[history(),markdown({extensions:GFM}),...(preview?livePreview:[])]})});
 ensureSyntaxTree(view.state,view.state.doc.length,1000);view.dispatch({});cleanup.push(()=>{view.destroy();ui.destroy();parent.remove();});return{parent,ui,view};
}
it.each([['Gamma','Gamma'],['中文','中文'],['Empty','Empty'],['','空']])('localizes the actual GFM child editor without translating authored %s',async(value,chineseValue)=>{
 const source=`| A | B |\n| --- | --- |\n| ${value} | Beta |`,{parent,ui,view}=mount(source);
 const preview=[...parent.querySelectorAll<HTMLButtonElement>('.cm-live-table-preview')].find(button=>button.getAttribute('aria-label')===`Edit table cell: ${value}`)!;
 preview.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const child=focusedTableCell(view)!;expect(child).toBeDefined();
 const childSelection=child.state.selection,depth=undoDepth(view.state),childDepth=undoDepth(child.state);
 expect(child.contentDOM.getAttribute('aria-label')).toBe(`Table cell: ${value||'Empty'}`);
 ui.update({locale:'zh-CN'});await vi.waitFor(()=>expect(child.contentDOM.getAttribute('aria-label')).toBe(`表格单元格：${chineseValue}`));
 const retained=preview.parentElement!.querySelector('input')!;expect(retained.getAttribute('aria-label')).toBe(`表格单元格：${chineseValue}`);
 expect(focusedTableCell(view)).toBe(child);expect(child.state.selection.eq(childSelection)).toBe(true);expect(child.state.doc.toString()).toBe(value);expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(depth);expect(undoDepth(child.state)).toBe(childDepth);
 ui.update({locale:'en-US',messages:{'Table cell: {value}':'Draft {value}','Empty':'vacant'}});
 await vi.waitFor(()=>expect(child.contentDOM.getAttribute('aria-label')).toBe(`Draft ${value||'vacant'}`));expect(focusedTableCell(view)).toBe(child);
});
it.each([['tip','Tip'],['hint','Tip'],['warning','Warning'],['CUSTOM_X','CUSTOM_X']])('localizes the %s callout action and preserves the catalog or authored type',async(type,label)=>{
 const {parent,ui,view}=mount('unchanged',false),button=calloutTypeButton(view,7,type);parent.append(button);
 let detail:unknown;view.dom.addEventListener('tegg-callout-menu',e=>detail=(e as CustomEvent).detail);
 expect(button.getAttribute('aria-label')).toBe(`Change ${label} callout type`);ui.update({locale:'zh-CN'});
 await vi.waitFor(()=>expect(button.getAttribute('aria-label')).toBe(`更改“${label}”提示块类型`));expect(button.title).toBe(`更改“${label}”提示块类型`);
 button.click();expect(detail).toMatchObject({from:7});expect(view.state.doc.toString()).toBe('unchanged');expect(undoDepth(view.state)).toBe(0);
 ui.update({locale:'en-US',messages:{'Change {value} callout type':'Type action {value}'}});expect(button.getAttribute('aria-label')).toBe(`Type action ${label}`);expect(button.title).toBe(`Type action ${label}`);
});

it('localizes actual Callout fold actions without changing authored source or Undo history',async()=>{
 const source='> [!TIP] Authored title\n> 中文正文 and English';
 const {parent,ui,view}=mount(source),selection=view.state.selection;
 const fold=()=>parent.querySelector<HTMLButtonElement>('.callout-fold')!;
 expect(fold().getAttribute('aria-expanded')).toBe('true');expect(fold().getAttribute('aria-label')).toBe('Collapse Callout');
 ui.update({locale:'zh-CN'});await vi.waitFor(()=>expect(fold().getAttribute('aria-label')).toBe('折叠提示块'));
 fold().click();expect(fold().getAttribute('aria-expanded')).toBe('false');await vi.waitFor(()=>expect(fold().getAttribute('aria-label')).toBe('展开提示块'));
 ui.update({locale:'en-US'});await vi.waitFor(()=>expect(fold().getAttribute('aria-label')).toBe('Expand Callout'));
 fold().click();expect(fold().getAttribute('aria-expanded')).toBe('true');expect(fold().getAttribute('aria-label')).toBe('Collapse Callout');
 expect(view.state.doc.toString()).toBe(source);expect(view.state.selection.eq(selection)).toBe(true);expect(undoDepth(view.state)).toBe(0);
});
