import {test,expect} from "@playwright/test";
const url=process.env.TEGG_VIEWER_TEST_URL??"http://127.0.0.1:18930/reliable.html";
const original="![Authored alt](viewer-source.png)\n\nEnd";
for(const [width,layout] of [[390,"compact"],[1280,"wide"]] as const){
  test(`Reader hidden-to-shown width ${width} is projected immediately and viewer close preserves its first image box`,async({page})=>{
    const pageErrors:string[]=[];page.on("pageerror",error=>pageErrors.push(error.stack??error.message));
    await page.setViewportSize({width,height:720});await page.goto(url);
    const png=await page.evaluate(()=>{
      const make=(color:string,w:number,h:number)=>{const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;canvas.getContext("2d")!.fillStyle=color;canvas.getContext("2d")!.fillRect(0,0,w,h);return canvas.toDataURL("image/png");};
      const preview=make("#0000ff",160,80),full=make("#ff0000",320,160);
      (window as any).host.bindViewer({decodeAnimatedImage:async()=>{await new Promise(resolve=>setTimeout(resolve,80));return {status:"static",width:320,height:160,dataURL:full};}});
      return preview;
    });
    await page.route("**/viewer-source.png",route=>route.fulfill({status:200,contentType:"image/png",body:Buffer.from(png.split(",")[1],"base64")}));
    await page.evaluate(value=>(window as any).host.load(value),original);
    const transition=await page.evaluate(()=>{
      const editor=(window as any).host.editor,reader=document.querySelector<HTMLElement>(".tegg-reader")!;
      const read=()=>({hidden:reader.hidden,width:reader.clientWidth,layout:reader.dataset.layout,projected:reader.style.getPropertyValue("--md-canvas-width"),paddingTop:getComputedStyle(reader).paddingTop,scrollTop:reader.scrollTop,source:editor.source,selection:editor.view.state.selection.toJSON(),canUndo:editor.state.canUndo,canRedo:editor.state.canRedo});
      const hidden=read(),changed=editor.setMode("reader"),shown=read();return {hidden,changed,shown};
    });
    expect(transition.hidden.hidden).toBe(true);expect(transition.hidden.width).toBe(0);expect(transition.changed).toBe(true);
    expect(transition.shown.hidden).toBe(false);expect(transition.shown.width).toBe(width);expect(transition.shown.projected).toBe(`${width}px`);expect(transition.shown.layout).toBe(layout);
    expect(transition.shown.source).toBe(original);expect(transition.shown.selection).toEqual(transition.hidden.selection);
    expect([transition.shown.canUndo,transition.shown.canRedo]).toEqual([transition.hidden.canUndo,transition.hidden.canRedo]);
    const picture=page.locator(".tegg-reader img");
    // Resource decoding readiness is retained; there is no new layout wait or bbox polling.
    await expect.poll(()=>picture.evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBe(160);
    const before=await picture.boundingBox();
    const trigger=page.locator(".tegg-reader").getByRole("button",{name:"View image",exact:true});await trigger.focus();await trigger.press("Enter");
    const viewer=page.locator(".md-object-viewer");await expect(viewer).toHaveAttribute("data-natural-size","320x160");
    await viewer.getByRole("button",{name:"Close",exact:true}).click();await expect(trigger).toBeFocused();
    expect(await picture.boundingBox()).toEqual(before);
    const after=await page.evaluate(()=>{const editor=(window as any).host.editor,reader=document.querySelector<HTMLElement>(".tegg-reader")!;return {source:editor.source,selection:editor.view.state.selection.toJSON(),canUndo:editor.state.canUndo,canRedo:editor.state.canRedo,layout:reader.dataset.layout,projected:reader.style.getPropertyValue("--md-canvas-width"),paddingTop:getComputedStyle(reader).paddingTop,scrollTop:reader.scrollTop};});
    expect(after).toEqual({source:original,selection:transition.shown.selection,canUndo:transition.shown.canUndo,canRedo:transition.shown.canRedo,layout,projected:`${width}px`,paddingTop:transition.shown.paddingTop,scrollTop:transition.shown.scrollTop});
    expect(pageErrors).toEqual([]);
  });
}
