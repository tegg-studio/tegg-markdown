/** @vitest-environment jsdom */
import {afterEach,beforeAll,expect,it,vi} from "vitest";
import {openObjectViewer,disposeInteractions} from "./renderInteraction";
import {bindObjectViewerHost,type ImageAnimationResult} from "./objectViewerHost";
import {bindUI} from "./uiContext";
beforeAll(()=>{
 vi.stubGlobal("ResizeObserver",class {observe(){}disconnect(){}});
 vi.stubGlobal("requestAnimationFrame",()=>1);
 vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue({drawImage(){},clearRect(){}} as unknown as CanvasRenderingContext2D);
});
afterEach(()=>{disposeInteractions(document.body);document.body.replaceChildren();});
it("keeps the actual image zoom percentage after asynchronous native metadata and locale refresh",async()=>{
 const root=document.createElement("article");document.body.append(root);
 const ui=bindUI(root,{locale:"zh-CN"});
 const trigger=document.createElement("button"),image=document.createElement("img");root.append(trigger,image);
 image.src="app-file:///own-fixture.png";
 Object.defineProperties(image,{naturalWidth:{value:640},naturalHeight:{value:280},complete:{value:true}});
 let finish!: (value:ImageAnimationResult)=>void;
 const off=bindObjectViewerHost(root,{decodeAnimatedImage:()=>new Promise(resolve=>{finish=resolve;})});
 try{
  openObjectViewer(trigger,image,"![Own](own-fixture.png)","Image");
  const dialog=root.querySelector<HTMLDialogElement>("dialog")!,stage=dialog.querySelector<HTMLElement>(".md-object-stage")!;
  Object.defineProperties(stage,{clientWidth:{value:700},clientHeight:{value:380}});
  const buttons=()=>[...dialog.querySelectorAll<HTMLButtonElement>("button")];
  const byKey=(key:string)=>buttons().find(b=>b.dataset.teggUiText===key || b.dataset.teggUiLabel===key)!;
  byKey("Fit").click();
  await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));
  expect(dialog.querySelector("output")?.textContent).toBe("自然尺寸未知");
  finish({status:"static",width:640,height:280});
  await vi.waitFor(()=>expect(dialog.dataset.naturalSize).toBe("640x280"));
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(byKey("Actual size").disabled).toBe(false);
  expect(dialog.querySelector("output")?.textContent).toBe("100%");
  byKey("+").click();await new Promise(resolve=>setTimeout(resolve,0));
  expect(dialog.dataset.viewerScale).toBe("1.25");
  expect(dialog.querySelector("output")?.textContent).toBe("125%");
  ui.update({locale:"en-US"});
  expect(dialog.querySelector("output")?.textContent).toBe("125%");
  ui.update({locale:"zh-CN"});
  expect(dialog.querySelector("output")?.textContent).toBe("125%");
  byKey("Close").click();
 }finally{off();ui.destroy();}
});
