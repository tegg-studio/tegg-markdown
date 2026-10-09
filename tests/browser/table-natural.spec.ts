import {test,expect,type Page} from '@playwright/test';
const url='http://127.0.0.1:18930/reliable.html';
const original='| A | B |\n| --- | --- |\n| old | 2 |\n\nend';
async function load(page:Page,source=original){await page.goto(url);await page.evaluate(value=>(window as any).host.load(value),source);}
async function source(page:Page){return page.evaluate(()=>(window as any).host.editor.source as string);}

// This late fixture models only the explicit Mac modifier navigation intent.
// Earlier formatting keeps the real OS/CodeMirror keymap, including ControlOrMeta+A.
// It does not prove physical Mac input; an actual Mac platform value stays intact.
async function macIntentFixture(page:Page){
 await page.evaluate(()=>{if(!navigator.platform.includes('Mac'))Object.defineProperty(navigator,'platform',{configurable:true,get:()=> 'MacIntel'});});
}

test('table inline draft commits before Tab and selection navigation retains one document Undo',async({page})=>{
  await load(page);await page.getByRole('button',{name:'Edit table cell: old',exact:true}).dblclick();const cell=page.locator('.md-table-inline-editor .cm-content');await cell.press('ControlOrMeta+A');await page.keyboard.type('cat');expect(await source(page)).toBe(original);await cell.press('Tab');await expect(page.getByRole('button',{name:'Edit table cell: 2',exact:true})).toBeFocused();await expect(cell).toHaveCount(0);await page.keyboard.press('Shift+Tab');await expect(page.getByRole('button',{name:'Edit table cell: cat',exact:true})).toBeFocused();await page.keyboard.press('Escape');await page.keyboard.press('ControlOrMeta+Z');await expect.poll(()=>source(page)).toBe(original);await page.keyboard.press('ControlOrMeta+Shift+Z');await expect.poll(()=>source(page)).toBe(original.replace('old','cat'));
});

test('table rich text stays projected, toolbar formats the cell, and links use shared navigation',async({page})=>{
  const document='| **重要** | [site](https://example.com) |\n| --- | --- |\n| old | 2 |';
  await load(page,document);
  await page.getByRole('button',{name:'Edit table cell: **重要**',exact:true}).dblclick();
  const cell=page.locator('.md-table-inline-editor .cm-content');
  await expect(cell).toHaveText('重要');
  await cell.press('Escape');
  await page.getByRole('button',{name:'Edit table cell: old',exact:true}).dblclick();
  const plain=page.locator('.md-table-inline-editor .cm-content');await plain.press('ControlOrMeta+A');
  await page.getByRole('button',{name:'Bold',exact:true}).click();
  await expect(plain).toHaveText('old');expect(await source(page)).toBe(document);await plain.press('Enter');await expect.poll(()=>source(page)).toContain('| **old** | 2 |');
  const events=await page.evaluate(()=>{const result:string[]=[];(window as any).__tableLinks=result;(window as any).host.editor.view.dom.addEventListener('tegg-open-link',(event:Event)=>{result.push((event as CustomEvent<string>).detail);event.preventDefault();});return result.length;});
  expect(events).toBe(0);
  const afterFormatting=await source(page),outer=await page.evaluate(()=>{const s=(window as any).host.editor.view.state.selection.main;return{anchor:s.anchor,head:s.head};});
  expect(afterFormatting).toBe(document.replace('| old | 2 |','| **old** | 2 |'));
  const previewLink=page.locator('.cm-live-table-preview a[href="https://example.com"]'),previewCell=page.getByRole('button',{name:'Edit table cell: [site](https://example.com)',exact:true});
  await previewLink.click();
  await expect(previewCell.locator('xpath=ancestor::th[1]')).toHaveAttribute('data-cell-state','selected');
  expect(await page.evaluate(()=>(window as any).__tableLinks)).toEqual([]);
  await expect(page.locator('.md-table-inline-editor .cm-content')).toHaveCount(0);
  expect(await source(page)).toBe(afterFormatting);
  expect(await page.evaluate(()=>{const s=(window as any).host.editor.view.state.selection.main;return{anchor:s.anchor,head:s.head};})).toEqual(outer);
  await previewCell.press('F2');
  const linkedCell=page.locator('.md-table-inline-editor .cm-content'),visibleLink=linkedCell.locator('.cm-live-link');
  await expect(linkedCell).toBeVisible();await expect(visibleLink).toHaveText('site');
  await visibleLink.click();
  expect(await page.evaluate(()=>(window as any).__tableLinks)).toEqual([]);
  expect(await source(page)).toBe(afterFormatting);
  expect(await page.evaluate(()=>{const s=(window as any).host.editor.view.state.selection.main;return{anchor:s.anchor,head:s.head};})).toEqual(outer);
  await macIntentFixture(page);
  expect(await page.evaluate(()=>navigator.platform)).toMatch(/Mac/);
  await visibleLink.click({modifiers:['Meta']});
  expect(await page.evaluate(()=>(window as any).__tableLinks)).toEqual(['https://example.com']);
  expect(await source(page)).toBe(afterFormatting);
  expect(await page.evaluate(()=>{const s=(window as any).host.editor.view.state.selection.main;return{anchor:s.anchor,head:s.head};})).toEqual(outer);
  await linkedCell.press('Escape');
  await expect(page.locator('.md-table-inline-editor .cm-content')).toHaveCount(0);
  expect(await source(page)).toBe(afterFormatting);
  expect(await page.evaluate(()=>(window as any).host.editor.command('undo'))).toBe(true);
  await expect.poll(()=>source(page)).toBe(document);
  expect(await page.evaluate(()=>(window as any).host.editor.command('undo'))).toBe(false);
});

