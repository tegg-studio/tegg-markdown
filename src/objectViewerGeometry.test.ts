/** @vitest-environment jsdom */
import {describe,it,expect} from "vitest";
import {svgLength,svgViewerSize,decodedImageSize,viewerFit,viewerScale} from "./objectViewerGeometry";
function svg(attributes:Record<string,string>){const node=document.createElementNS("http://www.w3.org/2000/svg","svg");for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);return node;}
describe("trusted object viewer dimensions and bounds",()=>{
 it("uses SVG author coordinates despite scaled preview geometry",()=>{const node=svg({viewBox:"0 0 1200 2400",width:"100%"});Object.defineProperty(node,"getBoundingClientRect",{value:()=>({width:30,height:60})});expect(svgViewerSize(node)).toEqual({width:1200,height:2400,kind:"svg"});});
 it("honors absolute SVG sizes and derives the other side from the viewBox ratio",()=>{expect(svgViewerSize(svg({viewBox:"-10 -20 300 100",width:"2in"}))).toEqual({width:192,height:64,kind:"svg"});expect(svgViewerSize(svg({viewBox:"0 0 300 100",height:"72pt"}))).toEqual({width:288,height:96,kind:"svg"});});
 it("does not invent a natural size for percentages, malformed coordinates or empty diagrams",()=>{for(const attrs of <Record<string,string>[]>[{width:"100%",height:"100%"},{viewBox:"0 0 0 30"},{viewBox:"0 0 NaN 30"},{viewBox:"0 0 100"}])expect(svgViewerSize(svg(attrs))).toBeUndefined();});
 it("converts absolute CSS units without Retina or filename heuristics",()=>{expect(svgLength("25.4mm")).toBeCloseTo(96);expect(svgLength("6pc")).toBe(96);for(const value of ["0","-4","50%","2em","auto","Infinity"])expect(svgLength(value)).toBeUndefined();});
 it("uses only successfully decoded image dimensions, never author presentation size",()=>{const image=document.createElement("img");image.width=20;image.height=10;expect(decodedImageSize(image)).toBeUndefined();Object.defineProperties(image,{naturalWidth:{value:640},naturalHeight:{value:320}});expect(decodedImageSize(image)).toEqual({width:640,height:320,kind:"image"});});
 it("fits tall and wide media independently and never enlarges a small object",()=>{expect(viewerFit({width:100,height:2000},500,400)).toBe(.2);expect(viewerFit({width:2000,height:100},500,400)).toBe(.25);expect(viewerFit({width:50,height:30},500,400)).toBe(1);});
 it("permits a huge media fit below 25 percent but keeps every manual zoom within the approved bounds",()=>{expect(viewerScale(.001,.02)).toBe(.02);expect(viewerScale(.1,.8)).toBe(.25);expect(viewerScale(5,.02)).toBe(4);expect(viewerScale(1*1.25,.02)).toBe(1.25);expect(viewerScale(1/1.25,.02)).toBe(.8);});
});
