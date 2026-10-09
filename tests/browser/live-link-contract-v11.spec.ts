import {test,expect,type Page,type Locator} from '@playwright/test';

// Prepared only. Run against one freshly installed immutable consumer tarball.
// Copy callbacks below model a Host ACK; they do not prove native clipboard writes.
const url=process.env.TEGG_LIVE_LINK_CONTRACT_URL??'http://127.0.0.1:18930/reliable.html';
const prose='Caret A\n\nprefix [Visible label](https://example.com/?x=1&y=2) suffix\n\nEnd';
const html="<table class='keep'><tr><td><p>Before <a href='https://example.com/?x=1&amp;y=2' rel='author' title='keep &amp; exact'>A&amp;B</a> after</p></td><td>next</td></tr></table>";
const table='Caret A\n\n| Name | State |\n| --- | --- |\n| [Visible](note.md) | next |\n\nEnd';
async function load(page:Page,source:string){
 await page.goto(url);await page.evaluate(source=>{
  const w=window as any;w.linkContract={opened:[],copied:[],ack:null};
  w.host.load(source,{openLink:(target:string)=>{w.linkContract.opened.push(target);},copyText:(value:string)=>{w.linkContract.copied.push(value);return new Promise<void>(resolve=>{w.linkContract.ack=resolve;});}});
  w.host.editor.view.dispatch({selection:{anchor:2}});w.host.editor.view.focus();
 },source);
}
const state=(page:Page)=>page.evaluate(()=>{const e=(window as any).host.editor;return{source:e.source,selection:{anchor:e.view.state.selection.main.anchor,head:e.view.state.selection.main.head},sequence:e.snapshot().sequence,canUndo:e.state.canUndo,canRedo:e.state.canRedo};});
const opened=(page:Page)=>page.evaluate(()=>(window as any).linkContract.opened as string[]);
const menu=(page:Page)=>page.locator('.md-link-popover').filter({has:page.locator('.md-link-copy-address')});
async function hit(locator:Locator){await expect(locator).toBeVisible();expect(await locator.evaluate(node=>{const r=node.getBoundingClientRect(),top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!top&&(node===top||node.contains(top));})).toBe(true);}
async function unchanged(page:Page,before:Awaited<ReturnType<typeof state>>){expect(await state(page)).toEqual(before);}
async function caret(page:Page){return page.evaluate(()=>{const s=document.getSelection()!;return{text:s.anchorNode?.textContent,offset:s.anchorOffset,collapsed:s.isCollapsed};});}
async function htmlDraft(page:Page){const cell=page.locator('#editor .cm-live-html-table td').first();await cell.locator('a').click();await cell.press('F2');await expect(cell).toHaveAttribute('contenteditable','true');return cell;}

// This Browser fixture models the approved Mac modifier intent on every CI OS.
// It does not prove physical Mac input; an actual Mac platform value stays intact.
async function macIntentFixture(page:Page){
 await page.addInitScript(()=>{if(!navigator.platform.includes('Mac'))Object.defineProperty(navigator,'platform',{configurable:true,get:()=> 'MacIntel'});});
}

test('ordinary main Live link click locates the actual visible label and types at that source caret',async({page})=>{
 await load(page,prose);const link=page.locator('#editor .cm-live-link');await hit(link);await link.click({position:{x:25,y:8}});
 const before=await state(page),start=prose.indexOf('Visible label');expect(before.selection.anchor).toBe(before.selection.head);expect(before.selection.head).toBeGreaterThanOrEqual(start);expect(before.selection.head).toBeLessThanOrEqual(start+'Visible label'.length);expect(await opened(page)).toEqual([]);await expect(link).toHaveText('Visible label');
 await page.keyboard.type('X');expect((await state(page)).source).toBe(prose.slice(0,before.selection.head)+'X'+prose.slice(before.selection.head));await page.keyboard.press('ControlOrMeta+z');expect((await state(page)).source).toBe(prose);
});

