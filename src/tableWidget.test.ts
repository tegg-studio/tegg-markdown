// @vitest-environment jsdom
import {beforeAll,afterEach,describe,it,expect,vi} from 'vitest';
import {EditorState,StateEffect,Transaction} from '@codemirror/state';
import {EditorView,runScopeHandlers} from '@codemirror/view';
import {history,undo} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {ensureSyntaxTree} from '@codemirror/language';
import {GFM} from '@lezer/markdown';
import {livePreview} from './livePreview';
import {focusedTableCell,focusedTableToolbarState,tableWidgetOwnsFocus,tableWidgetIsComposing,executeFocusedTableCommand} from './tableWidget';
const source='before\n\n| A | B |\n| --- | --- |\n| old | 2 |\n\nafter';
const views:EditorView[]=[];
beforeAll(()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}unobserve(){}});
  Range.prototype.getClientRects=()=>({length:0,item:()=>null,[Symbol.iterator]:function*(){}}) as DOMRectList;
  Range.prototype.getBoundingClientRect=()=>new DOMRect();
});
afterEach(()=>{views.forEach(view=>{view.destroy();view.dom.parentElement?.remove();});views.length=0;Object.defineProperty(window,'innerWidth',{value:1024,configurable:true});});
function mount(initialSource=source){const parent=document.body.appendChild(document.createElement('div'));const view=new EditorView({parent,state:EditorState.create({doc:initialSource,selection:{anchor:initialSource.length},extensions:[history(),markdown({extensions:GFM}),livePreview]})});ensureSyntaxTree(view.state,view.state.doc.length,1000);view.dispatch({});views.push(view);return {view,parent};}
function cell(parent:HTMLElement,value:string){return parent.querySelector<HTMLButtonElement>(`button[aria-label="Edit table cell: ${value}"]`)!;}
function active(parent:HTMLElement){return parent.querySelector<HTMLInputElement>('.cm-live-table-cell input:not([hidden])')!;}
function press(input:HTMLElement,key:string,shiftKey=false){input.dispatchEvent(new KeyboardEvent('keydown',{key,shiftKey,bubbles:true,cancelable:true}));}
function clickText(parent:HTMLElement,label:string){[...parent.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===label)!.click();}
function tableAction(parent:HTMLElement,value:string){const menu=parent.querySelector<HTMLSelectElement>('select[aria-label="Table actions"]')!;menu.value=value;menu.dispatchEvent(new Event('change',{bubbles:true}));}
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
    cell(parent,'A').dispatchEvent(new MouseEvent('click',{shiftKey:true,bubbles:true}));cell(parent,'2').dispatchEvent(new MouseEvent('click',{shiftKey:true,bubbles:true}));tableAction(parent,'copy-cells');expect(copied).toBe('A\tB\nold\t2');
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

