import {test,expect,type Page} from '@playwright/test';
const url='http://127.0.0.1:18930/reliable.html';
const original='| A | B |\n| --- | --- |\n| old | 2 |\n\nend';
async function load(page:Page,source=original){await page.goto(url);await page.evaluate(value=>(window as any).host.load(value),source);}
async function source(page:Page){return page.evaluate(()=>(window as any).host.editor.source as string);}

test('table inline edit keeps one document history through Tab, Shift-Tab and Escape',async({page})=>{
  await load(page);
  await page.getByRole('button',{name:'Edit table cell: old',exact:true}).click();
  const cell=page.locator('.md-table-inline-editor .cm-content');
  await expect(cell).toBeVisible();await cell.press('ControlOrMeta+A');await page.keyboard.type('cat');
  await expect.poll(()=>source(page)).toBe(original.replace('old','cat'));
  await cell.press('Tab');await expect(page.locator('.md-table-inline-editor .cm-content')).toContainText('2');
  await page.locator('.md-table-inline-editor .cm-content').press('Shift+Tab');
  await expect(page.locator('.md-table-inline-editor .cm-content')).toContainText('cat');
  await page.locator('.md-table-inline-editor .cm-content').press('Escape');
  await expect(page.getByRole('button',{name:'Edit table cell: cat',exact:true})).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Z');await expect.poll(()=>source(page)).toBe(original);
  await page.keyboard.press('ControlOrMeta+Shift+Z');await expect.poll(()=>source(page)).toBe(original.replace('old','cat'));
});

test('table rich text stays projected, toolbar formats the cell, and links use shared navigation',async({page})=>{
  const document='| **重要** | [site](https://example.com) |\n| --- | --- |\n| old | 2 |';
  await load(page,document);
  await page.getByRole('button',{name:'Edit table cell: **重要**',exact:true}).click();
  const cell=page.locator('.md-table-inline-editor .cm-content');
  await expect(cell).toHaveText('重要');
  await cell.press('Escape');
  await page.getByRole('button',{name:'Edit table cell: old',exact:true}).click();
  const plain=page.locator('.md-table-inline-editor .cm-content');await plain.press('ControlOrMeta+A');
  await page.getByRole('button',{name:'Bold',exact:true}).click();
  await expect.poll(()=>source(page)).toContain('| **old** | 2 |');
  await page.keyboard.press('Escape');
  const events=await page.evaluate(()=>{const result:string[]=[];(window as any).__tableLinks=result;(window as any).host.editor.view.dom.addEventListener('tegg-open-link',(event:Event)=>{result.push((event as CustomEvent<string>).detail);event.preventDefault();});return result.length;});
  expect(events).toBe(0);
  await page.locator('.cm-live-table-preview a[href="https://example.com"]').click();
  expect(await page.evaluate(()=>(window as any).__tableLinks)).toEqual(['https://example.com']);
  await expect(page.locator('.md-table-inline-editor .cm-content')).toHaveCount(0);
});

test('table Link toolbar command changes the selected cell and leaves the outer selection untouched',async({page})=>{
  const document='outside\n\n| A | B |\n| --- | --- |\n| old | 2 |\n\nafter';
  await load(page,document);
  const outer=await page.evaluate(()=>(window as any).host.editor.view.state.selection.main.anchor as number);
  await page.getByRole('button',{name:'Edit table cell: old',exact:true}).click();
  const cell=page.locator('.md-table-inline-editor .cm-content');await cell.press('ControlOrMeta+A');
  await page.getByRole('button',{name:'Link',exact:true}).click();
  await expect.poll(()=>source(page)).toContain('| [old](https://) | 2 |');
  const dialog=page.getByRole('dialog',{name:'Edit link'});
  await expect(dialog.getByRole('textbox',{name:'Link destination'})).toHaveValue('https://');
  await dialog.getByRole('textbox',{name:'Link destination'}).fill('next.md');
  await dialog.getByRole('button',{name:'Save',exact:true}).click();
  await expect.poll(()=>source(page)).toContain('| [old](<next.md>) | 2 |');
  const updated=await source(page);
  expect(await page.evaluate(()=>(window as any).host.editor.view.state.selection.main.anchor)).toBe(outer+updated.length-document.length);
  await expect(cell).toBeVisible();
});

test('table cell Arrow keys and Backspace respect hidden formatting boundaries',async({page})=>{
  await load(page,'| A |\n| --- |\n| **ab** |');
  await page.getByRole('button',{name:'Edit table cell: **ab**',exact:true}).click();
  const cell=page.locator('.md-table-inline-editor .cm-content');
  await expect(cell).toHaveText('ab');
  await cell.press('End');
  await cell.press('ArrowLeft');
  await cell.press('ArrowRight');
  await cell.press('Backspace');
  await expect.poll(()=>source(page)).toContain('| **a** |');
  await cell.press('Home');
  await cell.press('Backspace');
  await expect.poll(()=>source(page)).toContain('| a |');
});

test('table cell renders inline-code literals separately from highlight and HTML',async({page})=>{
  const document='| A |\n| --- |\n| `==literal==` <u>yes</u> ==highlight== |';
  await load(page,document);
  await page.getByRole('button',{name:'Edit table cell: `==literal==` <u>yes</u> ==highlight==',exact:true}).click();
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
  await preview.click();
  const after=await page.locator('.md-table-inline-editor .cm-content').evaluate(element=>getComputedStyle(element).fontSize);
  expect(after).toBe(before);
});

test('table selection is visible only while the table owns focus',async({page})=>{
  await load(page);
  const selected=page.locator('.cm-live-table .is-selected');
  await expect(selected).toHaveCSS('box-shadow','none');
  const preview=page.getByRole('button',{name:'Edit table cell: old',exact:true});
  await preview.click();
  const cell=page.locator('.md-table-inline-editor .cm-content');
  await expect(cell).toBeFocused();
  await expect(selected).not.toHaveCSS('box-shadow','none');
  await cell.press('Escape');
  await expect(preview).toBeFocused();
  await expect(selected).not.toHaveCSS('box-shadow','none');
  await page.locator('.cm-line').filter({hasText:/^end$/}).click();
  await expect(selected).toHaveCSS('box-shadow','none');
  expect(await source(page)).toBe(original);
  await preview.click();
  await expect(page.locator('.md-table-inline-editor .cm-content')).toBeFocused();
  await expect(selected).not.toHaveCSS('box-shadow','none');
  expect(await source(page)).toBe(original);
});
