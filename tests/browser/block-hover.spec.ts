import {test,expect,type Page} from '@playwright/test';
const trigger=(page:Page)=>page.locator('.tegg-command-more');
const menu=(page:Page)=>page.locator('.tegg-command-menu');
const sourceOf=(page:Page)=>page.evaluate(()=>(window as any).host.editor.source as string);
async function open(page:Page,source:string){
 await page.goto('http://127.0.0.1:18930/reliable.html');await page.evaluate(source=>(window as any).host.load(source),source);
 await page.evaluate(()=>{const e=(window as any).host.editor;e.view.dispatch({selection:{anchor:1}});e.view.focus();});
 await page.mouse.move(5,5);
}
async function hoverText(page:Page,text:string){await page.locator('#editor .cm-line').filter({hasText:text}).last().hover();await expect(trigger(page)).toBeVisible();}

test('Hover follows B while caret stays in A, menu pins B across C and Escape preserves selection',async({page})=>{
 const source='Alpha caret\n\n## Bravo target\n\nCharlie next';await open(page,source);
 await expect(trigger(page)).toBeHidden();await hoverText(page,'Bravo target');await expect(trigger(page).locator('svg')).toHaveAttribute('data-icon','heading-2');
 expect(await page.evaluate(()=>(window as any).host.editor.view.state.selection.main.anchor)).toBe(1);
 const bodyBefore=await page.locator('.cm-content').boundingBox();const button=await trigger(page).boundingBox();
 await page.mouse.move(button!.x+button!.width+5,button!.y+button!.height/2);await expect(trigger(page)).toBeVisible();
 await trigger(page).click();await hoverText(page,'Charlie next');await expect(trigger(page).locator('svg')).toHaveAttribute('data-icon','heading-2');
 await page.keyboard.press('Escape');await expect(menu(page)).toBeHidden();expect(await sourceOf(page)).toBe(source);
 expect(await page.evaluate(()=>(window as any).host.editor.view.state.selection.main.anchor)).toBe(1);
 expect((await page.locator('.cm-content').boundingBox())!.x).toBe(bodyBefore!.x);
 await hoverText(page,'Bravo target');await trigger(page).click();await menu(page).getByRole('option',{name:'Heading 3',exact:true}).click();
 expect(await sourceOf(page)).toBe(source.replace('## Bravo','### Bravo'));
 await page.keyboard.press('ControlOrMeta+Z');expect(await sourceOf(page)).toBe(source);
 await page.keyboard.press('ControlOrMeta+Shift+Z');expect(await sourceOf(page)).toBe(source.replace('## Bravo','### Bravo'));
});

test('wrapped paragraphs stay anchored on first line with a real content gap',async({page})=>{
 await page.setViewportSize({width:720,height:700});const source='Alpha\n\n'+('多行段落与 **强调文字**、[链接](a.md) 和 $x$ 一起呈现，保持同一个入口。'.repeat(7));await open(page,source);
 const line=page.locator('.cm-line').filter({hasText:'多行段落'});const rect=await line.boundingBox();
 await page.mouse.move(rect!.x+rect!.width/2,rect!.y+rect!.height-8);await expect(trigger(page)).toBeVisible();await expect(trigger(page).locator('svg')).toHaveAttribute('data-icon','type');
 const button=await trigger(page).boundingBox(),after=await line.boundingBox();expect(after!.x).toBe(rect!.x);expect(after!.width).toBe(rect!.width);expect(button!.y).toBeLessThan(rect!.y+40);expect(rect!.x-button!.x-button!.width).toBeGreaterThanOrEqual(8);
 await trigger(page).click();await menu(page).getByRole('option',{name:'Heading 2',exact:true}).click();expect(await sourceOf(page)).toContain('## 多行段落');
 await page.keyboard.press('ControlOrMeta+Z');expect(await sourceOf(page)).toBe(source);
});

test('nested task continuation and quoted heading preserve independent container styles',async({page})=>{
 const source='Alpha\n\n> - ## **quoted title**\n> - sibling\n\n- outer\n  - [x] inner\n    continuation\n- next';await open(page,source);
 await hoverText(page,'quoted title');await expect(trigger(page).locator('svg')).toHaveAttribute('data-icon','heading-2');await expect(trigger(page)).toHaveAttribute('aria-label',/Heading 2.*Bullet list.*Quote/);
 await trigger(page).click();await menu(page).getByRole('option',{name:'Paragraph',exact:true}).click();
 expect(await sourceOf(page)).toBe(source.replace('## **quoted title**','**quoted title**'));
 await page.keyboard.press('ControlOrMeta+Z');expect(await sourceOf(page)).toBe(source);
 await hoverText(page,'continuation');await expect(trigger(page)).toHaveAttribute('data-block-type','task');
 await expect.poll(async()=>{const b=await trigger(page).boundingBox(),first=await page.locator('.cm-line').filter({hasText:'inner'}).boundingBox();return Math.abs(b!.y-first!.y);}).toBeLessThan(30);
 await trigger(page).click();await menu(page).getByRole('option',{name:'Heading 3',exact:true}).click();
 expect(await sourceOf(page)).toContain('  - [x] ### inner continuation\n- next');
});