test('table Link toolbar command changes the selected cell and leaves the outer selection untouched',async({page})=>{
  const document='outside\n\n| A | B |\n| --- | --- |\n| old | 2 |\n\nafter';
  await load(page,document);
  const outer=await page.evaluate(()=>(window as any).host.editor.view.state.selection.main.anchor as number);
  await page.getByRole('button',{name:'Edit table cell: old',exact:true}).dblclick();
  const cell=page.locator('.md-table-inline-editor .cm-content');await cell.press('ControlOrMeta+A');
  await page.getByRole('button',{name:'Link',exact:true}).click();
  expect(await source(page)).toBe(document);await expect(cell).toHaveText('old');
  const dialog=page.getByRole('dialog',{name:'Edit link'});
  await expect(dialog.getByRole('textbox',{name:'Link destination'})).toHaveValue('https://');
  await dialog.getByRole('textbox',{name:'Link destination'}).fill('next.md');
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  expect(await source(page)).toBe(document);await cell.press('Enter');await expect.poll(()=>source(page)).toContain('| [old](<next.md>) | 2 |');
  const updated=await source(page);
  expect(await page.evaluate(()=>(window as any).host.editor.view.state.selection.main.anchor)).toBe(outer+updated.length-document.length);
  await expect(cell).toHaveCount(0);
});

test('table cell Arrow keys and Backspace respect hidden formatting boundaries',async({page})=>{
  await load(page,'| A |\n| --- |\n| **ab** |');
  await page.getByRole('button',{name:'Edit table cell: **ab**',exact:true}).dblclick();
  const cell=page.locator('.md-table-inline-editor .cm-content');
  await expect(cell).toHaveText('ab');
  await cell.press('End');
  await cell.press('ArrowLeft');
  await cell.press('ArrowRight');
  await cell.press('Backspace');
  await expect(cell).toHaveText('a');expect(await source(page)).toBe('| A |\n| --- |\n| **ab** |');
  await cell.press('Home');
  await cell.press('Backspace');
  await expect(cell).toHaveText('a');await cell.press('Enter');await expect.poll(()=>source(page)).toContain('| a |');
});

test('table cell renders inline-code literals separately from highlight and HTML',async({page})=>{
  const document='| A |\n| --- |\n| `==literal==` <u>yes</u> ==highlight== |';
  await load(page,document);
  await page.getByRole('button',{name:'Edit table cell: `==literal==` <u>yes</u> ==highlight==',exact:true}).dblclick();
  const editor=page.locator('.md-table-inline-editor');
  await expect(editor.locator('.cm-content')).toHaveText('==literal== yes highlight');
  await expect(editor.locator('.cm-live-inline-code')).toHaveText('==literal==');
  await expect(editor.locator('.cm-live-u')).toHaveText('yes');
  await expect(editor.locator('.cm-live-highlight')).toHaveText('highlight');
  expect(await source(page)).toBe(document);
});

test('table cell keeps the preview font size when its nested editor mounts',async({page})=>{
  await load(page);
  const preview=page.getByRole('button',{name:'Edit table cell: old',exact:true});
  const before=await preview.evaluate(element=>getComputedStyle(element).fontSize);
  expect(before).toBe('15px');
  await preview.dblclick();
  const after=await page.locator('.md-table-inline-editor .cm-content').evaluate(element=>getComputedStyle(element).fontSize);
  expect(after).toBe(before);
});

test('table selection is visible only while the table owns focus',async({page})=>{
  await load(page);
  const selected=page.locator('.cm-live-table .is-selected');
  await expect(selected).toHaveCSS('box-shadow','none');
  const preview=page.getByRole('button',{name:'Edit table cell: old',exact:true});
  await preview.dblclick();
  const cell=page.locator('.md-table-inline-editor .cm-content');
  await expect(cell).toBeFocused();
  await expect(selected).not.toHaveCSS('box-shadow','none');
  await cell.press('Escape');
  await expect(preview).toBeFocused();
  await expect(selected).not.toHaveCSS('box-shadow','none');
  await page.locator('.cm-line').filter({hasText:/^end$/}).click();
  await expect(selected).toHaveCSS('box-shadow','none');
  expect(await source(page)).toBe(original);
  await preview.dblclick();
  await expect(page.locator('.md-table-inline-editor .cm-content')).toBeFocused();
  await expect(selected).not.toHaveCSS('box-shadow','none');
  expect(await source(page)).toBe(original);
});