test('Mac Command opens explicitly and ordinary context actions Copy wait for a current Host ACK',async({page})=>{
 await macIntentFixture(page);
 await load(page,prose);const link=page.locator('#editor .cm-live-link');expect(await page.evaluate(()=>navigator.platform)).toMatch(/Mac/);await hit(link);await link.click({modifiers:['Meta']});expect(await opened(page)).toEqual(['https://example.com/?x=1&y=2']);expect((await state(page)).source).toBe(prose);
 await link.click({button:'right'});await expect(menu(page)).toBeVisible();await hit(menu(page).getByRole('button',{name:'Copy link address',exact:true}));await menu(page).getByRole('button',{name:'Copy link address',exact:true}).click();await expect(menu(page).locator('.md-link-hint')).not.toHaveText('Copied');expect(await page.evaluate(()=>(window as any).linkContract.copied)).toEqual(['https://example.com/?x=1&y=2']);
 await page.evaluate(()=>(window as any).linkContract.ack());await expect(menu(page).locator('[role=status]')).toHaveText('Copied');expect((await state(page)).source).toBe(prose);
});

test('Core mixed-newline readonly Live prose retains Open and Copy without granting Edit',async({page})=>{
 const raw=prose.replace('Caret A\n\n','Caret A\r\n\n');await load(page,raw);expect(await page.evaluate(()=>(window as any).host.editor.mode)).toBe('live');expect(await page.evaluate(()=>(window as any).host.editor.view.state.readOnly)).toBe(true);
 const link=page.locator('#editor .cm-live-link');await link.click();expect(await opened(page)).toEqual([]);const before=await state(page);
 await link.click({button:'right'});await expect(menu(page)).toBeVisible();await expect(menu(page).getByRole('button',{name:'Edit link',exact:true})).toBeDisabled();
 const contextState=await state(page);expect({...contextState,selection:before.selection}).toEqual(before);await unchanged(page,contextState);
 await menu(page).getByRole('button',{name:'Copy link address',exact:true}).click();await expect(menu(page).locator('.md-link-hint')).not.toHaveText('Copied');expect(await page.evaluate(()=>(window as any).linkContract.copied)).toEqual(['https://example.com/?x=1&y=2']);await unchanged(page,contextState);expect(await opened(page)).toEqual([]);
 await page.evaluate(()=>(window as any).linkContract.ack());await expect(menu(page).locator('[role=status]')).toHaveText('Copied');await unchanged(page,contextState);expect(await opened(page)).toEqual([]);
});

test('actual GFM link touch selects first, enters text editing second and commits one parent Undo',async({browser})=>{
 const context=await browser.newContext({hasTouch:true,viewport:{width:390,height:844}}),page=await context.newPage();try{
  await load(page,table);const before=await state(page),cell=page.locator('#editor .cm-live-table td').filter({hasText:'Visible'}),link=cell.locator('a');await hit(link);await link.tap();await expect(cell).toHaveAttribute('aria-selected','true');await expect(page.locator('.md-table-inline-editor')).toHaveCount(0);expect(await opened(page)).toEqual([]);await unchanged(page,before);
  await link.tap();const field=page.locator('.md-table-inline-editor .cm-content');await expect(field).toBeVisible();await field.locator('.cm-live-link').click({position:{x:18,y:8}});const c=await caret(page);expect(c.collapsed).toBe(true);expect(c.text).toBe('Visible');expect(await opened(page)).toEqual([]);await page.keyboard.type('X');expect((await state(page)).source).toBe(table);await field.press('ControlOrMeta+Enter');expect((await state(page)).source).toBe(table.replace('[Visible]','['+'Visible'.slice(0,c.offset)+'X'+'Visible'.slice(c.offset)+']'));await page.locator('#editor .cm-content').first().click();await page.keyboard.press('ControlOrMeta+z');expect((await state(page)).source).toBe(table);
 }finally{await context.close();}
});

