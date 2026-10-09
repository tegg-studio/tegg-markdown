// @vitest-environment jsdom
import {beforeAll,afterEach,describe,it,expect,vi} from 'vitest';
import {EditorState,StateEffect,Transaction} from '@codemirror/state';
import {EditorView,runScopeHandlers} from '@codemirror/view';
import {history,undo,undoDepth} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {ensureSyntaxTree} from '@codemirror/language';
import {GFM} from '@lezer/markdown';
import {livePreview} from './livePreview';
import {resourceContext} from './editorHost';
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
    const {view,parent}=mount();cell(parent,'old').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));active(parent).value='cat';press(active(parent),'Tab');await Promise.resolve();
    expect(view.state.doc.toString()).toBe(source.replace('old','cat'));expect(active(parent)).toBeNull();expect(document.activeElement).toBe(cell(parent,'2'));
    press(cell(parent,'2'),'Escape');expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(source);
  });
  it('appends the final row with its edited cell in one transaction',async()=>{
    const {view,parent}=mount();cell(parent,'2').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));active(parent).value='3';press(active(parent),'Tab');await Promise.resolve();
    expect(view.state.doc.toString()).toContain('| old | 3 |\n|  |  |');expect(active(parent)).toBeNull();expect(document.activeElement?.getAttribute('aria-label')).toBe('Edit table cell: ');undo(view);expect(view.state.doc.toString()).toBe(source);
  });
  it('combines a pending cell value and a column operation without using a stale range',()=>{
    const {view,parent}=mount();cell(parent,'old').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));active(parent).value='cat';clickText(parent,'Add Column');expect(view.state.doc.toString()).toContain('| cat | 2 |  |');undo(view);expect(view.state.doc.toString()).toBe(source);
  });
  it('retains editing when text before the table moves its offsets',()=>{
    const {view,parent}=mount();cell(parent,'old').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));active(parent).value='cat';view.dispatch({changes:{from:0,insert:'prefix\n'}});press(active(parent),'Enter');expect(view.state.doc.toString()).toBe('prefix\n'+source.replace('old','cat'));
  });
  it('rejects a changed target while preserving the cell draft until cancel',()=>{
    const {view,parent}=mount();cell(parent,'old').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const input=active(parent);input.value='my draft';const at=source.indexOf('old');view.dispatch({changes:{from:at,to:at+3,insert:'external'}});
    press(input,'Enter');expect(view.state.doc.toString()).toContain('external');expect(view.state.doc.toString()).not.toContain('my draft');expect(input.value).toBe('my draft');expect(parent.querySelector('[role="alert"]')?.textContent).toContain('draft is retained');press(input,'Escape');expect(cell(parent,'external')).not.toBeNull();
  });
  it('reviews an expanding rectangle before one atomic paste',()=>{
    const {view,parent}=mount();cell(parent,'2').click();const event=paste(cell(parent,'2'),'x\ty\nz\tw');expect(event.defaultPrevented).toBe(true);expect(view.state.doc.toString()).toBe(source);
    expect(parent.querySelector<HTMLElement>('.md-table-paste-review')!.hidden).toBe(false);clickText(parent,'Apply simplified paste');expect(view.state.doc.toString()).toContain('| old | x | y |\n|  | z | w |');undo(view);expect(view.state.doc.toString()).toBe(source);
  });
  it('copies a shift-selected rectangle through the Host clipboard event',()=>{
    const {parent}=mount();let copied='';parent.addEventListener('tegg-copy-table',event=>{const data=(event as CustomEvent).detail;copied=data.text;expect(data.html).toContain('<table>');expect(JSON.parse(data.structured).cells).toHaveLength(4);event.preventDefault();data.complete(true);});
    cell(parent,'A').dispatchEvent(new MouseEvent('click',{shiftKey:true,bubbles:true}));cell(parent,'2').dispatchEvent(new MouseEvent('click',{shiftKey:true,bubbles:true}));tableAction(parent,'copy-cells');expect(copied).toBe('A\tB\nold\t2');
  });
  it('uses the same inline draft and cancellation on narrow screens',()=>{
    Object.defineProperty(window,'innerWidth',{value:375,configurable:true});const {view,parent}=mount();cell(parent,'old').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    const editor=focusedTableCell(view)!;expect(editor).not.toBeNull();expect(parent.querySelector<HTMLElement>('.md-table-cell-panel')!.hidden).toBe(true);
    editor.dispatch({changes:{from:0,to:3,insert:'mobile'}});expect(view.state.doc.toString()).toBe(source);press(editor.dom,'Escape');expect(view.state.doc.toString()).toBe(source);
    cell(parent,'old').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));focusedTableCell(view)!.dispatch({changes:{from:0,to:3,insert:'mobile'}});press(focusedTableCell(view)!.dom,'Enter');expect(view.state.doc.toString()).toBe(source.replace('old','mobile'));
  });
  it('delegates resource cells atomically and never writes temporary tokens without a Host',()=>{
    const {view,parent}=mount();cell(parent,'A').click();let detail:any;
    parent.addEventListener('tegg-table-resource-paste',event=>{detail=(event as CustomEvent).detail;event.preventDefault();});
    const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:(type:string)=>type==='text/html'?'<table><tr><th>Image</th></tr><tr><td><img src="a.png" alt="cat"></td></tr></table>':'',types:['text/html'],files:[new File([new Uint8Array([1])],'a.png',{type:'image/png'})]}});cell(parent,'A').dispatchEvent(event);
    expect(view.state.doc.toString()).toBe(source);expect(detail.expected).toContain('| old | 2 |');expect(detail.prepared.resources).toHaveLength(1);expect(detail.prepared.markdown).toContain('tegg-paste-resource-');expect(detail.prepared.cells).toBeUndefined();
  });
  it('changes delimiter alignment through the public table actions control',()=>{
    const {view,parent}=mount();cell(parent,'2').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));press(active(parent),'Escape');const menu=parent.querySelector<HTMLSelectElement>('select[aria-label="Table actions"]')!;menu.value='align-center';menu.dispatchEvent(new Event('change',{bubbles:true}));expect(view.state.doc.toString()).toContain('| --- | :---: |');
  });
});

