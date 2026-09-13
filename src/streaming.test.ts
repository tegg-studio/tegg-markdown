// @vitest-environment jsdom
import {describe,it,expect,vi} from "vitest";
import {TechnicalMarkdownReader} from "./reader";
import {sanitizeDiagramSvg} from "./renderKit";
import {allowedImageURL} from "./resources";
import {validateTopology, geometryRenderer, stlShapes} from "./engines/geometry";
describe("incremental ownership and safe fallbacks",()=>{
 it("prevents external SVG resources and CSS imports while retaining local paint servers",()=>{
  const fragment=sanitizeDiagramSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>@import "https://example.com/a.css";</style><image href="https://example.com/a.png"/><path fill="url(#paint)"/><g style="background: image-set(\"https://example.com/a.png\")"/></svg>');
  expect(fragment.querySelector("image")?.getAttribute("href")).toBeNull();expect(fragment.querySelector("style")).toBeNull();expect(fragment.querySelector("path")?.getAttribute("fill")).toBe("url(#paint)");
 });
 it("uses a complete source fallback at the document preview budget",async()=>{
  const root=document.createElement("div"), reader=new TechnicalMarkdownReader(root);const source="a".repeat(1024*1024);
  await reader.render({source});expect(root.querySelector("pre")?.textContent).toBe(source);expect(root.dataset.renderState).toBe("source-fallback");reader.destroy();
 });
 it("retains independent DOM and updates late reference definitions",async()=>{
  const root=document.createElement("div"), reader=new TechnicalMarkdownReader(root,{engines:{}});
  const source="# Heading\n\n```js\nconst value = 1\n```\n\n[reference][id]";
  await reader.render({documentId:"doc",source});const code=root.querySelector(".md-render-code");
  await reader.render({documentId:"doc",source:source+"\n\n[id]: https://example.com"});
  expect(root.querySelector(".md-render-code")).toBe(code); expect(root.querySelector('a[href="https://example.com"]')).not.toBeNull();reader.destroy();
 });
 it("coalesces streaming updates and settled always flushes",async()=>{
  const root=document.createElement("div"),reader=new TechnicalMarkdownReader(root,{engines:{}});
  const promises=Array.from({length:30},(_,i)=>reader.render({documentId:"doc",source:`draft ${i}`,contentState:"streaming"}));
  await reader.render({documentId:"doc",source:"final",contentState:"settled"}); await Promise.all(promises);
  expect(root.innerHTML).toContain(">final</p>");reader.destroy();
 });
 it("retains unchanged renderer state and disposes exactly once",async()=>{
  const root=document.createElement("div"),destroy=vi.fn(),mount=vi.fn((container:HTMLElement)=>{container.textContent="custom";return {destroy};});
  const reader=new TechnicalMarkdownReader(root,{renderers:{code:mount}});
  const source="```text\nretained\n```";
  await reader.render({documentId:"doc",revision:"1",source});const slot=root.querySelector("[data-tegg-slot]");
  await reader.render({documentId:"doc",revision:"2",source:source+"\n\nnew paragraph"});
  expect(mount).toHaveBeenCalledTimes(1);expect(destroy).not.toHaveBeenCalled();expect(root.querySelector("[data-tegg-slot]")).toBe(slot);
  reader.destroy();reader.destroy();expect(destroy).toHaveBeenCalledTimes(1);
 });
 it("rejects backslash network path aliases even with relative URLs allowed",()=>{
  for(const url of ["\\\\example.com/x","/\\example.com/x","https:\\example.com/x",""]) expect(allowedImageURL(url,{allowRelative:true})).toBeNull();
 });
 it("limits repeated TopoJSON arc expansion before conversion",()=>{
  expect(()=>validateTopology({type:"Topology",arcs:[Array.from({length:100},()=>[0,0])],objects:{large:{type:"MultiLineString",arcs:Array.from({length:201},()=>[0])}}})).toThrow("budget");
 });
 it("keeps polygon holes in one even-odd path",async()=>{
  const root=document.createElement("div");await geometryRenderer(root,{kind:"code",language:"geojson",text:JSON.stringify({type:"Polygon",coordinates:[[[0,0],[10,0],[10,10],[0,0]],[[2,2],[3,2],[3,3],[2,2]]]})},{documentId:"doc",revision:"1",signal:new AbortController().signal,renderDefault:()=>document.createElement("pre")});
  expect(root.querySelectorAll("svg path")).toHaveLength(1);expect(root.querySelector("path")?.getAttribute("fill-rule")).toBe("evenodd");
 });
 it("rejects malformed STL normals",()=>{expect(()=>stlShapes("solid a\nfacet normal garbage\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid a")).toThrow();});
});