test('actual HTML link touch and native label input preserve author attributes until explicit cell commit',async({browser})=>{
 const context=await browser.newContext({hasTouch:true,viewport:{width:390,height:844}}),page=await context.newPage();try{
  const raw='Caret A\n\n'+html+'\n\nEnd';await load(page,raw);const before=await state(page),cell=page.locator('#editor .cm-live-html-table td').first(),link=cell.locator('a');await hit(link);await link.tap();await expect(cell).toHaveClass(/md-html-cell-selected/);await expect(cell).not.toHaveAttribute('contenteditable','true');await unchanged(page,before);expect(await opened(page)).toEqual([]);
  await link.tap();await expect(cell).toHaveAttribute('contenteditable','true');await hit(cell.locator('a'));const character=await cell.locator('a').evaluate(anchor=>{const text=anchor.firstChild;if(!text||text.nodeType!==Node.TEXT_NODE)throw new Error('Actual link text unavailable');const glyph=document.createRange();glyph.setStart(text,1);glyph.setEnd(text,2);const box=glyph.getBoundingClientRect();if(!box.width||!box.height)throw new Error('Actual link character has no visible rectangle');return {x:box.x+box.width/2,y:box.y+box.height/2};});await page.mouse.click(character.x,character.y);const c=await caret(page);expect(c.collapsed).toBe(true);expect(c.text).toBe('A&B');await page.keyboard.type('X');expect((await state(page)).source).toBe(raw);const offsets=[0,1,6,7],label='A&amp;B',next=label.slice(0,offsets[c.offset])+'X'+label.slice(offsets[c.offset]);await cell.press('ControlOrMeta+Enter');expect((await state(page)).source).toBe(raw.replace('>A&amp;B</a>','>'+next+'</a>'));const outside=page.locator('#editor .cm-line').filter({hasText:/^Caret A$/});await expect(outside).toBeVisible();await outside.click();await expect(page.locator('#editor .cm-content').first()).toBeFocused();await page.keyboard.press('ControlOrMeta+z');expect((await state(page)).source).toBe(raw);
 }finally{await context.close();}
});

test('editable HTML Command and menu Copy preserve both carets and ignore a canceled owner late ACK',async({page})=>{
 await macIntentFixture(page);
 const raw='Caret A\n\n'+html+'\n\nEnd';await load(page,raw);const cell=await htmlDraft(page),a=cell.locator('a');
 const contextSnapshot=()=>cell.evaluate(element=>{
  const e=(window as any).host.editor,s=element.ownerDocument.getSelection();
  const path=(node:Node|null)=>{const result:number[]=[];let current=node;while(current&&current!==element){const parent=current.parentNode;if(!parent)return null;result.unshift(Array.prototype.indexOf.call(parent.childNodes,current));current=parent;}return current===element?result:null;};
  const range=s?.rangeCount?s.getRangeAt(0):null;
  return{parent:{source:e.source,selection:{anchor:e.view.state.selection.main.anchor,head:e.view.state.selection.main.head},sequence:e.snapshot().sequence,canUndo:e.state.canUndo,canRedo:e.state.canRedo},html:element.innerHTML,range:s&&range?{anchorText:s.anchorNode?.textContent,anchorOffset:s.anchorOffset,anchorPath:path(s.anchorNode),focusText:s.focusNode?.textContent,focusOffset:s.focusOffset,focusPath:path(s.focusNode),collapsed:s.isCollapsed,startText:range.startContainer.textContent,startOffset:range.startOffset,startPath:path(range.startContainer),endText:range.endContainer.textContent,endOffset:range.endOffset,endPath:path(range.endContainer)}:null};
 });
 const recordContext=async(phase:string)=>{const value=await contextSnapshot();await test.info().attach('html-link-'+phase,{body:JSON.stringify(value,null,2),contentType:'application/json'});return value;};
 await a.click();const before=await state(page),textBefore=await caret(page);await a.click({modifiers:['Meta']});expect(await opened(page)).toEqual(['https://example.com/?x=1&y=2']);expect(await caret(page)).toEqual(textBefore);await unchanged(page,before);
 await recordContext('after-meta-before-context');await a.click({button:'right'});await expect(menu(page)).toBeVisible();const contextState=await recordContext('after-context-before-focus');expect(contextState.parent).toEqual(before);expect(contextState.range).not.toBeNull();expect(Array.isArray(contextState.range?.anchorPath)).toBe(true);expect(Array.isArray(contextState.range?.focusPath)).toBe(true);
 const copy=menu(page).getByRole('button',{name:'Copy link address',exact:true});await copy.focus();await expect(copy).toBeFocused();const focusedState=await recordContext('after-copy-focus');expect(focusedState.parent).toEqual(contextState.parent);expect(focusedState.html).toBe(contextState.html);
 await copy.press('Escape');await expect(menu(page)).toHaveCount(0);await expect(cell).toBeFocused();const escapedState=await recordContext('after-menu-escape');expect(escapedState.parent).toEqual(contextState.parent);expect(escapedState.html).toBe(contextState.html);expect(escapedState.range).toEqual(contextState.range);expect(await opened(page)).toEqual(['https://example.com/?x=1&y=2']);await page.keyboard.type('X');expect((await state(page)).source).toBe(raw);await expect(cell.locator('a')).toContainText('X');await cell.press('Escape');await unchanged(page,before);
 await cell.locator('a').click();await cell.press('F2');await cell.locator('a').click({button:'right'});await menu(page).getByRole('button',{name:'Copy link address',exact:true}).click();await expect(menu(page).locator('.md-link-hint')).not.toHaveText('Copied');expect(await page.evaluate(()=>(window as any).linkContract.copied)).toEqual(['https://example.com/?x=1&y=2']);await unchanged(page,before);await cell.press('Escape');await expect(menu(page)).toHaveCount(0);await page.evaluate(()=>(window as any).linkContract.ack());await expect(menu(page)).toHaveCount(0);await unchanged(page,before);await expect(cell.locator('a')).toHaveAttribute('rel','author');expect(await opened(page)).toEqual(['https://example.com/?x=1&y=2']);
 await cell.locator('a').click();await cell.press('F2');await cell.locator('a').click({button:'right'});await menu(page).getByRole('button',{name:'Copy link address',exact:true}).click();await expect(menu(page).locator('.md-link-hint')).not.toHaveText('Copied');expect(await page.evaluate(()=>(window as any).linkContract.copied)).toEqual(['https://example.com/?x=1&y=2','https://example.com/?x=1&y=2']);await unchanged(page,before);const generation=await page.evaluate(()=>(window as any).host.editor.snapshot().generation);await page.evaluate(raw=>{const h=(window as any).host;const result=h.editor.replaceDocument({documentId:'new-link-document',revision:'disk-new',source:raw,profile:'tegg'});if(result!=='applied')throw new Error('Actual public replacement did not apply: '+result);h.ui.attachToCurrentState();},raw);await page.evaluate(()=>(window as any).linkContract.ack());await expect(menu(page)).toHaveCount(0);expect((await state(page)).source).toBe(raw);expect((await state(page)).sequence).toBe(0);expect(await page.evaluate(()=>(window as any).host.editor.snapshot().generation)).not.toBe(generation);expect(await opened(page)).toEqual(['https://example.com/?x=1&y=2']);
});

