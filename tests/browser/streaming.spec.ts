import {test,expect} from "@playwright/test";
for(const rate of [20,50]) test(`streaming ${rate} updates per second preserves visible position`,async({page},info)=>{
 test.setTimeout(45000); await page.goto("/");
 const result=await page.evaluate(async rate=>{
  const host=(window as any).host; const base=Array.from({length:180},(_,i)=>`Paragraph ${i}: reliable source snapshots preserve existing document content.\n\n`).join("");
  document.querySelector("main")!.style.height="500px";
  await host.render(base); const scroll=document.querySelector<HTMLElement>(".tegg-sdk-content")!;scroll.scrollTop=450;
  const anchor=Array.from(scroll.querySelectorAll("p")).find(p=>p.getBoundingClientRect().top>=scroll.getBoundingClientRect().top)!;
  const top=anchor.getBoundingClientRect().top; let updates=0; const pending:Promise<void>[]=[]; const longTasks:number[]=[];
  const observer=typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("longtask") ? new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(item=>item.duration))) : null;observer?.observe({type:"longtask"});
  await new Promise<void>(resolve=>{const interval=setInterval(()=>{pending.push(host.render(base+`Tail ${++updates}`,{contentState:"streaming"}));},1000/rate);setTimeout(()=>{clearInterval(interval);resolve();},30000);});
  await host.render(base+"Final tail",{contentState:"settled"});await Promise.all(pending);observer?.disconnect();
  return {rate,updates,retained:scroll.contains(anchor),drift:Math.abs(anchor.getBoundingClientRect().top-top),final:scroll.textContent?.endsWith("Final tail\n"),scrollTop:scroll.scrollTop,longTasks};
 },rate);
 await info.attach("stream-results",{body:JSON.stringify(result,null,2),contentType:"application/json"});
 expect(result.retained).toBe(true);expect(result.final).toBe(true);expect(result.drift).toBeLessThanOrEqual(2);expect(result.scrollTop).toBeGreaterThan(0);
});
