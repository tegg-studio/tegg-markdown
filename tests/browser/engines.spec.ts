import {test,expect} from '@playwright/test';
test('optional local engines and geometry under explicit CSP',async({page},info)=>{
 const workers = new Set<object>(); let workerStarts=0;
 page.on('worker',worker=>{workerStarts++;workers.add(worker);worker.on('close',()=>workers.delete(worker));});
 const external:string[]=[];page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:18919/'))external.push(r.url());});
 await page.addInitScript(()=>{(window as any).violations=[];document.addEventListener('securitypolicyviolation',event=>(window as any).violations.push({directive:event.violatedDirective,blocked:event.blockedURI}));});
 await page.goto('http://127.0.0.1:18919/full.html?csp=engines');await page.evaluate(()=>(window as any).full.ready);
 await expect(page.locator('.katex')).toHaveCount(1);await expect(page.locator('.diagram-canvas[data-render-state="ready"]')).toHaveCount(2);await expect(page.locator('.diagram-canvas > svg')).toHaveCount(2);
 await expect(page.locator('[data-tegg-slot="code"] svg:not(button svg)')).toHaveCount(3);
 const node=page.locator('.diagram-canvas[data-engine="mermaid"] svg .node rect').first();
 await expect(node).toBeVisible();
 const colors=await node.evaluate(element=>({fill:getComputedStyle(element).fill,stroke:getComputedStyle(element).stroke}));
 expect(colors.fill).not.toBe('rgb(0, 0, 0)');expect(colors.stroke).not.toBe('none');
 await info.attach('mermaid-colors',{body:JSON.stringify(colors),contentType:'application/json'});

 expect(await page.evaluate(()=>(window as any).full.errors)).toEqual([]);expect(external).toEqual([]);expect(await page.evaluate(()=>(window as any).violations)).toEqual([]);
 const first=page.locator('[data-tegg-slot="code"]').first();const before=await first.locator('svg g').getAttribute('transform');await first.getByRole('button',{name:'Zoom in',exact:true}).click();expect(await first.locator('svg g').getAttribute('transform')).not.toBe(before);
 await page.locator('.diagram-canvas[data-engine="mermaid"]').hover();await page.getByRole('button',{name:'View diagram',exact:true}).first().click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await info.attach("engine-preview",{body:await page.screenshot({fullPage:true}),contentType:"image/png"});
 expect(workerStarts).toBeGreaterThan(0);
 await expect.poll(()=>workers.size,{timeout:15000}).toBe(0);
 await page.evaluate(async()=>{const full=(window as any).full;await full.reader.render({documentId:'engines',revision:'2',source:full.source.replace('a -> b','a -> c'),profile:'tegg'});});
 await expect(page.locator('.diagram-canvas[data-render-state="ready"]')).toHaveCount(2);
 expect(workerStarts).toBeGreaterThan(1);
 await page.evaluate(()=>(window as any).full.reader.destroy());await expect(page.locator('.tegg-sdk-frame')).toHaveCount(0);
});

test('formal diagram defaults enter layout while explicit author styles retain their values',async({page})=>{
 await page.goto('http://127.0.0.1:18919/full.html');await page.evaluate(()=>(window as any).full.ready);
 await page.addStyleTag({content:'.diagram-canvas{--md-decoration-scale:1.5;font-size:25px;font-family:Arial,sans-serif;color:rgb(40,50,60)}'});
 const source='```mermaid\nflowchart LR\n A[Body role] --> B[Second label]\n```\n\n```dot\ndigraph {a [label="Body role"]; b [label="Author label",fontsize=40,penwidth=4]; a -> b}\n```';
 await page.evaluate(async value=>{await (window as any).full.reader.render({documentId:'formal-diagrams',revision:'1',source:value,profile:'tegg'});},source);
 await expect(page.locator('.diagram-canvas[data-render-state="ready"]')).toHaveCount(2);
 const mermaid=page.locator('.diagram-canvas[data-engine="mermaid"]');
 const mermaidFont=await mermaid.locator('.node foreignObject').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize));expect(mermaidFont).toBeCloseTo(25,1);
 const mermaidWidths=await mermaid.evaluate(root=>({node:parseFloat(getComputedStyle(root.querySelector('.node rect')!).strokeWidth),edge:parseFloat(getComputedStyle(root.querySelector('.flowchart-link')!).strokeWidth)}));expect(mermaidWidths.node).toBeCloseTo(1.5,2);expect(mermaidWidths.edge).toBeCloseTo(2.25,2);
 const graph=page.locator('.diagram-canvas[data-engine="dot"]');const labels=await graph.locator('text').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent,size:Number(node.getAttribute('font-size'))})));expect(labels.find(item=>item.text==='Body role')?.size).toBeCloseTo(18.75,2);expect(labels.find(item=>item.text==='Author label')?.size).toBe(40);
 expect(await page.evaluate(()=>(window as any).full.errors)).toEqual([]);
});
