// @vitest-environment jsdom
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {Compartment,EditorState,StateEffect} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history,undo,undoDepth} from '@codemirror/commands';
import {EditableTableWidget,focusedTableCell} from './tableWidget';
import {attachHtmlTableEditing} from './htmlTableWidget';
import {createHtmlPreview} from './renderKit';
import {markdown} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {EditingController} from './editingController';
import {createCommandSurface} from './commandSurface';
import {commandBlockAt} from './commandBlockTarget';
import {resourceContext} from './editorHost';
import {bindUI} from './uiContext';
import {captureTableActions,gfmTableActions,htmlTableActions,registerTableActions,tableActionsAtNode} from './tableActionCatalog';
const stops:Array<()=>void>=[];
beforeAll(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});Range.prototype.getClientRects=()=>({length:0,item:()=>null,[Symbol.iterator]:function*(){}}) as DOMRectList;Range.prototype.getBoundingClientRect=()=>new DOMRect();});
afterEach(()=>{stops.splice(0).reverse().forEach(stop=>stop());document.body.replaceChildren();});
const gfm='| C | D |\n| --- | --- |\n| three | four |';
const html='<table class="keep"><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>';
function fixture(kind:'gfm'|'html',table=kind==='gfm'?gfm:html,prefix='Caret A\n\n',lineBreak='\n'){
  const source=prefix+table+'\n\nAfter',rawSource=source.replaceAll('\n',lineBreak),parent=document.body.appendChild(document.createElement('div'));
  const permissions=new Compartment(),context=new Compartment();
  const view=new EditorView({parent,state:EditorState.create({doc:rawSource,selection:{anchor:2},extensions:[EditorState.lineSeparator.of(lineBreak),history(),markdown({extensions:GFM}),permissions.of(EditorState.readOnly.of(false)),context.of(resourceContext.of({profile:'tegg',documentPath:'original.md'}))]})});
  const from=prefix.length;
  let panel:HTMLElement,dispose:()=>void;
  if(kind==='gfm'){const widget=new EditableTableWidget(table,from,from+table.length);panel=widget.toDOM(view);dispose=()=>widget.destroy(panel);}
  else{panel=createHtmlPreview({kind:'html',source:table,display:'block'});dispose=attachHtmlTableEditing(panel,view,from,table)!;}
  view.dom.append(panel);stops.push(()=>{dispose();view.destroy();});
  return {view,panel,from,table,source,rawSource,prefix,permissions,context,dispose};
}
const tick=async()=>{await Promise.resolve();await Promise.resolve();};
describe('mounted table action targets',()=>{
  it.each(['gfm','html'] as const)('translates mounted %s clipboard/row actions without changing authored source or history',async kind=>{
    const{view,panel,source}=fixture(kind),selection=view.state.selection,depth=undoDepth(view.state);
    const ui=bindUI(view.dom,{locale:'en-US'});stops.push(()=>ui.destroy());
    const expected=kind==='html'?[['Cut cells','剪切单元格'],['Paste','粘贴'],['Insert row below','在下方插入行']]:[['Cut cells','剪切单元格'],['Paste','粘贴']];
    const controls=expected.map(([key,translated])=>{
      const nodes=[...panel.querySelectorAll<HTMLElement>('[data-tegg-ui-text]')].filter(node=>node.dataset.teggUiText===key);
      expect(nodes.length).toBeGreaterThan(0);for(const node of nodes)expect(node.textContent).toBe(key);return {key,translated,nodes};
    });
    ui.update({locale:'zh-CN'});await tick();
    for(const {translated,nodes} of controls)for(const node of nodes){expect(node.isConnected).toBe(true);expect(node.textContent).toBe(translated);}
    expect(view.state.doc.toString()).toBe(source);expect(view.state.selection.eq(selection)).toBe(true);expect(undoDepth(view.state)).toBe(depth);
    ui.update({locale:'en-US'});await tick();
    for(const {key,nodes} of controls)for(const node of nodes)expect(node.textContent).toBe(key);
    expect(view.state.doc.toString()).toBe(source);expect(view.state.selection.eq(selection)).toBe(true);expect(undoDepth(view.state)).toBe(depth);
  });

  it('appends a row on B without using caret A or selected-row-after semantics',()=>{
    const{view,from,source}=fixture('gfm'),selection=view.state.selection,lease=captureTableActions(view,from)!;
    expect(lease.kind).toBe('gfm');expect(lease.execute('add-row')).toBe(true);
    expect(view.state.doc.toString()).toBe(source.replace(gfm,gfm+'\n|  |  |'));
    expect(view.state.selection.eq(selection)).toBe(true);expect(undoDepth(view.state)).toBe(1);
    expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(source);
  });
  it('keeps table A and its logical caret unchanged when an explicitly locked B menu appends',()=>{
    const a='| A | B |\n| --- | --- |\n| one | two |',prefix='Before\n\n'+a+'\n\nBetween\n\n';
    const{view,from,source}=fixture('gfm',gfm,prefix),aFrom='Before\n\n'.length;
    const widgetA=new EditableTableWidget(a,aFrom,aFrom+a.length),panelA=widgetA.toDOM(view);view.dom.append(panelA);stops.push(()=>widgetA.destroy(panelA));
    view.dispatch({selection:{anchor:aFrom+2}});const selection=view.state.selection;
    expect(captureTableActions(view,from)!.execute('add-row')).toBe(true);
    expect(view.state.doc.toString()).toBe(source.replace(gfm,gfm+'\n|  |  |'));expect(view.state.doc.sliceString(aFrom,aFrom+a.length)).toBe(a);
    expect(view.state.selection.eq(selection)).toBe(true);expect(undoDepth(view.state)).toBe(1);expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(source);
  });
  it('appends a column, preserving the original leading header and all body cells',()=>{
    const{view,from,source}=fixture('gfm');expect(captureTableActions(view,from)!.execute('add-column')).toBe(true);
    expect(view.state.doc.toString()).toBe(source.replace(gfm,'| C | D |  |\n| --- | --- | --- |\n| three | four |  |'));
    expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(source);
  });
  it.each([
    ['add-row',gfm+'\n|  |  |'],
    ['add-column','| C | D |  |\n| --- | --- | --- |\n| three | four |  |'],
  ])('keeps %s reachable from the compact existing Table actions select and appends after all original cells',(id,expected)=>{
    const{view,panel,source}=fixture('gfm');
    // Header row/first column are selected: selected-row/column-after would differ.
    const menu=panel.querySelector<HTMLSelectElement>('select[aria-label="Table actions"]')!;
    expect([...menu.options].some(option=>option.value===id)).toBe(true);menu.value=id;menu.dispatchEvent(new Event('change',{bubbles:true}));
    expect(view.state.doc.toString()).toBe(source.replace(gfm,expected));expect(undoDepth(view.state)).toBe(1);expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(source);
  });
  it('uses the real HTML span-aware column-after action and exact parent Undo',()=>{
    const{view,from,source}=fixture('html');const lease=captureTableActions(view,from)!;
    expect(lease.kind).toBe('html');expect(lease.items).toContainEqual({id:'unmerge-cell',label:'Unmerge cell'});
    expect(lease.items.some(item=>item.id==='align-left'||item.id==='add-row')).toBe(false);
    expect(lease.execute('column-after')).toBe(true);
    expect(view.state.doc.toString()).toBe(source.replace('<td>B</td>','<td></td><td>B</td>').replace('<td>C</td>','<td></td><td>C</td>'));
    expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(source);
  });
  it.each(['gfm','html'] as const)('opens the existing %s cell draft without source/history mutation',kind=>{
    const{view,panel,from,source}=fixture(kind),lease=captureTableActions(view,from)!;
    expect(lease.execute('edit-cell')).toBe(true);expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);
    expect(kind==='gfm'?panel.querySelector('.md-table-inline-editor'):panel.querySelector('.md-html-cell-editing')).not.toBeNull();
    expect(lease.current()).toBe(false);expect(lease.execute('add-row')).toBe(false);expect(tableActionsAtNode(view,panel.querySelector(kind==='gfm'?'.md-table-inline-editor':'.md-html-cell-editing')!)).toBeNull();
  });
  it.each(['range','context','readonly','ime','dispose','source'] as const)('revokes the captured range on %s and never replays it',async change=>{
    const{view,panel,from,source,permissions,context,dispose}=fixture('gfm'),lease=captureTableActions(view,from)!;
    if(change==='range')panel.querySelector<HTMLButtonElement>('button[aria-label="Edit table cell: four"]')!.click();
    if(change==='context')view.dispatch({effects:context.reconfigure(resourceContext.of({profile:'tegg',documentPath:'new.md'}))});
    if(change==='readonly')view.dispatch({effects:permissions.reconfigure(EditorState.readOnly.of(true))});
    if(change==='ime')Object.defineProperty(view,'composing',{configurable:true,value:true});
    if(change==='dispose')dispose();
    if(change==='source')view.dispatch({changes:{from:view.state.doc.length,insert:'other'}});
    const before=view.state.doc.toString(),depth=undoDepth(view.state);
    expect(lease.current()).toBe(false);expect(lease.execute('add-column')).toBe(false);expect(view.state.doc.toString()).toBe(before);expect(undoDepth(view.state)).toBe(depth);
    if(change==='ime'){Object.defineProperty(view,'composing',{configurable:true,value:false});await tick();expect(view.state.doc.toString()).toBe(source);}
  });
  it('retains the original asynchronous cut ACK guards after the menu action is accepted',async()=>{
    const{view,panel,from,source}=fixture('gfm');let complete!:(success:boolean)=>void;
    panel.addEventListener('tegg-copy-table',event=>{event.preventDefault();const detail=(event as CustomEvent).detail;expect(detail.text).toBe('C');expect(detail.html).toContain('<table');expect(detail.structured).toBeTruthy();complete=detail.complete;});
    expect(captureTableActions(view,from)!.execute('cut-cells')).toBe(true);expect(view.state.doc.toString()).toBe(source);
    panel.querySelector<HTMLButtonElement>('button[aria-label="Edit table cell: four"]')!.click();complete(true);await tick();
    expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);expect(panel.querySelector('.md-table-error')!.textContent).toContain('not cut');
  });
  it('keeps the original explicit Delete table confirmation before source changes',()=>{
    const{view,panel,from,source}=fixture('html'),lease=captureTableActions(view,from)!;
    expect(lease.execute('delete-table')).toBe(true);expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);
    expect(panel.querySelector<HTMLElement>('.md-html-table-review')!.hidden).toBe(false);expect(lease.current()).toBe(false);
  });
  it.each(['gfm','html'] as const)('restores %s preview focus before a real focused control is hidden, without source/caret/history changes',kind=>{
    const{view,panel,source}=fixture(kind),selection=view.state.selection;
    const container=panel.querySelector<HTMLElement>(kind==='gfm'?'.md-table-toolbar':'.md-html-table-controls')!;
    const button=container.querySelector<HTMLButtonElement>('button')!;button.focus();
    panel.dispatchEvent(new CustomEvent('tegg-table-controls-layout',{detail:{hiddenControls:[container]}}));
    expect(document.activeElement?.closest(kind==='gfm'?'.cm-live-table-cell':'td')).not.toBeNull();
    expect(view.state.selection.eq(selection)).toBe(true);expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);
  });
  it('returns focus to the current real GFM child and preserves its pending text/selection/history',()=>{
    const{view,panel,from,source}=fixture('gfm');expect(captureTableActions(view,from)!.execute('edit-cell')).toBe(true);const child=focusedTableCell(view)!;
    child.dispatch({changes:{from:0,to:child.state.doc.length,insert:'Pending'},selection:{anchor:1,head:4}});const selection=child.state.selection,parentSelection=view.state.selection;
    const toolbar=panel.querySelector<HTMLElement>('.md-table-toolbar')!,focused=toolbar.querySelector<HTMLButtonElement>('button')!;focused.focus();
    expect(panel.dispatchEvent(new CustomEvent('tegg-table-controls-layout',{cancelable:true,detail:{hiddenControls:[focused]}}))).toBe(true);
    expect(document.activeElement).toBe(child.contentDOM);expect(child.state.doc.toString()).toBe('Pending');expect(child.state.selection.eq(selection)).toBe(true);expect(view.state.selection.eq(parentSelection)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);
  });
  it('returns focus to the current real HTML draft and exact saved caret without committing pending text',()=>{
    const{view,panel,from,source}=fixture('html');expect(captureTableActions(view,from)!.execute('edit-cell')).toBe(true);const cell=panel.querySelector<HTMLTableCellElement>('.md-html-cell-editing')!,text=cell.firstChild!;
    text.textContent='Pending';cell.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));const range=document.createRange();range.setStart(text,2);range.collapse(true);document.getSelection()!.removeAllRanges();document.getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));
    const controls=panel.querySelector<HTMLElement>('.md-html-table-controls')!,focused=controls.querySelector<HTMLButtonElement>('button')!;focused.focus();
    expect(panel.dispatchEvent(new CustomEvent('tegg-table-controls-layout',{cancelable:true,detail:{hiddenControls:[focused]}}))).toBe(true);
    expect(document.activeElement).toBe(cell);expect(document.getSelection()!.anchorNode).toBe(text);expect(document.getSelection()!.anchorOffset).toBe(2);expect(cell.textContent).toBe('Pending');expect(cell.contentEditable).toBe('true');
    expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);
  });
  it('refuses a layout hide during actual HTML composing input without moving focus/caret or replaying after compositionend',()=>{
    const{view,panel,from,source}=fixture('html');expect(captureTableActions(view,from)!.execute('edit-cell')).toBe(true);
    const cell=panel.querySelector<HTMLTableCellElement>('.md-html-cell-editing')!,text=cell.firstChild!;
    const range=document.createRange();range.setStart(text,1);range.collapse(true);document.getSelection()!.removeAllRanges();document.getSelection()!.addRange(range);
    cell.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
    const controls=panel.querySelector<HTMLElement>('.md-html-table-controls')!,focused=controls.querySelector<HTMLButtonElement>('button')!;focused.focus();
    const actualCaret=document.getSelection()!,beforeNode=actualCaret.anchorNode,beforeOffset=actualCaret.anchorOffset;
    const event=new CustomEvent('tegg-table-controls-layout',{cancelable:true,detail:{hiddenControls:[controls]}});
    expect(panel.dispatchEvent(event)).toBe(false);expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focused);expect(cell.contentEditable).toBe('true');expect(document.getSelection()!.anchorNode).toBe(beforeNode);expect(document.getSelection()!.anchorOffset).toBe(beforeOffset);
    expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);
    cell.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));expect(view.state.doc.toString()).toBe(source);expect(document.activeElement).toBe(focused);
  });
  it('refuses a layout hide while the real GFM child editor is composing, without committing or replaying',()=>{
    const{view,panel,from,source}=fixture('gfm');expect(captureTableActions(view,from)!.execute('edit-cell')).toBe(true);
    const child=panel.querySelector<HTMLElement>('.md-table-inline-editor')!,toolbar=panel.querySelector<HTMLElement>('.md-table-toolbar')!,focused=toolbar.querySelector<HTMLButtonElement>('button')!;
    child.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));focused.focus();
    const event=new CustomEvent('tegg-table-controls-layout',{cancelable:true,detail:{hiddenControls:[focused]}});expect(panel.dispatchEvent(event)).toBe(false);expect(document.activeElement).toBe(focused);
    expect(child.isConnected).toBe(true);expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);
    child.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));expect(child.isConnected).toBe(true);expect(view.state.doc.toString()).toBe(source);expect(document.activeElement).toBe(focused);
  });
  it.each(['gfm','html'] as const)('preserves only the original %s readonly Copy cells capability and all representations',async kind=>{
    const{view,panel,from,source,permissions}=fixture(kind);view.dispatch({effects:permissions.reconfigure(EditorState.readOnly.of(true))});
    let copied=false;panel.addEventListener('tegg-copy-table',event=>{event.preventDefault();const data=(event as CustomEvent).detail;expect(data.text).toBe(kind==='gfm'?'C':'A\n');expect(data.html).toContain('<table');expect(data.structured).toBeTruthy();copied=true;data.complete(true);});
    const lease=captureTableActions(view,from)!;expect(lease.readOnly).toBe(true);expect(lease.items.map(item=>item.id)).toEqual(['copy-cells']);
    for(const id of ['edit-cell','add-row','delete-table','cut-cells','paste-cells','edit-source'])expect(lease.execute(id)).toBe(false);
    expect(lease.execute('copy-cells')).toBe(true);await tick();expect(copied).toBe(true);expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);
  });
  it('does not let repeated old disposal revoke a new actual table registration',()=>{
    const{view,panel,from,source,dispose}=fixture('gfm');dispose();
    // Dispose the original fixture owner first, then register two successive real owners.
    const first=new EditableTableWidget(gfm,from,from+gfm.length),firstPanel=first.toDOM(view);view.dom.append(firstPanel);first.destroy(firstPanel);firstPanel.remove();
    const second=new EditableTableWidget(gfm,from,from+gfm.length),secondPanel=second.toDOM(view);view.dom.append(secondPanel);stops.push(()=>second.destroy(secondPanel));
    first.destroy(firstPanel);const lease=captureTableActions(view,from)!;expect(lease.current()).toBe(true);expect(lease.execute('add-row')).toBe(true);expect(view.state.doc.toString()).toBe(source.replace(gfm,gfm+'\n|  |  |'));
  });
  it('makes registry cleanup itself idempotent across old/new owner sets',()=>{
    const{view,panel,from,dispose}=fixture('gfm');dispose();let ran=0;
    const entry={panel,kind:'gfm' as const,from:()=>from,containsPreview:(node:Node)=>panel.contains(node),capture:()=>({readOnly:false,current:()=>true,execute:()=>{ran++;return true;}})};
    const oldStop=registerTableActions(view,entry);oldStop();const newStop=registerTableActions(view,entry);stops.push(newStop);oldStop();
    const lease=captureTableActions(view,from)!;expect(lease.current()).toBe(true);expect(lease.execute('add-row')).toBe(true);expect(ran).toBe(1);
  });
  it.each(['gfm','html'] as const)('opens only Copy cells in the existing readonly %s object menu',async kind=>{
    const{view,panel,from,source,permissions}=fixture(kind);view.dispatch({effects:permissions.reconfigure(EditorState.readOnly.of(true)),selection:{anchor:from+1}});
    const controller=new EditingController(view,{identity:()=>({documentId:'same-document',generation:'same-generation',mode:'live',readOnly:true,profile:'tegg'})});stops.push(()=>controller.destroy());
    expect(commandBlockAt(view.state,from+1,'tegg')?.from).toBe(from);
    view.dispatch({effects:StateEffect.appendConfig.of(createCommandSurface(controller))});view.focus();
    view.dom.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyB',key:'B',altKey:true,shiftKey:true,bubbles:true,cancelable:true}));
    const more=view.dom.querySelector<HTMLButtonElement>('.tegg-command-more')!;expect(more.hidden).toBe(false);expect(view.dom.querySelector<HTMLButtonElement>('.tegg-command-plus')!.hidden).toBe(true);more.click();
    const options=[...view.dom.querySelectorAll<HTMLButtonElement>('.tegg-command-option')];expect(options.map(option=>option.querySelector('.tegg-command-option-label')!.textContent)).toEqual(['Copy cells']);
    let copied=false;panel.addEventListener('tegg-copy-table',event=>{event.preventDefault();copied=true;(event as CustomEvent).detail.complete(true);});options[0].click();await tick();
    expect(copied).toBe(true);expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);
  });
  it('closes a previously writable object action when readonly arrives without mutating source',()=>{
    const{view,from,source,permissions}=fixture('gfm');view.dispatch({selection:{anchor:from+1}});
    const controller=new EditingController(view,{identity:()=>({documentId:'same-document',generation:'same-generation',mode:'live',profile:'tegg'})});stops.push(()=>controller.destroy());
    view.dispatch({effects:StateEffect.appendConfig.of(createCommandSurface(controller))});view.focus();view.dom.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyB',key:'B',altKey:true,shiftKey:true,bubbles:true,cancelable:true}));view.dom.querySelector<HTMLButtonElement>('.tegg-command-more')!.click();
    const append=[...view.dom.querySelectorAll<HTMLButtonElement>('.tegg-command-option')].find(option=>option.querySelector('.tegg-command-option-label')!.textContent==='Add Row')!;expect(append).toBeDefined();
    view.dispatch({effects:permissions.reconfigure(EditorState.readOnly.of(true))});append.click();expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);
  });
  it.each([['gfm',false],['gfm',true],['html',false],['html',true]] as const)('locks actual touched table B while caret stays in A (%s readonly=%s)',async(kind,readonly)=>{
    const a=kind==='gfm'?'| A |\n| --- |\n| one |':'<table><tr><td>Original A</td></tr></table>',prefix=a+'\n\nBetween\n\n';
    const{view,panel,from,source,permissions}=fixture(kind,kind==='gfm'?gfm:html,prefix);
    let aPanel:HTMLElement;if(kind==='gfm'){const widget=new EditableTableWidget(a,0,a.length);aPanel=widget.toDOM(view);stops.push(()=>widget.destroy(aPanel));}else{aPanel=createHtmlPreview({kind:'html',source:a,display:'block'});stops.push(attachHtmlTableEditing(aPanel,view,0,a)!);}view.dom.append(aPanel);
    view.dispatch({effects:permissions.reconfigure(EditorState.readOnly.of(readonly)),selection:{anchor:2}});const originalSelection=view.state.selection;
    const controller=new EditingController(view,{identity:()=>({documentId:'same-document',generation:'same-generation',mode:'live',readOnly:readonly,profile:'tegg'})});stops.push(()=>controller.destroy());view.dispatch({effects:StateEffect.appendConfig.of(createCommandSurface(controller))});
    const preview=kind==='gfm'?panel.querySelector<HTMLButtonElement>('button[aria-label="Edit table cell: four"]')!:panel.querySelectorAll<HTMLTableCellElement>('td')[1];
    for(const type of ['pointerdown','pointerup']){const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperties(event,{pointerType:{value:'touch'},pointerId:{value:1},clientX:{value:10},clientY:{value:10}});preview.dispatchEvent(event);}preview.click();
    expect(view.state.selection.eq(originalSelection)).toBe(true);expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);expect(panel.querySelector('.md-table-inline-editor,.md-html-cell-editing')).toBeNull();
    const more=view.dom.querySelector<HTMLButtonElement>('.tegg-command-more')!;expect(more.hidden).toBe(false);expect(more.dataset.blockFrom).toBe(String(from));more.click();
    const labels=()=>[...view.dom.querySelectorAll('.tegg-command-option-label')].map(node=>node.textContent);
    if(readonly)expect(labels()).toEqual(['Copy cells']);else expect(labels()).toContain(kind==='gfm'?'Add Row':'Insert column after');
    view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(view.state.selection.eq(originalSelection)).toBe(true);expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);
    more.click();let copied=false;panel.addEventListener('tegg-copy-table',event=>{event.preventDefault();copied=true;(event as CustomEvent).detail.complete(true);});
    const chosen=[...view.dom.querySelectorAll<HTMLButtonElement>('.tegg-command-option')].find(option=>option.querySelector('.tegg-command-option-label')!.textContent===(readonly?'Copy cells':kind==='gfm'?'Add Row':'Insert column after'))!;chosen.click();await tick();
    expect(view.state.doc.sliceString(0,a.length)).toBe(a);expect(view.state.selection.eq(originalSelection)).toBe(true);
    if(readonly){expect(copied).toBe(true);expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);}else{expect(view.state.doc.toString()).not.toBe(source);expect(undoDepth(view.state)).toBe(1);expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(source);}
  });
  it('refuses touch ownership when multiple real owners share the same source range',()=>{
    const{view,panel,from,source}=fixture('gfm'),second=new EditableTableWidget(gfm,from,from+gfm.length),secondPanel=second.toDOM(view);view.dom.append(secondPanel);stops.push(()=>second.destroy(secondPanel));
    expect(tableActionsAtNode(view,panel.querySelector('.cm-live-table-preview')!)).toBeNull();expect(captureTableActions(view,from)).toBeNull();expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);
  });
  it('does not turn author data/class attributes into a mounted action capability',()=>{
    const{view,from}=fixture('gfm');const fake=document.createElement('section');fake.className='cm-live-table';fake.dataset.teggTableFrom=String(from+1);view.dom.append(fake);
    expect(captureTableActions(view,from+1)).toBeNull();expect(tableActionsAtNode(view,fake)).toBeNull();expect(captureTableActions(view,from)!.execute('made-up-action')).toBe(false);
    expect(gfmTableActions.map(item=>item.id)).not.toEqual(htmlTableActions.map(item=>item.id));
  });
  it('copies readonly GFM with actual CRLF lineSeparator while source/caret/history and raw bytes stay exact',async()=>{
    const{view,panel,from,source,rawSource,permissions}=fixture('gfm',gfm,'Caret A\n\n','\r\n');
    view.dispatch({effects:permissions.reconfigure([EditorState.readOnly.of(true),EditorView.editable.of(false)])});
    const selection=view.state.selection;
    expect(view.state.lineBreak).toBe('\r\n');expect(view.state.sliceDoc(from,from+gfm.length)).not.toBe(gfm);expect(view.state.doc.sliceString(from,from+gfm.length)).toBe(gfm);
    let copied=false;panel.addEventListener('tegg-copy-table',event=>{event.preventDefault();const data=(event as CustomEvent).detail;expect(data.text).toBe('C');expect(data.html).toContain('<th>C</th>');expect(JSON.parse(data.structured).cells[0].html).toBe('C');copied=true;data.complete(true);});
    const lease=captureTableActions(view,from)!;expect(lease).not.toBeNull();expect(lease.current()).toBe(true);expect(lease.readOnly).toBe(true);expect(lease.items.map(item=>item.id)).toEqual(['copy-cells']);
    expect(lease.execute('edit-cell')).toBe(false);expect(lease.execute('add-row')).toBe(false);expect(lease.execute('cut-cells')).toBe(false);expect(lease.execute('copy-cells')).toBe(true);await tick();
    expect(copied).toBe(true);expect(view.state.doc.toString()).toBe(source);expect(view.state.sliceDoc()).toBe(rawSource);expect(view.state.selection.eq(selection)).toBe(true);expect(undoDepth(view.state)).toBe(0);expect(panel.querySelector('.md-table-inline-editor')).toBeNull();
  });
  it('readonly HTML touch selects the real cell before outer CM pointer default and never starts a writable draft',()=>{
    const{view,panel,source,rawSource,permissions}=fixture('html',html,'Caret A\n\n','\r\n');
    view.dispatch({effects:permissions.reconfigure([EditorState.readOnly.of(true),EditorView.editable.of(false)])});const selection=view.state.selection;
    const cell=panel.querySelectorAll<HTMLTableCellElement>('td')[1],down=new Event('pointerdown',{bubbles:true,cancelable:true});Object.defineProperties(down,{pointerType:{value:'touch'},pointerId:{value:1},clientX:{value:10},clientY:{value:10}});
    expect(cell.dispatchEvent(down)).toBe(false);expect(down.defaultPrevented).toBe(true);expect(cell.getAttribute('aria-selected')).toBe('true');expect(document.activeElement).toBe(cell);
    cell.click();cell.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true,cancelable:true}));cell.dispatchEvent(new KeyboardEvent('keydown',{key:'x',bubbles:true,cancelable:true}));
    expect(panel.querySelector('.md-html-cell-editing')).toBeNull();expect(view.state.selection.eq(selection)).toBe(true);expect(view.state.doc.toString()).toBe(source);expect(view.state.sliceDoc()).toBe(rawSource);expect(undoDepth(view.state)).toBe(0);
  });
  it.each(['gfm','html'] as const)('clears obsolete mouse-leave timer and retains touch-selected %s B through Escape and touch leave',async kind=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    try{
      const{view,panel,from,source}=fixture(kind),selection=view.state.selection;
      const controller=new EditingController(view,{identity:()=>({documentId:'same-document',generation:'same-generation',mode:'live',profile:'tegg'})});stops.push(()=>controller.destroy());view.dispatch({effects:StateEffect.appendConfig.of(createCommandSurface(controller))});view.focus();
      const pointer=(type:string,pointerType:string,node:HTMLElement)=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperties(event,{pointerType:{value:pointerType},pointerId:{value:1},clientX:{value:10},clientY:{value:10}});node.dispatchEvent(event);};
      pointer('pointerleave','mouse',view.dom);vi.advanceTimersByTime(100);
      const preview=panel.querySelector<HTMLElement>(kind==='gfm'?'.cm-live-table-preview':'td')!;pointer('pointerdown','touch',preview);pointer('pointerup','touch',preview);preview.click();
      const more=view.dom.querySelector<HTMLButtonElement>('.tegg-command-more')!;expect(more.hidden).toBe(false);expect(more.dataset.blockFrom).toBe(String(from));more.click();
      view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));pointer('pointerleave','touch',view.dom);vi.advanceTimersByTime(200);await tick();
      expect(more.hidden).toBe(false);expect(more.dataset.blockFrom).toBe(String(from));more.click();expect([...view.dom.querySelectorAll('.tegg-command-option-label')].map(node=>node.textContent)).toContain(kind==='gfm'?'Add Row':'Insert column after');
      expect(view.state.selection.eq(selection)).toBe(true);expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);expect(panel.querySelector('.md-table-inline-editor,.md-html-cell-editing')).toBeNull();
      // An actual mouse pointerdown still clears the explicit touch target.
      pointer('pointerdown','mouse',view.contentDOM);expect(more.hidden).toBe(true);
    }finally{vi.useRealTimers();}
  });
  it.each(['gfm','html'] as const)('does not leave an earlier mouse-exit timer to revoke a newer touched %s B',async kind=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    try{
      const{view,panel,from,source}=fixture(kind),selection=view.state.selection;
      const controller=new EditingController(view,{identity:()=>({documentId:'same-document',generation:'same-generation',mode:'live',profile:'tegg'})});stops.push(()=>controller.destroy());view.dispatch({effects:StateEffect.appendConfig.of(createCommandSurface(controller))});view.focus();
      const pointer=(type:string,pointerType:string,node:HTMLElement)=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperties(event,{pointerType:{value:pointerType},pointerId:{value:1},clientX:{value:10},clientY:{value:10}});node.dispatchEvent(event);};
      pointer('pointerleave','mouse',view.dom);vi.advanceTimersByTime(100);pointer('pointerleave','mouse',view.dom);vi.advanceTimersByTime(10);
      const preview=panel.querySelector<HTMLElement>(kind==='gfm'?'.cm-live-table-preview':'td')!;pointer('pointerdown','touch',preview);pointer('pointerup','touch',preview);preview.click();
      const more=view.dom.querySelector<HTMLButtonElement>('.tegg-command-more')!;expect(more.dataset.blockFrom).toBe(String(from));
      vi.advanceTimersByTime(100);await tick();expect(more.hidden).toBe(false);expect(more.dataset.blockFrom).toBe(String(from));more.click();
      expect([...view.dom.querySelectorAll('.tegg-command-option-label')].map(node=>node.textContent)).toContain(kind==='gfm'?'Add Row':'Insert column after');
      expect(view.state.doc.toString()).toBe(source);expect(view.state.selection.eq(selection)).toBe(true);expect(undoDepth(view.state)).toBe(0);expect(panel.querySelector('.md-table-inline-editor,.md-html-cell-editing')).toBeNull();
    }finally{vi.useRealTimers();}
  });
  it('keeps the actual CRLF GFM child-resource-paste authority current only until that original draft is cancelled',async()=>{
    const{view,panel,from,source,rawSource}=fixture('gfm',gfm,'Caret A\n\n','\r\n'),selection=view.state.selection;
    expect(captureTableActions(view,from)!.execute('edit-cell')).toBe(true);const child=focusedTableCell(view)!;expect(child).not.toBeNull();
    let detail:{expected:string;prepared:{resources:unknown[]};cellDraft:{current():boolean;complete():void}}|undefined;
    panel.addEventListener('tegg-table-resource-paste',event=>{event.preventDefault();detail=(event as CustomEvent).detail;});
    const paste=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(paste,'clipboardData',{value:{getData:(type:string)=>type==='text/html'?'<img src="a.png" alt="cat">':'',types:['text/html'],files:[new File([new Uint8Array([1])],'a.png',{type:'image/png'})]}});child.contentDOM.dispatchEvent(paste);await tick();
    expect(paste.defaultPrevented).toBe(true);expect(detail).toBeDefined();expect(detail!.expected).toBe(gfm);expect(detail!.prepared.resources).toHaveLength(1);expect(detail!.cellDraft.current()).toBe(true);
    expect(view.state.doc.toString()).toBe(source);expect(view.state.sliceDoc()).toBe(rawSource);expect(view.state.selection.eq(selection)).toBe(true);expect(undoDepth(view.state)).toBe(0);
    child.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(detail!.cellDraft.current()).toBe(false);detail!.cellDraft.complete();
    expect(panel.querySelector('.md-table-inline-editor')).toBeNull();expect(view.state.doc.toString()).toBe(source);expect(view.state.sliceDoc()).toBe(rawSource);expect(view.state.selection.eq(selection)).toBe(true);expect(undoDepth(view.state)).toBe(0);
  });
});
