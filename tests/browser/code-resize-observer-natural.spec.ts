import {test,expect} from '@playwright/test';

test('native code-area ResizeObserver survives initial layout and width changes without pageerror or source mutation',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(String(error)));
  const raw='before\n\n```text\n'+('long literal '.repeat(120))+'\nsecond\n```\n\nafter';
  await page.goto('http://127.0.0.1:18930/reliable.html');
  await page.evaluate(raw=>(window as any).host.load(raw),raw);
  const input=page.locator('.md-code-area textarea');await expect(input).toHaveValue(('long literal '.repeat(120))+'\nsecond');
  const snapshot=()=>page.evaluate(()=>{const e=(window as any).host.editor;return{source:e.source,selection:{anchor:e.view.state.selection.main.anchor,head:e.view.state.selection.main.head},sequence:e.snapshot().sequence,canUndo:e.state.canUndo,canRedo:e.state.canRedo};});
  const before=await snapshot();expect(before.source).toBe(raw);expect(before.sequence).toBe(0);expect(before.canUndo).toBe(false);expect(before.canRedo).toBe(false);
  await page.evaluate(()=>{
    const area=document.querySelector('.md-code-area')!,widths:number[]=[];
    const observer=new ResizeObserver(entries=>{for(const entry of entries)widths.push(entry.contentRect.width);});observer.observe(area);
    (window as any).codeResizeRegression={widths,observer};
  });
  for(const width of [580,564,620,564]){
    await page.locator('#editor').evaluate((element,width)=>{(element as HTMLElement).style.width=width+'px';},width);
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))));
    await expect.poll(()=>input.evaluate(node=>node.getBoundingClientRect().height),{timeout:5000}).toBeGreaterThan(0);
    expect(await snapshot()).toEqual(before);
  }
  const widths=await page.evaluate(()=>(window as any).codeResizeRegression.widths as number[]);expect(new Set(widths.map(width=>Math.round(width))).size).toBeGreaterThan(1);
  const wrap=page.getByRole('button',{name:'Wrap lines',exact:true});await wrap.click();await expect(input).toHaveAttribute('wrap','soft');await expect(wrap).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>input.evaluate(node=>node.getBoundingClientRect().height),{timeout:5000}).toBeGreaterThan(0);expect(await snapshot()).toEqual(before);
  await wrap.click();await expect(input).toHaveAttribute('wrap','off');expect(await snapshot()).toEqual(before);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))));
  await page.evaluate(()=>(window as any).codeResizeRegression.observer.disconnect());
  await testInfo.attach('actual-native-code-resize',{body:JSON.stringify({widths,errors,sourceSnapshot:await snapshot()}),contentType:'application/json'});
  expect(errors).toEqual([]);
});
