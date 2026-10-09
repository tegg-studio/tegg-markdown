import {test,expect} from '@playwright/test';
const url=process.env.TEGG_VIEWER_TEST_URL??'http://127.0.0.1:18930/reliable.html';
test('asynchronous image dimensions replace the loading label with the actual zoom in both modes and locales',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 for(const mode of ['reader','live'] as const){
  await page.setViewportSize({width:640,height:840});await page.goto(url);
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=640;c.height=280;c.getContext('2d')!.fillRect(0,0,640,280);return c.toDataURL('image/png');});
  await page.route('**/own-zoom-locale.png',r=>r.fulfill({contentType:'image/png',body:Buffer.from(png.split(',')[1],'base64')}));
  const raw='![Own local image](own-zoom-locale.png)\n\nOriginal **text**.';
  await page.evaluate(({mode,raw})=>{
   const host=(window as any).host;host.bindViewer({resolveImageMetadata:async()=>({status:'static',width:640,height:280}),decodeAnimatedImage:()=>new Promise(resolve=>{(window as any).finishOwnImageDimensions=resolve;})});
   host.load(raw);host.editor.setUI({locale:'zh-CN',mobile:true,overlayContainer:document.body});if(mode==='reader'&&!host.editor.setMode('reader'))throw Error('Reader rejected');
  },{mode,raw});
  const root=page.locator(mode==='reader'?'.tegg-reader':'.cm-content'),image=root.locator('img[src$="own-zoom-locale.png"]');
  await expect(image).toBeVisible();await expect(image).toHaveAttribute('data-image-original-size-state','ready');
  const entry=root.getByRole('button',{name:'查看图片',exact:true});await entry.focus();await entry.press('Enter');
  const viewer=page.locator('.md-object-viewer');await expect(viewer).toHaveAttribute('data-animation-state','checking');await expect(viewer.locator('output')).toHaveText('自然尺寸未知');
  await page.evaluate(()=>{(window as any).finishOwnImageDimensions({status:'static',width:640,height:280});});
  await expect(viewer).toHaveAttribute('data-natural-size','640x280');
  await viewer.getByRole('button',{name:'实际大小',exact:true}).click();await expect(viewer.locator('output')).toHaveText('100%');
  await viewer.getByRole('button',{name:'+',exact:true}).click();await expect(viewer.locator('output')).toHaveText('125%');await expect(viewer).toHaveAttribute('data-viewer-scale','1.25');
  await page.evaluate(()=>(window as any).host.editor.setUI({locale:'en-US',mobile:true,overlayContainer:document.body}));await expect(viewer.locator('output')).toHaveText('125%');
  await page.evaluate(()=>(window as any).host.editor.setUI({locale:'zh-CN',mobile:true,overlayContainer:document.body}));await expect(viewer.locator('output')).toHaveText('125%');
  await viewer.locator('header button').first().click();await expect(viewer).toHaveCount(0);expect(await page.evaluate(()=>(window as any).host.editor.source)).toBe(raw);
 }
 expect(errors).toEqual([]);
});
