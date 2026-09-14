import {test, expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("minimal package renders without optional engines or external requests", async ({page}) => {
  const external:string[]=[]; page.on("request",request=>{if(!request.url().startsWith("http://127.0.0.1:18914/"))external.push(request.url());});
  await page.goto("/"); await expect(page.getByRole("heading",{name:"Markdown host"})).toBeVisible();
  await expect(page.getByText("Powered by Tegg Markdown")).toHaveCount(1);
  await page.evaluate(()=> (window as any).host.render("![private](https://example.com/private.png)\n\n<script>alert(1)</script>"));
  await expect(page.locator("img[src], script:not([type=module])")).toHaveCount(0); expect(external).toEqual([]);
});
test("real CSP headers and accessible default controls", async ({page}) => {
  await page.addInitScript(()=>{(window as any).violations=[];document.addEventListener("securitypolicyviolation",event=>(window as any).violations.push(event.violatedDirective));});
  await page.goto("/minimal.html?csp=strict"); await expect(page.getByRole("heading")).toBeVisible();
  expect(await page.evaluate(()=>(window as any).violations)).toEqual([]);
  await page.goto("/minimal.html");
  const scan=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze(); expect(scan.violations).toEqual([]);
});
test("source snapshots and 100 lifecycle cycles", async ({page}) => {
  await page.goto("/");
  await page.evaluate(async()=>{const host=(window as any).host;for(let i=1;i<12;i++)await host.render("# Streaming\n\n[text][ref]".slice(0,i),{contentState:"streaming"});await host.render("# Streaming\n\n[text][ref]\n\n[ref]: https://example.com",{contentState:"settled"});});
  await expect(page.getByRole("link",{name:"text",exact:true})).toHaveAttribute("href","https://example.com");
  await page.evaluate(async()=>{const host=(window as any).host;host.destroy();await host.cycles(100);});
  await expect(page.locator(".tegg-sdk-frame")).toHaveCount(0);
});
for(const [version,port] of [[18,18915],[19,18916]]) {
 test(`React ${version} StrictMode and renderer Context`,async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${port}/react.html`);
  await expect(page.getByTestId("custom-code")).toContainText("context-preserved original code");
  await expect(page.getByText("Powered by Tegg Markdown")).toHaveCount(1);
  await page.evaluate(()=>(window as any).host.unmount()); await expect(page.locator(".tegg-sdk-frame")).toHaveCount(0); expect(errors).toEqual([]);
 });
 test(`React ${version} editor preserves drafts, save identity and undo`,async({page})=>{
  await page.goto(`http://127.0.0.1:${port}/react.html`);
  await page.evaluate(()=>(window as any).host.show("editor","original"));
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.locator(".cm-content").click();await page.keyboard.press("End"); await page.keyboard.insertText(" 中文");
  await expect.poll(()=>page.evaluate(()=>(window as any).host.instance.state.toolbarEnabled)).toBe(true);
  await page.locator(".cm-content").blur();
  const result=await page.evaluate(()=>{const host=(window as any).host,editor=host.instance;const saved=editor.snapshot();editor.setUI({locale:"en-US"});const conflict=editor.update({documentId:"doc",revision:"r2",source:"external"});const same=editor.source===saved.source;const accepted=editor.acknowledgeSaved(saved,"r2");editor.command("undo");return {conflict,same,accepted,source:editor.source,errors:host.errors};});
  expect(result).toMatchObject({conflict:"conflict",same:true,accepted:true,source:"original",errors:[]});
 });
}

test("eight independent instances keep language and attribution isolated",async({page})=>{
 await page.goto("/");await page.evaluate(()=>(window as any).host.instances(8));
 await expect(page.locator(".tegg-sdk-frame")).toHaveCount(8);await expect(page.getByRole("button",{name:"Copy",exact:true})).toHaveCount(4);await expect(page.getByRole("button",{name:"复制",exact:true})).toHaveCount(4);
 await expect(page.getByText("Powered by Tegg Markdown")).toHaveCount(8);await page.evaluate(()=>(window as any).host.destroy());await expect(page.locator(".tegg-sdk-frame")).toHaveCount(0);
});


test("Live Edit preserves unresolved references while rendering valid links",async({page})=>{
 await page.goto("http://127.0.0.1:18916/react.html");
 await page.evaluate(()=>(window as any).host.show("editor","[missing] and [*formatted*] and [valid][id]\n\n[id]: https://example.com\n\nend"));
 await expect(page.locator(".cm-content")).toContainText("[missing]");
 await page.evaluate(()=>(window as any).host.instance.setMode("live"));
 await expect(page.locator(".cm-content")).toContainText("[missing] and [formatted] and valid");
 await expect(page.locator(".cm-live-emphasis")).toHaveText("formatted");
 await expect(page.locator(".cm-live-link")).toHaveText("valid");
});

for(const port of [18915,18916]) test(`React ${port===18915?'18':'19'} editor preserves the constrained height chain and exposes profile-aware toolbar`,async({page})=>{
 await page.goto(`http://127.0.0.1:${port}/react.html`);
 await page.evaluate(()=> (window as any).host.show('editor',Array.from({length:200},(_,i)=>`Paragraph ${i}`).join('\n\n')));
 await expect(page.getByRole('button',{name:'bold',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'wikilink',exact:true})).toHaveCount(0);
 const viewport=page.locator('.tegg-sdk-editor');
 await expect.poll(()=>viewport.evaluate(el=>el.clientHeight)).toBeGreaterThan(0);
 const scroller=viewport.locator('.cm-scroller');
 const sizes=await scroller.evaluate(el=>({height:el.clientHeight,content:el.scrollHeight}));
 expect(sizes.height).toBeLessThan(420);expect(sizes.content).toBeGreaterThan(sizes.height);
 await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight});
 expect(await scroller.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
});

for(const port of [18915,18916]) test(`React ${port} Reader supports internal and natural height`,async({page})=>{
 await page.goto(`http://127.0.0.1:${port}/react.html`);
 await page.evaluate(()=> (window as any).host.show('reader',Array.from({length:80},(_,i)=>`Paragraph ${i}`).join('\n\n'),'internal'));
 const reader=page.locator('.tegg-reader');await expect(reader.getByText('Paragraph 79',{exact:true})).toBeAttached();
 expect(await reader.evaluate(el=>el.clientHeight)).toBeLessThan(420);
 await reader.evaluate(el=>{el.scrollTop=el.scrollHeight});expect(await reader.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 await page.evaluate(()=> (window as any).host.unmount());
 await page.reload();
 await page.evaluate(()=> (window as any).host.show('reader',Array.from({length:80},(_,i)=>`Paragraph ${i}`).join('\n\n'),'host'));
 await expect(reader.getByText('Paragraph 79',{exact:true})).toBeAttached();
 expect(await reader.evaluate(el=>el.clientHeight)).toBeGreaterThan(420);
});