test('table rich attachment paste replaces the current browser selection and remains a draft until completion',async({page})=>{
  const document='before\n\n| A | B |\n| --- | --- |\n| old | untouched |\n\nafter';
  await load(page,document);await page.getByRole('button',{name:'Edit table cell: old',exact:true}).dblclick();
  const started=await page.evaluate(()=>{
    (window as any).host.setStorage('deferred');
    const field=window.document.querySelector<HTMLElement>('.md-table-inline-editor .cm-content')!;
    field.focus();const range=window.document.createRange();range.selectNodeContents(field);
    const selection=window.document.getSelection()!;selection.removeAllRanges();selection.addRange(range);
    // Paste immediately, before the editor observer can synchronize DOMSelection.
    const data=new DataTransfer();data.items.add(new File([new Uint8Array([137,80,78,71])],'fixture.png',{type:'image/png'}));data.setData('text/html','<img src="fixture.png" alt="Browser fixture">');
    const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});
    // Firefox's synthetic constructor discards clipboardData; install the test payload explicitly.
    Object.defineProperty(event,'clipboardData',{value:data});field.dispatchEvent(event);
    return {prevented:event.defaultPrevented,files:event.clipboardData?.files.length,html:event.clipboardData?.getData('text/html'),calls:(window as any).host.storage.calls,errors:(window as any).host.errors};
  });
  expect(started).toEqual({prevented:true,files:1,html:'<img src="fixture.png" alt="Browser fixture">',calls:1,errors:[]});
  expect(await source(page)).toBe(document);
  expect(await page.evaluate(()=>(window as any).host.editor.prepareLeave())).toBe(false);
  await expect.poll(()=>page.evaluate(()=>(window as any).host.resources.length)).toBe(1);
  await expect(page.locator('.tegg-editing-panel:not([hidden])')).toHaveCount(0);
  expect(await source(page)).toBe(document);
  expect(await page.evaluate(()=>(window as any).host.editor.prepareLeave())).toBe(true);
  const edited=await source(page);expect(edited).not.toContain('old');expect(edited).toContain('![Browser fixture](<attachments/');expect(edited).toContain('| untouched |');expect(edited).toMatch(/^before\n\n/);expect(edited).toMatch(/\n\nafter$/);
  await page.evaluate(()=>(window as any).host.editor.command('undo'));await expect.poll(()=>source(page)).toBe(document);
});


test('table link independent fields guard mode changes, cancel old IME requests and complete before one outer commit',async({page})=>{
 const value='outside\n\n| A | B |\n| --- | --- |\n| [old](old.md) | 2 |\n\nafter';await load(page,value);await page.getByRole('button',{name:'Edit table cell: [old](old.md)',exact:true}).dblclick();const cell=page.locator('.md-table-inline-editor .cm-content');await cell.press('ControlOrMeta+A');expect(await page.evaluate(()=>(window as any).host.editor.command('link'))).toBe(true);const dialog=page.locator('.md-link-editor');await dialog.getByLabel('Link destination',{exact:true}).fill('next.md');expect(await source(page)).toBe(value);
 await page.evaluate(()=>{const state={cancelled:0,resolved:0};(window as any).__linkLeave=state;(window as any).host.ui.element.parentElement.addEventListener('tegg-editing-leave-cancelled',()=>state.cancelled++);(window as any).host.ui.element.parentElement.addEventListener('tegg-editing-leave-resolved',()=>state.resolved++);});
 expect(await page.evaluate(()=>(window as any).host.editor.setMode('reader'))).toBe(false);expect(await page.evaluate(()=>(window as any).host.ui.awaitingLeaveChoice)).toBe(true);await dialog.getByRole('button',{name:'Keep editing',exact:true}).click();expect(await page.evaluate(()=>(window as any).__linkLeave.cancelled)).toBe(1);expect(await page.evaluate(()=>(window as any).host.ui.awaitingLeaveChoice)).toBe(false);
 const target=dialog.getByLabel('Link destination',{exact:true});await target.evaluate(node=>node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));expect(await page.evaluate(()=>(window as any).host.editor.setMode('reader'))).toBe(false);expect(await page.evaluate(()=>(window as any).host.ui.awaitingLeaveChoice)).toBe(false);await target.evaluate(node=>node.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));expect(await page.evaluate(()=>(window as any).host.editor.mode)).toBe('live');expect(await source(page)).toBe(value);
 expect(await page.evaluate(()=>(window as any).host.editor.setMode('reader'))).toBe(false);await dialog.getByRole('button',{name:'Complete and continue',exact:true}).click();expect(await page.evaluate(()=>(window as any).__linkLeave.resolved)).toBe(1);expect(await source(page)).toBe(value);expect(await page.evaluate(()=>(window as any).host.editor.setMode('reader'))).toBe(true);expect(await source(page)).toBe(value.replace('[old](old.md)','[old](<next.md>)'));await page.evaluate(()=>(window as any).host.editor.setMode('live'));expect(await page.evaluate(()=>(window as any).host.editor.command('undo'))).toBe(true);expect(await source(page)).toBe(value);
});
