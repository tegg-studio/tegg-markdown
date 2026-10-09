import {test,expect,type Page,type Locator} from '@playwright/test';

// Actual source SDK fixture/controller interactions, not Native or physical IME.
const url=process.env.TEGG_CLIPBOARD_TEST_URL ?? 'http://127.0.0.1:18930/reliable.html';
const gfm='Before\n\n| A | B |\n| --- | --- |\n| [Link](a.md) | next |\n\nAfter';
const html="Before\n\n<table><tr><td><p>Text <strong>old</strong> <a href='a.md' rel='author'>Link</a></p></td><td>Other</td></tr></table>\n\nAfter";
const errors=new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{const records:string[]=[];errors.set(page,records);page.on('pageerror',error=>records.push(error.stack??error.message));});
test.afterEach(async({page})=>{const records=errors.get(page)??[];await test.info().attach('page-errors',{body:JSON.stringify(records,null,2),contentType:'application/json'});expect(records).toEqual([]);});
async function load(page:Page,source:string){await page.goto(url);await page.evaluate(source=>{const h=(window as any).host;h.load(source);h.editor.view.dispatch({selection:{anchor:2}});h.editor.view.focus();},source);}
const state=(page:Page)=>page.evaluate(()=>{const e=(window as any).host.editor;return {source:e.source,selection:{anchor:e.view.state.selection.main.anchor,head:e.view.state.selection.main.head},sequence:e.snapshot().sequence,canUndo:e.state.canUndo,canRedo:e.state.canRedo};});
const range=(input:Locator)=>input.evaluate(node=>{const field=node as HTMLInputElement;return {start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection};});
async function selectField(input:Locator){await input.press('ArrowRight');await input.press('ArrowLeft');await input.press('Shift+ArrowLeft');const value=await range(input);expect(value.start).not.toBe(value.end);return value;}
async function hit(input:Locator){await expect(input).toBeVisible();expect(await input.evaluate(node=>{const r=node.getBoundingClientRect(),top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!top&&(node===top||node.contains(top));})).toBe(true);}
async function phase(page:Page,name:string){await test.info().attach(name,{body:JSON.stringify(await state(page),null,2),contentType:'application/json'});}

test('actual GFM detached link field keeps the cell draft and C4 Keep restores its real field selection',async({page})=>{
 await load(page,gfm);
 const preview=page.locator('#editor .cm-live-table [data-table-row="1"][data-table-column="0"] button');await hit(preview);await preview.dblclick();
 const child=page.locator('.md-table-inline-editor');await expect(child).toBeVisible();const link=child.locator('.cm-live-link');await hit(link);await link.click({button:'right'});
 const actions=page.locator('.md-link-popover').filter({has:page.locator('.md-link-copy-address')});await hit(actions.getByRole('button',{name:'Edit link',exact:true}));await actions.getByRole('button',{name:'Edit link',exact:true}).click();
 const panel=page.locator('.md-link-editor'),field=panel.locator('[data-tegg-ui-label="Link destination"]');await hit(field);await field.fill('child-local.md');const fieldRange=await selectField(field),before=await state(page);await phase(page,'gfm-real-child-field');
 await expect(field).toBeFocused();await expect(child).toBeVisible();expect(before.source).toBe(gfm);expect(before.sequence).toBe(0);expect(before.canUndo).toBe(false);expect(before.canRedo).toBe(false);
 // The real child editor is a native modal dialog; background is intentionally inert.
 await field.press('Escape');
 const keep=panel.locator('.md-link-leave-choice').getByRole('button',{name:'Keep editing',exact:true});await hit(keep);await expect(keep).toBeFocused();await expect(child).toBeVisible();expect(await state(page)).toEqual(before);await phase(page,'gfm-real-c4-choice');
 await keep.click();await expect(field).toBeFocused();expect(await range(field)).toEqual(fieldRange);await expect(field).toHaveValue('child-local.md');await expect(panel.locator('.md-link-leave-choice')).toHaveCount(0);await expect(child).toBeVisible();expect(await state(page)).toEqual(before);await phase(page,'gfm-keep-field-restored');
});

test('actual HTML detached mapped child field does not commit the cell and C4 Keep restores its field range',async({page})=>{
 await load(page,html);
 const cell=page.locator('#editor .cm-live-html-table td').first();await hit(cell.locator('a'));await cell.locator('a').click();await cell.press('F2');await expect(cell).toHaveAttribute('contenteditable','true');await cell.locator('a').click({button:'right'});
 const actions=page.locator('.md-link-popover').filter({has:page.locator('.md-link-copy-address')});await hit(actions.getByRole('button',{name:'Edit link',exact:true}));await actions.getByRole('button',{name:'Edit link',exact:true}).click();
 const panel=page.locator('.tegg-editing-panel:not([hidden])').filter({has:page.locator('[data-tegg-ui-label="Target"]')}),field=panel.locator('[data-tegg-ui-label="Target"]');await hit(field);await field.fill('child-local.md');const fieldRange=await selectField(field),before=await state(page);await phase(page,'html-real-child-field');
 await expect(field).toBeFocused();await expect(cell).toHaveAttribute('contenteditable','true');await expect(cell.locator('a')).toHaveAttribute('href','a.md');await expect(cell.locator('a')).toHaveAttribute('rel','author');expect(before.source).toBe(html);expect(before.sequence).toBe(0);expect(before.canUndo).toBe(false);expect(before.canRedo).toBe(false);
 // The real child editor is a native modal dialog; background is intentionally inert.
 await field.press('Escape');
 const keep=panel.locator('.tegg-discard-draft').getByRole('button',{name:'Keep editing',exact:true});await hit(keep);await expect(keep).toBeFocused();await expect(cell).toHaveAttribute('contenteditable','true');expect(await state(page)).toEqual(before);await phase(page,'html-real-c4-choice');
 await keep.click();await expect(field).toBeFocused();expect(await range(field)).toEqual(fieldRange);await expect(field).toHaveValue('child-local.md');await expect(panel.locator('.tegg-discard-draft')).toHaveCount(0);await expect(cell).toHaveAttribute('contenteditable','true');await expect(cell.locator('a')).toHaveAttribute('href','a.md');expect(await state(page)).toEqual(before);await phase(page,'html-keep-field-restored');
});