describe('natural table-cell editing and focus routing',()=>{
  it('keeps formatted text projected while editing and applies toolbar formatting through the shared document',()=>{
    const document='| A | B |\n| --- | --- |\n| **重要** | plain |';
    const {view,parent}=mount(document);cell(parent,'**重要**').click();
    const editor=focusedTableCell(view)!;expect(editor).not.toBeNull();
    expect(editor.dom.isConnected).toBe(true);expect(editor.contentDOM.textContent).toBe('重要');
    expect(focusedTableToolbarState(view)?.bold).toBe(false);
    editor.dispatch({selection:{anchor:2,head:4}});
    expect(executeFocusedTableCommand(view,'italic')).toBe(true);
    expect(view.state.doc.toString()).toContain('**');
    expect(view.state.doc.toString()).toContain('*重要*');
    expect(editor.dom.isConnected).toBe(true);expect(editor.contentDOM.textContent).toBe('重要');
  });
  it('uses the outer history across edit, Tab, Shift-Tab, Escape, Undo and Redo',async()=>{
    const {view,parent}=mount();cell(parent,'old').click();
    const editor=focusedTableCell(view)!;editor.dispatch({changes:{from:0,to:3,insert:'cat'},selection:{anchor:3}});
    expect(view.state.doc.toString()).toBe(source.replace('old','cat'));
    press(editor.dom,'Tab');await Promise.resolve();
    const second=focusedTableCell(view)!;expect(second.state.doc.toString()).toBe('2');
    press(second.dom,'Tab',true);await Promise.resolve();
    const first=focusedTableCell(view)!;expect(first.state.doc.toString()).toBe('cat');
    press(first.dom,'Escape');expect(focusedTableCell(view)).toBeNull();
    const preview=cell(parent,'cat');preview.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,bubbles:true,cancelable:true}));
    expect(view.state.doc.toString()).toBe(source);
    await Promise.resolve();
    const restored=cell(parent,'old');expect(document.activeElement).toBe(restored);
    restored.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,shiftKey:true,bubbles:true,cancelable:true}));
    expect(view.state.doc.toString()).toBe(source.replace('old','cat'));
    await Promise.resolve();expect(document.activeElement).toBe(cell(parent,'cat'));
  });
  it('joins consecutive child typing into one outer undo event and separates the next cell',async()=>{
    const {view,parent}=mount();cell(parent,'old').click();const editor=focusedTableCell(view)!;
    editor.dispatch({changes:{from:0,to:3,insert:'c'},annotations:Transaction.userEvent.of('input.type')});
    editor.dispatch({changes:{from:1,insert:'a'},annotations:Transaction.userEvent.of('input.type')});
    editor.dispatch({changes:{from:2,insert:'t'},annotations:Transaction.userEvent.of('input.type')});
    expect(view.state.doc.toString()).toBe(source.replace('old','cat'));
    press(editor.dom,'Tab');await Promise.resolve();
    const next=focusedTableCell(view)!;
    next.dispatch({changes:{from:0,to:1,insert:'3'},annotations:Transaction.userEvent.of('input.type')});
    expect(view.state.doc.toString()).toContain('| cat | 3 |');
    expect(executeFocusedTableCommand(view,'undo')).toBe(true);
    expect(view.state.doc.toString()).toContain('| cat | 2 |');
    expect(executeFocusedTableCommand(view,'undo')).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });
  it('routes Undo and Redo through the outer document while the cell editor remains focused',()=>{
    const {view,parent}=mount();cell(parent,'old').click();const editor=focusedTableCell(view)!;
    editor.dispatch({changes:{from:0,to:3,insert:'new'}});
    expect(view.state.doc.toString()).toBe(source.replace('old','new'));
    expect(executeFocusedTableCommand(view,'undo')).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    expect(focusedTableCell(view)?.state.doc.toString()).toBe('old');
    expect(executeFocusedTableCommand(view,'redo')).toBe(true);
    expect(view.state.doc.toString()).toBe(source.replace('old','new'));
    expect(focusedTableCell(view)?.state.doc.toString()).toBe('new');
  });
  it('preserves inline-code literals and semantic highlight and HTML when a cell gains focus',()=>{
    const document='| A |\n| --- |\n| `==literal==` <u>yes</u> ==highlight== |';
    const {view,parent}=mount(document);cell(parent,'`==literal==` <u>yes</u> ==highlight==').click();
    const editor=focusedTableCell(view)!;
    expect(editor.contentDOM.textContent).toBe('==literal== yes highlight');
    expect(editor.dom.querySelector('.cm-live-inline-code')?.textContent).toBe('==literal==');
    expect(editor.dom.querySelector('.cm-live-u')?.textContent).toBe('yes');
    expect(editor.dom.querySelector('.cm-live-highlight')?.textContent).toBe('highlight');
    expect(view.state.doc.toString()).toBe(document);
  });
  it('projects a link label with an escaped closing bracket through its syntax-tree boundary',()=>{
    const document='| A |\n| --- |\n| [a \\] b](next.md) |';
    const {view,parent}=mount(document);
    [...parent.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.getAttribute('aria-label')==='Edit table cell: [a \\] b](next.md)')!.click();
    const editor=focusedTableCell(view)!;
    expect(editor.contentDOM.textContent).toBe('a ] b');
    expect(view.state.doc.toString()).toBe(document);
  });
  it('Backspace at hidden-marker boundaries edits visible content or removes the complete format',()=>{
    const document='| A |\n| --- |\n| **ab** |';
    const {view,parent}=mount(document);cell(parent,'**ab**').click();
    const editor=focusedTableCell(view)!;
    editor.dispatch({selection:{anchor:6}});
    expect(runScopeHandlers(editor,new KeyboardEvent('keydown',{key:'Backspace'}),'editor')).toBe(true);
    expect(view.state.doc.toString()).toContain('| **a** |');
    expect(runScopeHandlers(editor,new KeyboardEvent('keydown',{key:'Home'}),'editor')).toBe(true);
    expect(editor.state.selection.main.head).toBe(2);
    expect(runScopeHandlers(editor,new KeyboardEvent('keydown',{key:'Backspace'}),'editor')).toBe(true);
    expect(view.state.doc.toString()).toContain('| a |');
  });
  it('keeps format unwrapping as a separate undo event after typing',()=>{
    const document='| A |\n| --- |\n| **a** |';
    const {view,parent}=mount(document);cell(parent,'**a**').click();const editor=focusedTableCell(view)!;
    editor.dispatch({changes:{from:3,insert:'b'},annotations:Transaction.userEvent.of('input.type')});
    expect(view.state.doc.toString()).toContain('| **ab** |');
    expect(runScopeHandlers(editor,new KeyboardEvent('keydown',{key:'Home'}),'editor')).toBe(true);
    expect(runScopeHandlers(editor,new KeyboardEvent('keydown',{key:'Backspace'}),'editor')).toBe(true);
    expect(view.state.doc.toString()).toContain('| ab |');
    expect(executeFocusedTableCommand(view,'undo')).toBe(true);
    expect(view.state.doc.toString()).toContain('| **ab** |');
    expect(executeFocusedTableCommand(view,'undo')).toBe(true);
    expect(view.state.doc.toString()).toBe(document);
  });
  it('selects only the child cell when Mod-A is pressed inside the nested editor',()=>{
    const {view,parent}=mount();cell(parent,'old').click();const editor=focusedTableCell(view)!;
    expect(runScopeHandlers(editor,new KeyboardEvent('keydown',{key:'a',ctrlKey:true}),'editor')).toBe(true);
    expect(editor.state.selection.main.from).toBe(0);
    expect(editor.state.selection.main.to).toBe(3);
    expect(view.state.selection.main.empty).toBe(true);
  });
  it('opens the shared link destination editor for a new cell link',()=>{
    const {view,parent}=mount();cell(parent,'old').click();const editor=focusedTableCell(view)!;
    editor.dispatch({selection:{anchor:0,head:3}});
    expect(executeFocusedTableCommand(view,'link')).toBe(true);
    expect(view.state.doc.toString()).toContain('[old](https://)');
    const dialog=document.querySelector<HTMLElement>('[role="dialog"][aria-label="Edit link"]')!;
    expect(dialog).not.toBeNull();
    const destination=dialog.querySelector<HTMLInputElement>('input[aria-label="Link destination"]')!;
    destination.value='next.md';destination.dispatchEvent(new Event('input',{bubbles:true}));
    dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    expect(view.state.doc.toString()).toContain('[old](<next.md>)');
    expect(focusedTableCell(view)).toBe(editor);
    expect(editor.hasFocus).toBe(true);
    expect(executeFocusedTableCommand(view,'undo')).toBe(true);
    expect(view.state.doc.toString()).toContain('[old](https://)');
    expect(executeFocusedTableCommand(view,'redo')).toBe(true);
    expect(view.state.doc.toString()).toContain('[old](<next.md>)');
  });
  it('does not retain a cell command target when focus moves into another input',()=>{
    const {view,parent}=mount();cell(parent,'old').click();const cellEditor=focusedTableCell(view)!;
    cellEditor.dispatch({selection:{anchor:0,head:3}});
    const other=parent.appendChild(document.createElement('input'));other.focus();
    expect(focusedTableCell(view)).toBeNull();
    expect(executeFocusedTableCommand(view,'bold')).toBe(false);
    expect(view.state.doc.toString()).toBe(source);
  });
  it('keeps preview focus separate from the retained Callout selection and its commands',async()=>{
    const document='> [!NOTE] Heading\n> prose\n\n| A |\n| --- |\n| old |';
    const {view,parent}=mount(document);
    view.dispatch({selection:{anchor:document.indexOf('prose')+2}});
    cell(parent,'old').click();const editor=focusedTableCell(view)!;
    editor.dispatch({changes:{from:0,to:3,insert:'new'}});
    press(editor.dom,'Escape');
    expect(focusedTableCell(view)).toBeNull();expect(tableWidgetOwnsFocus(view)).toBe(true);
    expect(focusedTableToolbarState(view)).toMatchObject({inlineFormattingEnabled:false,callout:null,calloutEnabled:false});
    const changed=view.state.doc.toString();
    expect(executeFocusedTableCommand(view,'heading2')).toBe(true);
    expect(executeFocusedTableCommand(view,'bold')).toBe(true);
    expect(view.state.doc.toString()).toBe(changed);
    expect(executeFocusedTableCommand(view,'undo')).toBe(true);
    expect(view.state.doc.toString()).toBe(document);
    await Promise.resolve();
    expect(executeFocusedTableCommand(view,'redo')).toBe(true);
    expect(view.state.doc.toString()).toBe(changed);
    await Promise.resolve();
    const menu=parent.querySelector<HTMLSelectElement>('select[aria-label="Table actions"]')!;
    menu.focus();expect(tableWidgetOwnsFocus(view)).toBe(true);
    menu.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,bubbles:true,cancelable:true}));
    expect(view.state.doc.toString()).toBe(document);
    await Promise.resolve();
    expect(executeFocusedTableCommand(view,'redo')).toBe(true);
    expect(view.state.doc.toString()).toBe(changed);
    await Promise.resolve();
    cell(parent,'new').click();
    expect(focusedTableToolbarState(view)?.inlineFormattingEnabled).toBe(true);
    press(focusedTableCell(view)!.dom,'Escape');
    view.focus();expect(tableWidgetOwnsFocus(view)).toBe(false);
  });
  it('keeps compact table actions named and available through the menu',()=>{
    const {view,parent}=mount();
    const toolbar=parent.querySelector<HTMLElement>('.md-table-toolbar')!;
    expect([...toolbar.querySelectorAll('button')].map(button=>button.textContent)).toEqual(['Add Row','Add Column']);
    const menu=toolbar.querySelector<HTMLSelectElement>('select[aria-label="Table actions"]')!;
    expect([...menu.options].map(option=>option.textContent)).toContain('Edit Source');
    tableAction(parent,'select-range');
    expect(parent.querySelector('.md-table-status')?.textContent).toContain('Select the opposite corner');
    tableAction(parent,'edit-source');
    expect(view.state.selection.main.head).toBe(source.indexOf('| A |'));
  });
  it('does not undo a focused table preview after the parent becomes read-only',()=>{
    const {view,parent}=mount();cell(parent,'old').click();const editor=focusedTableCell(view)!;
    editor.dispatch({changes:{from:0,to:3,insert:'new'}});
    press(editor.dom,'Escape');
    view.dispatch({effects:StateEffect.appendConfig.of(EditorState.readOnly.of(true))});
    const changed=view.state.doc.toString();
    expect(executeFocusedTableCommand(view,'undo')).toBe(true);
    const menu=parent.querySelector<HTMLSelectElement>('select[aria-label="Table actions"]')!;
    menu.focus();menu.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,bubbles:true,cancelable:true}));
    expect(view.state.doc.toString()).toBe(changed);
  });
  it('consumes cell formatting without writing during IME composition or read-only mode',()=>{
    const {view,parent}=mount();cell(parent,'old').click();const editor=focusedTableCell(view)!;
    editor.dispatch({selection:{anchor:0,head:3}});
    editor.dom.dispatchEvent(new Event('compositionstart',{bubbles:true}));
    expect(tableWidgetIsComposing(view)).toBe(true);
    expect(executeFocusedTableCommand(view,'bold')).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    editor.dom.dispatchEvent(new Event('compositionend',{bubbles:true}));
    view.dispatch({effects:StateEffect.appendConfig.of(EditorState.readOnly.of(true))});
    expect(executeFocusedTableCommand(view,'bold')).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });
  it('routes rendered links through the shared document navigation without entering edit mode',()=>{
    const document='| [site](https://example.com) | B |\n| --- | --- |\n| old | 2 |';
    const {view,parent}=mount(document);const links:string[]=[];
    view.dom.addEventListener('tegg-open-link',event=>{links.push((event as CustomEvent<string>).detail);event.preventDefault();});
    const link=parent.querySelector<HTMLAnchorElement>('.cm-live-table-preview a')!;expect(link).not.toBeNull();link.click();
    expect(links).toEqual(['https://example.com']);expect(focusedTableCell(view)).toBeNull();
  });
});
