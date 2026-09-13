import {test,expect} from '@playwright/test';
test('optional local engines and geometry under explicit CSP',async({page},info)=>{
 const external:string[]=[];page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:18919/'))external.push(r.url());});
 await page.addInitScript(()=>{(window as any).violations=[];document.addEventListener('securitypolicyviolation',event=>(window as any).violations.push({directive:event.violatedDirective,blocked:event.blockedURI}));});
 await page.goto('http://127.0.0.1:18919/full.html?csp=engines');await page.evaluate(()=>(window as any).full.ready);
 await expect(page.locator('.katex')).toHaveCount(1);await expect(page.locator('.diagram-canvas[data-render-state="ready"]')).toHaveCount(2);await expect(page.locator('.diagram-canvas > svg')).toHaveCount(2);
 await expect(page.locator('[data-tegg-slot="code"] svg')).toHaveCount(3);
 expect(await page.evaluate(()=>(window as any).full.errors)).toEqual([]);expect(external).toEqual([]);expect(await page.evaluate(()=>(window as any).violations)).toEqual([]);
 const first=page.locator('[data-tegg-slot="code"]').first();const before=await first.locator('svg g').getAttribute('transform');await first.getByRole('button',{name:'Zoom in',exact:true}).click();expect(await first.locator('svg g').getAttribute('transform')).not.toBe(before);
 await page.getByRole('button',{name:'View diagram',exact:true}).first().click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await info.attach("engine-preview",{body:await page.screenshot({fullPage:true}),contentType:"image/png"});
 await page.evaluate(()=>(window as any).full.reader.destroy());await expect(page.locator('.tegg-sdk-frame')).toHaveCount(0);
});
