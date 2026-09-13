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
