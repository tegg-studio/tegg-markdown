import {test,expect} from '@playwright/test';
const url='http://127.0.0.1:18930';
const original='| A | B |\n| --- | --- |\n| [old](old.md) | untouched |\n\nEnd';
const source=(page:any)=>page.evaluate(()=>(window as any).host.editor.source);
async function begin(page:any,{mobile=false,portal=true,paneWidth=520,paneLeft=120}:any={}){
 await page.goto(url);await page.evaluate(({original,mobile,portal,paneWidth,paneLeft}:any)=>{
  const host=(window as any).host;host.load(original);
  if(portal){const overlay=document.createElement('aside');overlay.id='nested-link-overlay';Object.assign(overlay.style,{position:'fixed',left:paneLeft+'px',top:'900px',width:paneWidth+'px',height:'0px'});document.body.append(overlay);host.editor.setUI({mobile,overlayContainer:overlay});}
  else{const frame=host.editor.view.dom.closest('.tegg-sdk-frame');frame.style.width=paneWidth+'px';host.editor.setUI({mobile});}
 },{original,mobile,portal,paneWidth,paneLeft});
 const preview=page.getByRole('button',{name:'Edit table cell: [old](old.md)',exact:true});await expect(preview).toBeVisible();await preview.focus();await preview.press('F2');
 const content=page.locator('.md-table-inline-editor .cm-content');await expect(content).toBeVisible();await content.focus();await content.press('ControlOrMeta+A');
 await page.locator('.md-table-inline-editor').evaluate((node:any)=>{node.style.width='1px';node.style.maxWidth='1px';node.style.minWidth='0px';});
 expect(await page.locator('.md-table-inline-editor').evaluate((node:any)=>node.getBoundingClientRect().width)).toBeLessThanOrEqual(2);
 expect(await page.evaluate(()=>(window as any).host.editor.command('link'))).toBe(true);const dialog=page.locator('.md-link-editor');await expect(dialog).toBeVisible();return dialog;
}
async function reachable(dialog:any,width:number){
 const result=await dialog.evaluate((node:any)=>{const button=node.querySelector('.md-link-save'),r=button.getBoundingClientRect(),d=node.getBoundingClientRect();return {dialog:{x:d.x,right:d.right,width:d.width},button:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===button,overflow:getComputedStyle(node).overflowY};});
 expect(result.dialog.width).toBeGreaterThan(200);expect(result.dialog.x).toBeGreaterThanOrEqual(0);expect(result.dialog.right).toBeLessThanOrEqual(width);expect(result.button.x).toBeGreaterThanOrEqual(result.dialog.x);expect(result.button.right).toBeLessThanOrEqual(result.dialog.right);expect(result.hit).toBe(true);expect(result.overflow).toBe('hidden');
}
test('a narrow GFM child uses its Host pane, keeps its local draft and has an actually clickable Done',async({page})=>{
 await page.setViewportSize({width:900,height:760});const dialog=await begin(page);await expect.poll(()=>dialog.evaluate((node:any)=>node.getBoundingClientRect().width)).toBe(440);await reachable(dialog,900);
 await dialog.getByLabel('Link destination',{exact:true}).fill('nested.md');expect(await source(page)).toBe(original);await dialog.getByRole('button',{name:'Done',exact:true}).click();await expect(dialog).toHaveCount(0);expect(await source(page)).toBe(original);
 expect(await page.evaluate(()=>(window as any).host.editor.prepareLeave())).toBe(true);await expect.poll(()=>source(page)).toBe(original.replace('(old.md)','(<nested.md>)'));expect(await page.evaluate(()=>(window as any).host.editor.command('undo'))).toBe(true);expect(await source(page)).toBe(original);expect(await page.evaluate(()=>(window as any).host.editor.command('undo'))).toBe(false);
});
test('a nested dialog follows its actual allocated frame and remains reachable after Host width changes',async({page})=>{
 await page.setViewportSize({width:900,height:760});const dialog=await begin(page,{portal:false,paneWidth:360});await expect.poll(()=>dialog.evaluate((node:any)=>node.getBoundingClientRect().width)).toBe(328);await reachable(dialog,900);
 await page.evaluate(()=>(window as any).host.editor.view.dom.closest('.tegg-sdk-frame').style.width='300px');await expect.poll(()=>dialog.evaluate((node:any)=>node.getBoundingClientRect().width)).toBe(268);await reachable(dialog,900);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);expect(await source(page)).toBe(original);
});
test('mobile narrow and wide nested sheets retain their header actions and safe viewport bounds',async({page})=>{
 for(const width of [390,640]){await page.setViewportSize({width,height:760});const dialog=await begin(page,{mobile:true,paneLeft:20,paneWidth:width-40});await reachable(dialog,width);await expect(dialog.locator(':scope > header .md-link-save')).toBeVisible();await expect(dialog.locator('.md-link-editor-actions')).toHaveCount(0);await dialog.getByLabel('Link destination',{exact:true}).fill('discarded.md');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(await source(page)).toBe(original);}
});