test('actual mapped HTML Edit uses the existing form and Cancel retains original href, rel and entity bytes',async({page})=>{
 await macIntentFixture(page);
 const raw='Caret A\n\n'+html+'\n\nEnd';await load(page,raw);const cell=await htmlDraft(page),before=await state(page);await cell.locator('a').click({button:'right'});await hit(menu(page).getByRole('button',{name:'Edit link',exact:true}));await menu(page).getByRole('button',{name:'Edit link',exact:true}).click();const panel=page.locator('.tegg-editing-panel:not([hidden])');await expect(panel).toBeVisible();await hit(panel.getByRole('button',{name:'Cancel',exact:true}));await panel.getByRole('button',{name:'Cancel',exact:true}).click();await cell.press('Escape');await expect(cell.locator('a')).toHaveAttribute('rel','author');await unchanged(page,before);
 await cell.locator('a').click();await cell.press('F2');await cell.locator('a').click({modifiers:['Meta']});expect(await opened(page)).toEqual(['https://example.com/?x=1&y=2']);await unchanged(page,before);
});

test('coarse-pointer actual editable HTML menu keeps Open Edit Copy reachable at their existing 44px targets',async({browser})=>{
 const context=await browser.newContext({hasTouch:true,viewport:{width:390,height:844}}),page=await context.newPage();try{
  await load(page,'Caret A\n\n'+html+'\n\nEnd');const cell=await htmlDraft(page),before=await state(page);await cell.locator('a').click({button:'right'});await expect(menu(page)).toHaveAttribute('data-mobile','true');const actions=[menu(page).locator('.md-link-destination'),menu(page).getByRole('button',{name:'Edit link',exact:true}),menu(page).getByRole('button',{name:'Copy link address',exact:true})];
  for(const action of actions){await hit(action);const r=await action.boundingBox();expect(r!.width).toBeGreaterThanOrEqual(44);expect(r!.height).toBeGreaterThanOrEqual(44);expect(r!.x).toBeGreaterThanOrEqual(0);expect(r!.x+r!.width).toBeLessThanOrEqual(390);expect(r!.y).toBeGreaterThanOrEqual(0);expect(r!.y+r!.height).toBeLessThanOrEqual(844);}await menu(page).getByRole('button',{name:'Copy link address',exact:true}).tap();await page.evaluate(()=>(window as any).linkContract.ack());await expect(menu(page).locator('[role=status]')).toHaveText('Copied');await unchanged(page,before);
 }finally{await context.close();}
});
