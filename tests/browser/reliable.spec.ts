import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const url='http://127.0.0.1:18930/reliable.html';
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQSlv1HwAEEgIyVuBIjQAAAABJRU5ErkJggg==','base64');
async function load(page:Page,source:string){await page.goto(url);await page.evaluate(source=>(window as any).host.load(source),source);}
async function source(page:Page){return await page.evaluate(()=>(window as any).host.editor.source);}
async function file(page:Page,name='test.png'){
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Attach file',exact:true}).click();await (await chooser).setFiles({name,mimeType:'image/png',buffer:pixel});
}
test('Reliable package object UI cancels, applies and undoes a local link edit',async({page})=>{
  const original='[old](old.md)\n\nAfter';await load(page,original);await page.evaluate(()=>(window as any).host.select('old'));
  await page.getByRole('button',{name:'Link',exact:true}).click();await page.getByLabel('Text',{exact:true}).fill('new');await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await source(page)).toBe(original);
  await page.getByRole('button',{name:'Link',exact:true}).click();await page.getByLabel('Text',{exact:true}).fill('new');await page.getByLabel('Target',{exact:true}).fill('next.md');await page.getByRole('button',{name:'Apply',exact:true}).click();expect(await source(page)).toContain('[new](<next.md>)');
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await source(page)).toBe(original);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await source(page)).toContain('next.md');
});
test('Reliable package preserves a controller target across unrelated input and rejects its replacement',async({page})=>{
  await load(page,'prefix\n\n[old](old.md)\n\nend');
  const result=await page.evaluate(()=>{const {editor}=(window as any).host;(window as any).host.select('old');const session=editor.editing.begin('link');editor.editing.updateDraft(session.token,'[changed](new.md)');editor.view.dispatch({changes:{from:0,insert:'outside\n'}});const applied=editor.editing.commit(session.token);editor.editing.command('undo');(window as any).host.select('old');const stale=editor.editing.begin('link');editor.editing.updateDraft(stale.token,'retained draft');editor.view.dispatch({changes:{from:stale.from+1,to:stale.from+4,insert:'external'}});return {applied,rejected:editor.editing.commit(stale.token),draft:editor.editing.session.draft,source:editor.source};});
  expect(result.applied.ok).toBe(true);expect(result.rejected.ok).toBe(false);expect(result.draft).toBe('retained draft');expect(result.source).toContain('outside\n');expect(result.source).toContain('external');
});
test('Reliable package reviews complex clipboard HTML and supports cancel or converted paste',async({page})=>{
  const original='Existing\n\n';await load(page,original);
  // Firefox strips supplied data from untrusted ClipboardEvent initialization; retain the captured event DTO explicitly.
  const paste=()=>page.locator('.cm-content').evaluate(element=>{const data=new DataTransfer();data.setData('text/plain','first second');data.setData('text/html','<table><tr><th colspan="2">Combined</th></tr><tr><td>first</td><td>second</td></tr></table>');const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:data});element.dispatchEvent(event);});
  await paste();await expect(page.getByRole('dialog',{name:'Review paste'})).toBeVisible();expect(await source(page)).toBe(original);await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await source(page)).toBe(original);
  await paste();await page.getByRole('button',{name:'Insert converted Markdown',exact:true}).click();await expect.poll(()=>source(page)).toContain('| Combined |');expect(await source(page)).toContain('second');await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await source(page)).toBe(original);
});
test('Reliable package stores a real selected image, reloads its durable URL and retries HTTP failure',async({page})=>{
  await load(page,'Photo\n\n');await page.evaluate(()=>(window as any).host.setStorage('fail-once'));await file(page,'retry.png');
  await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();expect(await source(page)).toBe('Photo\n\n');await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect.poll(()=>source(page)).toContain('attachments/');const saved=await source(page);expect(saved).not.toContain('blob:');expect(saved).not.toContain('data:');
  const disk=await page.evaluate(async()=>({files:await (window as any).host.resourceFiles(),resources:(window as any).host.resources}));const last=disk.resources.at(-1);expect(disk.files.find((entry:any)=>'attachments/'+entry.name===last.reference).size).toBe(pixel.length);
  await page.evaluate(value=>(window as any).host.load(value),saved);await expect(page.locator('.cm-live-image img')).toHaveJSProperty('complete',true);await expect(page.locator('.cm-live-image img')).toHaveJSProperty('naturalWidth',1);
});
test('Reliable package ignores completed uploads after cancel and document switch',async({page})=>{
  await load(page,'First\n\n');await page.evaluate(()=>(window as any).host.setStorage('deferred'));await file(page,'late-cancel.png');await expect.poll(()=>page.evaluate(()=>(window as any).host.storage.calls)).toBe(1);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).host.resources.length)).toBeGreaterThan(0);expect(await source(page)).toBe('First\n\n');await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(()=>(window as any).host.setStorage('deferred'));await file(page,'late-switch.png');await expect.poll(()=>page.evaluate(()=>(window as any).host.storage.calls)).toBe(2);await page.evaluate(()=>(window as any).host.switchDocument('Second document'));
  await expect.poll(()=>page.evaluate(()=>(window as any).host.resources.length)).toBeGreaterThan(1);expect(await source(page)).toBe('Second document');
});
test('Reliable package search replacement and table rectangle are each one undo transaction',async({page})=>{
  await load(page,'cat cat\n\ndog');await page.getByRole('button',{name:'Find and replace',exact:true}).click();await page.getByLabel('Find',{exact:true}).fill('cat');await page.getByLabel('Replace with',{exact:true}).fill('fox');await page.getByRole('button',{name:'Replace all',exact:true}).click();expect(await source(page)).toBe('fox fox\n\ndog');await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await source(page)).toBe('cat cat\n\ndog');
  const table='| A | B |\n| --- | --- |\n| old | 2 |\n\nend';await page.evaluate(value=>(window as any).host.load(value),table);await page.getByRole('button',{name:'Edit table cell: old',exact:true}).click();const input=page.locator('.cm-live-table-cell input:not([hidden])');await input.evaluate(element=>{const data=new DataTransfer();data.setData('text/plain','x\ty');const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:data});element.dispatchEvent(event);});
  expect(await source(page)).toBe(table.replace('| old | 2 |','| x | y |'));await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await source(page)).toBe(table);
});
test('Reliable package accessible controls remain operable with 200% text on a narrow viewport',async({page})=>{
  await page.setViewportSize({width:375,height:900});await load(page,'# Title\n\n| A | B |\n| --- | --- |\n| old | 2 |\n\nend');await page.evaluate(()=>{document.documentElement.style.fontSize='32px';(window as any).host.editor.setAppearance({fontScale:2});});
  await page.getByRole('button',{name:'Edit table cell: old',exact:true}).click();await expect(page.getByRole('group',{name:'Current table cell'})).toBeVisible();await page.getByRole('group',{name:'Current table cell'}).getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Find and replace',exact:true}).click();await expect(page.getByRole('dialog',{name:'Find and replace'})).toBeVisible();const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(scan.violations).toEqual([]);
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
});
test('Reliable package destroys UI, sessions and editor across repeated mounted instances',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await load(page,'# lifecycle\n\ntext');await page.evaluate(()=>(window as any).host.cycles(30));await expect(page.locator('.tegg-sdk-frame,.tegg-editing-ui,.tegg-editing-panel')).toHaveCount(0);expect(errors).toEqual([]);
});