test('a retained nested dialog follows an overlay gaining and losing its allocation without a viewport resize',async({page})=>{
 await page.setViewportSize({width:900,height:760});const dialog=await begin(page,{paneWidth:0,paneLeft:100});await expect.poll(()=>dialog.evaluate((node:any)=>node.getBoundingClientRect().width)).toBe(440);
 await page.evaluate(()=>document.querySelector<HTMLElement>('#nested-link-overlay')!.style.width='300px');await expect.poll(()=>dialog.evaluate((node:any)=>node.getBoundingClientRect().width)).toBe(268);await reachable(dialog,900);
 await dialog.getByLabel('Link destination',{exact:true}).fill('retained.md');expect(await source(page)).toBe(original);
 await page.evaluate(()=>document.querySelector<HTMLElement>('#nested-link-overlay')!.style.width='0px');await expect.poll(()=>dialog.evaluate((node:any)=>node.getBoundingClientRect().width)).toBe(440);await expect(dialog.getByLabel('Link destination',{exact:true})).toHaveValue('retained.md');await reachable(dialog,900);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(await source(page)).toBe(original);
});
const footnoteOriginal='Use[^n]\n\n[^n]: $x$\n\nEnd';
async function beginMath(page:any,kind:'footnote'|'cell'){
 const input=kind==='footnote'?footnoteOriginal:original.replace('[old](old.md)','$x$');await page.goto(url);await page.evaluate((input:string)=>{const host=(window as any).host;host.load(input);const overlay=document.createElement('aside');overlay.id='nested-math-overlay';Object.assign(overlay.style,{position:'fixed',left:'120px',top:'900px',width:'520px',height:'0px'});document.body.append(overlay);host.editor.setUI({mobile:false,overlayContainer:overlay});},input);
 if(kind==='cell'){const preview=page.getByRole('button',{name:'Edit table cell: $x$',exact:true});await preview.focus();await preview.press('F2');}
 const child=page.locator(kind==='cell'?'.md-table-inline-editor':'.footnote-body .cm-editor');await expect(child).toBeVisible();await child.evaluate((node:any)=>Object.assign(node.style,{width:'1px',maxWidth:'1px',minWidth:'0px'}));expect(await child.evaluate((node:any)=>node.getBoundingClientRect().width)).toBeLessThanOrEqual(2);
 const formula=child.locator('.cm-live-math-inline');await formula.focus();await formula.press('F2');const panel=page.locator('.tegg-editing-panel:not([hidden])');await expect(panel).toBeVisible();await expect.poll(()=>panel.evaluate((node:any)=>node.getBoundingClientRect().width)).toBe(488);
 const done=panel.getByRole('button',{name:'Done',exact:true});await expect.poll(()=>done.evaluate((node:any)=>{const r=node.getBoundingClientRect(),d=node.closest('.tegg-editing-panel').getBoundingClientRect();return r.x>=d.x&&r.right<=d.right&&d.right<=innerWidth&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===node;})).toBe(true);
 return {input,panel,done};
}
for(const kind of ['footnote','cell'] as const)test('a tiny '+kind+' Math editor uses its allocated modal and actually completes with one parent Undo',async({page})=>{
 await page.setViewportSize({width:900,height:760});const {input,panel,done}=await beginMath(page,kind);await panel.locator('.tegg-object-body').fill('y');expect(await source(page)).toBe(input);await expect(done).toBeEnabled();await done.click();await expect(panel).toBeHidden();
 if(kind==='cell'){expect(await source(page)).toBe(input);expect(await page.evaluate(()=>(window as any).host.editor.prepareLeave())).toBe(true);}
 await expect.poll(()=>source(page)).toBe(input.replace('$x$','$y$'));await page.evaluate(()=>(window as any).host.editor.view.focus());expect(await page.evaluate(()=>(window as any).host.editor.command('undo'))).toBe(true);expect(await source(page)).toBe(input);expect(await page.evaluate(()=>(window as any).host.editor.command('undo'))).toBe(false);
});