describe('natural table-cell editing and focus routing',()=>{
  it('keeps table ownership on its actual parent view when a nested source editor has focus',()=>{
    const {view,parent}=mount();cell(parent,'old').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    const child=focusedTableCell(view)!;expect(child).not.toBeNull();expect(tableWidgetOwnsFocus(view)).toBe(true);expect(tableWidgetOwnsFocus(child)).toBe(false);
    child.dispatch({selection:{anchor:0,head:3}});expect(executeFocusedTableCommand(view,'bold')).toBe(true);expect(child.state.doc.toString()).toBe('**old**');expect(view.state.doc.toString()).toBe(source);
    press(child.dom,'Enter');expect(view.state.doc.toString()).toBe(source.replace('old','**old**'));cell(parent,'**old**').focus();expect(tableWidgetOwnsFocus(view)).toBe(true);expect(executeFocusedTableCommand(view,'undo')).toBe(true);expect(view.state.doc.toString()).toBe(source);
  });
  it('keeps formatted text projected while editing and applies toolbar formatting through the shared document',()=>{
    const document='| A | B |\n| --- | --- |\n| **重要** | plain |';
    const {view,parent}=mount(document);cell(parent,'**重要**').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    const editor=focusedTableCell(view)!;expect(editor).not.toBeNull();
    expect(editor.dom.isConnected).toBe(true);expect(editor.contentDOM.textContent).toBe('重要');
    expect(focusedTableToolbarState(view)?.bold).toBe(false);
    editor.dispatch({selection:{anchor:2,head:4}});
    expect(executeFocusedTableCommand(view,'italic')).toBe(true);
    expect(view.state.doc.toString()).toContain('**');
    expect(view.state.doc.toString()).toContain('*重要*');
    expect(editor.dom.isConnected).toBe(true);expect(editor.contentDOM.textContent).toBe('重要');
  });
  it('commits before Tab and selects the next cell, with parent Undo and Redo',async()=>{
    const {view,parent}=mount();cell(parent,'old').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const editor=focusedTableCell(view)!;
    editor.dispatch({changes:{from:0,to:3,insert:'cat'}});expect(view.state.doc.toString()).toBe(source);press(editor.dom,'Tab');await Promise.resolve();expect(focusedTableCell(view)).toBeNull();expect(document.activeElement).toBe(cell(parent,'2'));
    press(cell(parent,'2'),'Tab',true);expect(document.activeElement).toBe(cell(parent,'cat'));
    expect(executeFocusedTableCommand(view,'undo')).toBe(true);expect(view.state.doc.toString()).toBe(source);await Promise.resolve();expect(executeFocusedTableCommand(view,'redo')).toBe(true);expect(view.state.doc.toString()).toBe(source.replace('old','cat'));
  });
  it('joins a committed cell into one outer undo event and separates the next committed cell',async()=>{
    const {view,parent}=mount();cell(parent,'old').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const editor=focusedTableCell(view)!;
    editor.dispatch({changes:{from:0,to:3,insert:'c'},annotations:Transaction.userEvent.of('input.type')});editor.dispatch({changes:{from:1,insert:'a'},annotations:Transaction.userEvent.of('input.type')});editor.dispatch({changes:{from:2,insert:'t'},annotations:Transaction.userEvent.of('input.type')});
    expect(view.state.doc.toString()).toBe(source);press(editor.dom,'Tab');await Promise.resolve();cell(parent,'2').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const next=focusedTableCell(view)!;next.dispatch({changes:{from:0,to:1,insert:'3'}});press(next.dom,'Enter');
    expect(view.state.doc.toString()).toContain('| cat | 3 |');undo(view);expect(view.state.doc.toString()).toContain('| cat | 2 |');undo(view);expect(view.state.doc.toString()).toBe(source);
  });
  it('routes Undo and Redo inside the draft without altering the parent document',()=>{
    const {view,parent}=mount();cell(parent,'old').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const editor=focusedTableCell(view)!;editor.dispatch({changes:{from:0,to:3,insert:'new'}});
    expect(view.state.doc.toString()).toBe(source);expect(executeFocusedTableCommand(view,'undo')).toBe(true);expect(editor.state.doc.toString()).toBe('old');expect(executeFocusedTableCommand(view,'redo')).toBe(true);expect(editor.state.doc.toString()).toBe('new');expect(view.state.doc.toString()).toBe(source);
  });
  it('preserves inline-code literals and semantic highlight and HTML when a cell gains focus',()=>{
    const document='| A |\n| --- |\n| `==literal==` <u>yes</u> ==highlight== |';
    const {view,parent}=mount(document);cell(parent,'`==literal==` <u>yes</u> ==highlight==').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
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
    [...parent.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.getAttribute('aria-label')==='Edit table cell: [a \\] b](next.md)')!.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    const editor=focusedTableCell(view)!;
    expect(editor.contentDOM.textContent).toBe('a ] b');
    expect(view.state.doc.toString()).toBe(document);
  });
  it('Backspace at hidden-marker boundaries edits visible content or removes the complete format',()=>{
    const document='| A |\n| --- |\n| **ab** |';
    const {view,parent}=mount(document);cell(parent,'**ab**').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    const editor=focusedTableCell(view)!;
    editor.dispatch({selection:{anchor:6}});
    expect(runScopeHandlers(editor,new KeyboardEvent('keydown',{key:'Backspace'}),'editor')).toBe(true);
    expect(editor.state.doc.toString()).toBe('**a**');
    expect(runScopeHandlers(editor,new KeyboardEvent('keydown',{key:'Home'}),'editor')).toBe(true);
    expect(editor.state.selection.main.head).toBe(2);
    expect(runScopeHandlers(editor,new KeyboardEvent('keydown',{key:'Backspace'}),'editor')).toBe(true);
    expect(editor.state.doc.toString()).toBe('a');expect(view.state.doc.toString()).toBe(document);
  });
  it('keeps format unwrapping as a separate undo event after typing',()=>{
    const document='| A |\n| --- |\n| **a** |';
    const {view,parent}=mount(document);cell(parent,'**a**').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const editor=focusedTableCell(view)!;
    editor.dispatch({changes:{from:3,insert:'b'},annotations:Transaction.userEvent.of('input.type')});
    expect(editor.state.doc.toString()).toBe('**ab**');
    expect(runScopeHandlers(editor,new KeyboardEvent('keydown',{key:'Home'}),'editor')).toBe(true);
    expect(runScopeHandlers(editor,new KeyboardEvent('keydown',{key:'Backspace'}),'editor')).toBe(true);
    expect(editor.state.doc.toString()).toBe('ab');
    expect(executeFocusedTableCommand(view,'undo')).toBe(true);
    expect(editor.state.doc.toString()).toBe('**ab**');
    expect(executeFocusedTableCommand(view,'undo')).toBe(true);
    expect(view.state.doc.toString()).toBe(document);
  });
  it('selects only the child cell when Mod-A is pressed inside the nested editor',()=>{
    const {view,parent}=mount();cell(parent,'old').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const editor=focusedTableCell(view)!;
    expect(runScopeHandlers(editor,new KeyboardEvent('keydown',{key:'a',ctrlKey:true}),'editor')).toBe(true);
    expect(editor.state.selection.main.from).toBe(0);
    expect(editor.state.selection.main.to).toBe(3);
    expect(view.state.selection.main.empty).toBe(true);
  });
  it('opens the shared link destination editor for a new cell link',()=>{
    const {view,parent}=mount();cell(parent,'old').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const editor=focusedTableCell(view)!;
    editor.dispatch({selection:{anchor:0,head:3}});
    expect(executeFocusedTableCommand(view,'link')).toBe(true);
    expect(editor.state.doc.toString()).toContain('[old](https://)');
    const dialog=document.querySelector<HTMLElement>('[role="dialog"][aria-label="Edit link"]')!;
    expect(dialog).not.toBeNull();
    const destination=dialog.querySelector<HTMLInputElement>('input[aria-label="Link destination"]')!;
    destination.value='next.md';destination.dispatchEvent(new Event('input',{bubbles:true}));
    dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    expect(editor.state.doc.toString()).toContain('[old](<next.md>)');
    expect(focusedTableCell(view)).toBe(editor);
    expect(editor.hasFocus).toBe(true);
    expect(executeFocusedTableCommand(view,'undo')).toBe(true);
    expect(editor.state.doc.toString()).toContain('[old](https://)');
    expect(executeFocusedTableCommand(view,'redo')).toBe(true);
    expect(editor.state.doc.toString()).toContain('[old](<next.md>)');
  });
  it('does not retain a cell command target when focus moves into another input',()=>{
    const {view,parent}=mount();cell(parent,'old').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const cellEditor=focusedTableCell(view)!;
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
    cell(parent,'old').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const editor=focusedTableCell(view)!;
    editor.dispatch({changes:{from:0,to:3,insert:'new'}});
    press(editor.dom,'Enter');
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
    cell(parent,'new').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
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
    const {view,parent}=mount();cell(parent,'old').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const editor=focusedTableCell(view)!;
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
    const {view,parent}=mount();cell(parent,'old').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const editor=focusedTableCell(view)!;
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
  it('selects a preview link cell without Reader navigation, Source edits, history or main-caret movement',()=>{
    const document=source.replace('old','[**site**](https://example.com)');
    const {view,parent}=mount(document),links:string[]=[],before=view.state.doc,selection=view.state.selection,history=undoDepth(view.state);
    view.dom.addEventListener('tegg-open-link',event=>{links.push((event as CustomEvent<string>).detail);event.preventDefault();});
    const link=parent.querySelector<HTMLAnchorElement>('.cm-live-table-preview a')!,preview=link.closest('button')!;
    expect(link.textContent).toBe('site');
    for(const modifier of [{},{metaKey:true},{ctrlKey:true}]){
      const event=new MouseEvent('click',{bubbles:true,cancelable:true,...modifier});link.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);expect(link.closest('td')?.dataset.cellState).toBe('selected');
      expect(globalThis.document.activeElement).toBe(preview);expect(links).toEqual([]);expect(focusedTableCell(view)).toBeNull();
      expect(view.state.doc).toBe(before);expect(view.state.selection.eq(selection)).toBe(true);expect(undoDepth(view.state)).toBe(history);
    }
  });
});

it('retains a GFM range after copy ACK when document context changes with identical Text',async()=>{
 const {view,parent}=mount();const td=parent.querySelector<HTMLTableCellElement>('td[data-table-row="1"][data-table-column="0"]')!;td.click();let complete!:(success:boolean)=>void;parent.addEventListener('tegg-copy-table',event=>{event.preventDefault();complete=(event as CustomEvent).detail.complete;});
 const menu=parent.querySelector<HTMLSelectElement>('select[aria-label="Table actions"]')!;menu.value='cut-cells';menu.dispatchEvent(new Event('change',{bubbles:true}));expect(complete).toBeTypeOf('function');const text=view.state.doc;
 view.dispatch({effects:StateEffect.appendConfig.of(resourceContext.of({documentPath:'/other/document.md',profile:'tegg'}))});expect(view.state.doc).toBe(text);complete(true);await Promise.resolve();await Promise.resolve();expect(view.state.doc.toString()).toBe(source);expect(undo(view)).toBe(false);
});


describe('GFM preview link cell entry follows the selected-cell contract',()=>{
 const label='[**site**](https://example.com)',linkedSource=source.replace('old',label);
 function pointerLink(node:Element,type:string,x=30,y=40){const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y});Object.defineProperties(event,{pointerType:{value:'touch'},pointerId:{value:7}});node.dispatchEvent(event);return event;}
 function touchLink(node:Element){pointerLink(node,'pointerdown');pointerLink(node,'pointerup');}
 function liveFixture(){const {view,parent}=mount(linkedSource);const link=cell(parent,label).querySelector<HTMLAnchorElement>('a')!,links:string[]=[];view.dom.addEventListener('tegg-open-link',event=>{links.push((event as CustomEvent<string>).detail);event.preventDefault();});return {view,parent,link,links,before:view.state.doc,selection:view.state.selection};}
 function unchanged(value:ReturnType<typeof liveFixture>){expect(value.view.state.doc).toBe(value.before);expect(value.view.state.doc.toString()).toBe(linkedSource);expect(value.view.state.selection.eq(value.selection)).toBe(true);expect(undoDepth(value.view.state)).toBe(0);expect(value.links).toEqual([]);}
 it.each(['dblclick','F2'])('opens the actual rich child through %s on a preview link and cancels locally',entry=>{
   const f=liveFixture();f.link.focus();
   if(entry==='dblclick')f.link.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));else press(f.link,'F2');
   const child=focusedTableCell(f.view)!;expect(child).not.toBeNull();expect(child.dom.isConnected).toBe(true);expect(child.state.doc.toString()).toBe(label);expect(child.contentDOM.textContent).toBe('site');
   if(entry==='F2')expect(child.state.selection.main.head).toBe(label.length);
   unchanged(f);press(child.dom,'Escape');expect(focusedTableCell(f.view)).toBeNull();unchanged(f);
 });
 it('uses real anchor pointer events for first selection and second-tap child entry without navigation',()=>{
   const f=liveFixture();touchLink(f.link);f.link.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:30,clientY:40,detail:1}));
   expect(f.link.closest('td')?.dataset.cellState).toBe('selected');expect(focusedTableCell(f.view)).toBeNull();unchanged(f);
   touchLink(f.link);const child=focusedTableCell(f.view)!;expect(child).not.toBeNull();expect(child.state.doc.toString()).toBe(label);expect(child.contentDOM.textContent).toBe('site');unchanged(f);
   press(child.dom,'Escape');expect(focusedTableCell(f.view)).toBeNull();unchanged(f);
 });
 it('does not treat a scrolled or cancelled preview-link gesture as its second editing tap',()=>{
   const f=liveFixture();touchLink(f.link);f.link.click();pointerLink(f.link,'pointerdown');pointerLink(f.link,'pointermove',50,70);pointerLink(f.link,'pointerup',50,70);touchLink(f.link);f.link.click();
   expect(focusedTableCell(f.view)).toBeNull();unchanged(f);
   pointerLink(f.link,'pointerdown');pointerLink(f.link,'pointercancel');touchLink(f.link);f.link.click();expect(focusedTableCell(f.view)).toBeNull();unchanged(f);
 });
 it('selects a read-only link cell while refusing double-tap, double-click and F2 draft entry',()=>{
   const f=liveFixture();f.view.dispatch({effects:StateEffect.appendConfig.of(EditorState.readOnly.of(true))});expect(f.view.state.readOnly).toBe(true);
   const link=cell(f.parent,label).querySelector<HTMLAnchorElement>('a')!;
   touchLink(link);link.click();expect(link.closest('td')?.dataset.cellState).toBe('selected');touchLink(link);link.click();
   link.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));press(link,'F2');
   expect(focusedTableCell(f.view)).toBeNull();unchanged(f);
 });
 it('does not start or replay preview-link entry while the main editor is composing',()=>{
   const f=liveFixture();Object.defineProperty(f.view,'composing',{configurable:true,value:true});
   touchLink(f.link);f.link.click();touchLink(f.link);f.link.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));press(f.link,'F2');
   expect(focusedTableCell(f.view)).toBeNull();unchanged(f);
   Object.defineProperty(f.view,'composing',{configurable:true,value:false});f.view.contentDOM.dispatchEvent(new Event('compositionend',{bubbles:true}));
   expect(focusedTableCell(f.view)).toBeNull();unchanged(f);touchLink(f.link);f.link.click();expect(focusedTableCell(f.view)).toBeNull();unchanged(f);
 });
 it('preserves source bytes and one parent Undo after an explicitly entered link cell is committed',()=>{
   const f=liveFixture();press(f.link,'F2');const child=focusedTableCell(f.view)!;expect(child).not.toBeNull();
   child.dispatch({changes:{from:0,to:child.state.doc.length,insert:'[**changed**](https://example.com)'}});unchanged(f);
   press(child.dom,'Enter');expect(f.view.state.doc.toString()).toBe(linkedSource.replace(label,'[**changed**](https://example.com)'));expect(f.links).toEqual([]);expect(undoDepth(f.view.state)).toBe(1);
   expect(undo(f.view)).toBe(true);expect(f.view.state.doc.toString()).toBe(linkedSource);expect(f.view.state.selection.eq(f.selection)).toBe(true);
 });
});


describe('empty cell padding through real draft commits',()=>{
  it('clears and refills a cell with one parent Undo restoring each exact preceding source',()=>{
    const original='before\n\n| A | B |\n| --- | --- |\n| old | keep |\n\nafter';
    const empty='before\n\n| A | B |\n| --- | --- |\n|  | keep |\n\nafter';
    const filled='before\n\n| A | B |\n| --- | --- |\n| GammaXY | keep |\n\nafter';
    const {view,parent}=mount(original);
    cell(parent,'old').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    const first=focusedTableCell(view)!;
    first.dispatch({changes:{from:0,to:first.state.doc.length,insert:''}});
    expect(view.state.doc.toString()).toBe(original);
    press(first.dom,'Enter');expect(view.state.doc.toString()).toBe(empty);expect(undoDepth(view.state)).toBe(1);
    cell(parent,'').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    const second=focusedTableCell(view)!;
    second.dispatch({changes:{from:0,to:second.state.doc.length,insert:'GammaXY'}});
    expect(view.state.doc.toString()).toBe(empty);
    press(second.dom,'Enter');expect(view.state.doc.toString()).toBe(filled);expect(undoDepth(view.state)).toBe(2);
    expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(empty);
    expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(original);
  });
});