test('table and Mermaid have object menus without paragraph conversions and keep Cancel source-safe',async({page})=>{
 const source='Alpha\n\n| Name | State |\n| --- | --- |\n| Task | Ready |\n\n```mermaid\nflowchart LR\nA --> B\n```\n\nEnd';await open(page,source);
 await page.locator('.cm-live-table').hover();await expect(trigger(page)).toHaveAttribute('data-block-type','table');await trigger(page).click();
 await expect(menu(page).getByRole('option',{name:'Heading 1',exact:true})).toHaveCount(0);await expect(menu(page).getByRole('option',{name:'Edit object',exact:true})).toBeVisible();
 await menu(page).getByRole('option',{name:'Edit object',exact:true}).click();
 await expect(page.locator('.tegg-editing-panel')).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await sourceOf(page)).toBe(source);
 await page.locator('.cm-preview-widget').hover();await expect(trigger(page)).toHaveAttribute('data-block-type','mermaid');
 await expect.poll(async()=>{const obj=await page.locator('.cm-preview-widget').boundingBox(),b=await trigger(page).boundingBox();return Math.abs(b!.y-obj!.y);}).toBeLessThan(35);
 await trigger(page).click();await menu(page).getByRole('option',{name:'Edit object',exact:true}).click();
 await expect(page.locator('.tegg-editing-panel')).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await sourceOf(page)).toBe(source);
});

