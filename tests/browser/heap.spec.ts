import {test,expect} from '@playwright/test';
// CDP heap collection is Chromium-specific; other engines run the lifecycle DOM tests.
test('destroyed Reader cycles release DOM and listeners after warmup',async({page},info)=>{
 await page.goto('/');const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.enable');
 await page.evaluate(async()=>{const host=(window as any).host;host.destroy();await host.cycles(20);});
 const samples=[];
 for(let batch=0;batch<5;batch++){
  if(batch)await page.evaluate(()=>(window as any).host.cycles(25));
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));await cdp.send('HeapProfiler.collectGarbage');
  samples.push({...await cdp.send('Memory.getDOMCounters'),...await cdp.send('Runtime.getHeapUsage')});
 }
 await info.attach('heap-cycles',{body:JSON.stringify(samples,null,2),contentType:'application/json'});
 expect(samples.at(-1)!.nodes).toBeLessThanOrEqual(samples[0].nodes+64);expect(samples.at(-1)!.jsEventListeners).toBeLessThanOrEqual(samples[0].jsEventListeners+8);
 expect(samples.at(-1)!.usedSize-samples[0].usedSize).toBeLessThan(1024*1024);
});