test('Reliable package stores clipboard images inside a table before committing the complete cell patch',async({page})=>{
  const original='| A | B |\n| --- | --- |\n| old | 2 |\n\nend';await load(page,original);
  await page.getByRole('button',{name:'Edit table cell: old',exact:true}).click();
  await page.locator('.cm-live-table-cell input:not([hidden])').evaluate((element,bytes)=>{
    const data=new DataTransfer();data.items.add(new File([new Uint8Array(bytes)],'table-image.png',{type:'image/png'}));data.setData('text/plain','photo');data.setData('text/html','<table><tr><td><img src="table-image.png" alt="table-image.png"></td></tr></table>');
    const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:data});element.dispatchEvent(event);
  },[...pixel]);
  await expect.poll(()=>source(page)).toContain('attachments/');const saved=await source(page);expect(saved).toContain('| ![table-image.png](');expect(saved).toContain('| 2 |\n\nend');expect(saved).not.toContain('tegg-resource');
  const refs=await page.evaluate(()=>(window as any).host.resources);expect(refs).toHaveLength(1);await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await source(page)).toBe(original);
});
test('Reliable package previews formula and diagram drafts and commits each as one reversible object edit',async({page})=>{
  const entries=[
    {button:'Formula',before:'$$\nx^2\n$$',after:'$$\nx^3 + y\n$$',preview:'.katex'},
    {button:'Mermaid',before:'```mermaid\nflowchart TD\n  A --> B\n```',after:'```mermaid\nflowchart TD\n  A --> C\n```',preview:'svg'},
    {button:'GraphViz',before:'```graphviz\ndigraph { a -> b }\n```',after:'```graphviz\ndigraph { a -> c }\n```',preview:'svg'},
  ];
  for(const entry of entries){
    const original=entry.before+'\n\nend';await load(page,original);await page.evaluate(()=>(window as any).host.editor.view.dispatch({selection:{anchor:2}}));
    await page.getByRole('button',{name:entry.button,exact:true}).click();await page.getByLabel('Object Markdown',{exact:true}).fill(entry.after);expect(await source(page)).toBe(original);
    await expect(page.locator('.tegg-object-preview '+entry.preview)).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await source(page)).toBe(original);
    await page.getByRole('button',{name:entry.button,exact:true}).click();await page.getByLabel('Object Markdown',{exact:true}).fill(entry.after);await page.getByRole('button',{name:'Apply',exact:true}).click();expect(await source(page)).toBe(entry.after+'\n\nend');
    await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await source(page)).toBe(original);
  }
});

test('Reliable package extensions prepare a local draft for explicit review, cancellation, apply and undo',async({page})=>{
  const original='[old](old.md)\n\nUnchanged paragraph';await load(page,original);await page.evaluate(()=>(window as any).host.select('old'));
  await page.getByRole('button',{name:'Prepare revised link',exact:true}).click();await expect(page.getByRole('dialog',{name:'Review extension draft'})).toBeVisible();
  await expect(page.getByLabel('Object Markdown',{exact:true})).toHaveValue('[reviewed](old.md)');expect(await source(page)).toBe(original);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await source(page)).toBe(original);
  await page.getByRole('button',{name:'Prepare revised link',exact:true}).click();await expect(page.getByRole('button',{name:'Apply',exact:true})).toBeEnabled();
  await page.getByLabel('Object Markdown',{exact:true}).fill('[approved](approved.md)');expect(await source(page)).toBe(original);await page.getByRole('button',{name:'Apply',exact:true}).click();
  expect(await source(page)).toBe('[approved](approved.md)\n\nUnchanged paragraph');await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await source(page)).toBe(original);
});