test('hovering code never moves the caret or treats an inner code line as Markdown',async({page})=>{
 const source='Alpha\n\n```ts\nconst x=1\n// next\n```\n\nEnd';await open(page,source);await page.locator('.cm-live-code-block').hover();
 await expect(trigger(page)).toHaveAttribute('data-block-type','code');expect(await page.evaluate(()=>(window as any).host.editor.view.state.selection.main.anchor)).toBe(1);
 await trigger(page).click();await menu(page).getByRole('option',{name:'Edit object',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Code content',exact:true})).toBeFocused();expect(await sourceOf(page)).toBe(source);
});

test('mouse leave hides, keyboard access remains explicit and read-only has no mutation controls',async({page})=>{
 await open(page,'Alpha\n\nBravo');await hoverText(page,'Bravo');await page.mouse.move(5,5);await expect(trigger(page)).toBeHidden();
 await page.keyboard.press('Alt+Shift+KeyB');await expect(trigger(page)).toBeFocused();await page.keyboard.press('Enter');await expect(menu(page)).toBeVisible();
 await page.keyboard.press('Escape');await page.evaluate(()=>(window as any).host.load('Read only',{contentState:'streaming'}));await expect(trigger(page)).toBeHidden();
});

for(const width of [390,760,1200])test(`stable lane and fixed control size at ${width}px and text scales`,async({page},info)=>{
 await page.setViewportSize({width,height:820});
 await open(page,'# 标题层级\n\n正文段落，混合 **加粗**、[链接](a.md) 与 $x$。\n\n> 引用中的一段说明。\n\n- [x] 列表任务');
 for(const scale of [.8,1,1.8]){
  await page.evaluate(scale=>(window as any).host.editor.setAppearance({fontScale:scale}),scale);
  await hoverText(page,'正文段落');const b=await trigger(page).boundingBox(),line=await page.locator('.cm-line').filter({hasText:'正文段落'}).boundingBox();
  expect(b!.width).toBe(28);expect(b!.x).toBeGreaterThanOrEqual(0);expect(line!.x-b!.x-b!.width).toBeGreaterThanOrEqual(8);
  await trigger(page).click();const m=await menu(page).boundingBox();expect(m!.x).toBeGreaterThanOrEqual(0);expect(m!.x+m!.width).toBeLessThanOrEqual(width);
  await page.keyboard.press('Escape');
 }
 await page.evaluate(()=>(window as any).host.editor.setAppearance({fontScale:1}));await hoverText(page,'正文段落');
 await page.screenshot({path:info.outputPath('hover.png')});
});

test('blank-line plus, composition, selection and document replacement keep safe targets',async({page})=>{
 await open(page,'Alpha\n\n');await page.evaluate(()=>{const e=(window as any).host.editor;e.view.dispatch({selection:{anchor:e.source.length}});e.view.focus();});
 await page.keyboard.press('Alt+Shift+KeyB');await page.locator('.tegg-command-plus').click();await menu(page).getByRole('option',{name:'Heading 2',exact:true}).click();
 expect(await sourceOf(page)).toBe('Alpha\n\n## ');await page.keyboard.press('ControlOrMeta+Z');expect(await sourceOf(page)).toBe('Alpha\n\n');
 await page.evaluate(()=>(window as any).host.load('Alpha\n\nBravo'));await hoverText(page,'Bravo');
 await page.locator('.cm-content').dispatchEvent('compositionstart');await expect(trigger(page)).toBeHidden();await expect(menu(page)).toBeHidden();
 await page.locator('.cm-content').dispatchEvent('compositionend');
 await hoverText(page,'Bravo');await trigger(page).click();await page.evaluate(()=>(window as any).host.switchDocument('Replacement'));
 await expect(menu(page)).toBeHidden();expect(await sourceOf(page)).toBe('Replacement');
});

for(const colorScheme of ['light','dark'] as const)test(`block controls distinguish Hover, expanded, current and keyboard states in ${colorScheme}`,async({page},info)=>{
 await page.emulateMedia({colorScheme});await page.setViewportSize({width:760,height:900});
 await open(page,'Alpha caret\n\n## Bravo heading\n\nCharlie next');await hoverText(page,'Bravo heading');
 const style=()=>trigger(page).evaluate(el=>{const s=getComputedStyle(el);return {border:s.borderTopWidth,outline:s.outlineStyle,shadow:s.boxShadow,background:s.backgroundColor,width:s.width};});
 expect(await style()).toMatchObject({border:'0px',outline:'none',shadow:'none',background:'rgba(0, 0, 0, 0)',width:'28px'});
 await expect(trigger(page).locator('svg')).toHaveAttribute('viewBox','0 0 24 24');
 await expect(trigger(page).locator('svg')).toHaveAttribute('data-icon','heading-2');
 await trigger(page).hover();const hover=await style();expect(hover).toMatchObject({border:'0px',outline:'none',shadow:'none'});expect(hover.background).not.toBe('rgba(0, 0, 0, 0)');
 await trigger(page).click();const expanded=await style();expect(expanded.background).not.toBe(hover.background);expect(expanded.outline).toBe('none');
 await expect(menu(page)).toHaveAttribute('data-keyboard','false');
 const current=menu(page).getByRole('option',{name:'Heading 2',exact:true});await expect(current).toHaveAttribute('aria-current','true');
 const currentBackground=await current.evaluate(el=>getComputedStyle(el).backgroundColor);
 const candidate=menu(page).getByRole('option',{name:'Heading 3',exact:true});await candidate.hover();
 expect(await candidate.evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe(await current.evaluate(el=>getComputedStyle(el).backgroundColor));
 await expect(candidate).toHaveAttribute('aria-selected','true');await expect(current).toHaveAttribute('aria-current','true');
 await page.keyboard.press('ArrowDown');await expect(menu(page)).toHaveAttribute('data-keyboard','true');
 const active=menu(page).locator('[aria-selected="true"]');expect(await active.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
 await page.mouse.move(5,5);await candidate.hover();await expect(menu(page)).toHaveAttribute('data-keyboard','false');expect(await candidate.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('none');
 const geometry=await menu(page).evaluate(el=>{const s=getComputedStyle(el),o=el.querySelector('.tegg-command-option')!,i=o.querySelector('.tegg-command-option-icon')!;return {width:el.getBoundingClientRect().width,radius:s.borderRadius,padding:s.paddingTop,row:o.getBoundingClientRect().height,gap:getComputedStyle(o).columnGap,icon:i.getBoundingClientRect().width,glyph:i.querySelector('svg')!.getBoundingClientRect().width};});
 expect(geometry).toEqual({width:242,radius:'10px',padding:'6px',row:34,gap:'10px',icon:20,glyph:18});
 await page.screenshot({path:info.outputPath(`block-menu-${colorScheme}.png`)});
 await page.keyboard.press('Escape');await page.keyboard.press('Alt+Shift+KeyB');await expect(trigger(page)).toBeFocused();expect((await style()).outline).toBe('solid');
 await page.keyboard.press('Enter');await expect(menu(page)).toBeVisible();
 expect(await menu(page).getByRole('option',{name:'Paragraph',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(currentBackground);
 await page.keyboard.press('Escape');
 expect(await sourceOf(page)).toBe('Alpha caret\n\n## Bravo heading\n\nCharlie next');
});


test('quoted heading movement discloses the container scope and preserves undo',async({page})=>{
 const source='Before\n\n> ## Quote title\n> Body inside\n\nAfter';await open(page,source);
 await hoverText(page,'Quote title');await trigger(page).click();
 await expect(menu(page).getByRole('option',{name:'Move down',exact:true})).toHaveCount(0);
 await menu(page).getByRole('option',{name:'Move entire quote down',exact:true}).click();
 expect(await sourceOf(page)).toBe('Before\n\nAfter\n\n> ## Quote title\n> Body inside');
 await page.keyboard.press('ControlOrMeta+Z');expect(await sourceOf(page)).toBe(source);
 await page.keyboard.press('ControlOrMeta+Shift+Z');expect(await sourceOf(page)).toBe('Before\n\nAfter\n\n> ## Quote title\n> Body inside');
});


test('quoted list movement carries quote markers and nested children on complete lines',async({page})=>{
 const source='> - ## First item\n>   - child\n> - Second item\n\nOutside';await open(page,source);
 await hoverText(page,'First item');await trigger(page).click();
 await menu(page).getByRole('option',{name:'Move list item down',exact:true}).click();
 expect(await sourceOf(page)).toBe('> - Second item\n> - ## First item\n>   - child\n\nOutside');
 await page.keyboard.press('ControlOrMeta+Z');expect(await sourceOf(page)).toBe(source);
});
