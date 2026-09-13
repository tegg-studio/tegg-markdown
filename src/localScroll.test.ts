/** @vitest-environment jsdom */
import {describe,expect,it} from "vitest";
import {makeHorizontalScrollRegion} from "./localScroll";
describe("local scroll keyboard behavior",()=>{
 it("scrolls only an overflowing region and leaves text selection and inputs alone",()=>{
  const region=document.createElement("div"),input=document.createElement("input");region.append(input);
  Object.defineProperties(region,{scrollWidth:{value:900},clientWidth:{value:320}});
  makeHorizontalScrollRegion(region,"Table");
  const right=new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true,cancelable:true});region.dispatchEvent(right);
  expect(region.scrollLeft).toBe(40);expect(right.defaultPrevented).toBe(true);
  input.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));
  region.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",shiftKey:true,bubbles:true}));
  expect(region.scrollLeft).toBe(40);
 });
});
