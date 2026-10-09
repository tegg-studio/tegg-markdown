import {test,expect} from '@playwright/test';

test('Reader keeps text-adjacent images inline while centering actual image-only paragraphs',async({page})=>{
 await page.goto('http://127.0.0.1:18930/reliable.html');
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=16;c.height=16;c.getContext('2d')!.fillRect(0,0,16,16);return c.toDataURL('image/png');});
 await page.route('**/own-inline.png',r=>r.fulfill({contentType:'image/png',body:Buffer.from(png.split(',')[1],'base64')}));
 const source='Before ![Inline](own-inline.png) after\n\nBefore [![Inline link](own-inline.png)](https://example.com) after\n\n![Standalone](own-inline.png)\n\n[![Standalone link](own-inline.png)](https://example.com)\n\n![First](own-inline.png) ![Second](own-inline.png)';
 await page.evaluate(async source=>{const host=(window as any).host;host.load(source);if(!host.editor.setMode('reader'))throw Error('Reader rejected');},source);
 const images=page.locator('.tegg-reader img');await expect(images).toHaveCount(6);
 for(const alt of ['Inline','Inline link','First','Second']){
  const image=page.getByAltText(alt,{exact:true});await expect(image).toBeVisible();
  const metrics=await image.evaluate(image=>({display:getComputedStyle(image).display,width:image.getBoundingClientRect().width,paragraphAlign:getComputedStyle(image.closest('p')!).textAlign}));
  expect(metrics.display,alt).toBe('inline');expect(metrics.width,alt).toBe(16);expect(metrics.paragraphAlign,alt).not.toBe('center');
 }
 for(const alt of ['Standalone','Standalone link']){
  const image=page.getByAltText(alt,{exact:true});await expect(image).toBeVisible();
  const metrics=await image.evaluate(image=>{const parent=image.closest('p')!,at=image.getBoundingClientRect(),p=parent.getBoundingClientRect();return {display:getComputedStyle(image).display,width:at.width,center:Math.abs((at.left+at.right)-(p.left+p.right))};});
  expect(metrics.display,alt).toBe('block');expect(metrics.width,alt).toBe(16);expect(metrics.center,alt).toBeLessThan(1);
 }
 await page.evaluate(async source=>{const host=(window as any).host;host.load(source);if(!host.editor.setMode('reader'))throw Error('Reader rejected');},source);
 await expect(page.getByAltText('Inline',{exact:true})).toBeVisible();
 expect(await page.getByAltText('Inline',{exact:true}).evaluate(image=>getComputedStyle(image).display)).toBe('inline');
});
