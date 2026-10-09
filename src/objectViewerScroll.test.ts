import {describe,it,expect} from "vitest";
import {restoreViewerAnchor} from "./objectViewerScroll";
function fixture(quantize:(value:number)=>number) {
 let x=100,y=150;const offset={x:0,y:0};
 const stage={clientWidth:400,clientHeight:300,scrollWidth:2000,scrollHeight:2000,
  get scrollLeft(){return x},set scrollLeft(v:number){x=Math.max(0,Math.min(1600,quantize(v)))},
  get scrollTop(){return y},set scrollTop(v:number){y=Math.max(0,Math.min(1700,quantize(v)))}};
 const graphic={style:{translate:""},getBoundingClientRect:()=>({left:20-x+offset.x,top:40-y+offset.y})};
 const restore=(point:{x:number;y:number},scale:number,client={x:200,y:150})=>restoreViewerAnchor(stage as HTMLElement,graphic as unknown as HTMLElement,point,scale,client,offset);
 const center=(scale:number)=>({x:(200-graphic.getBoundingClientRect().left)/scale,y:(150-graphic.getBoundingClientRect().top)/scale});
 return {stage,graphic,offset,restore,center};
}
describe("viewer center with browser scroll quantization",()=>{
 for(const quantize of [Math.floor,Math.round,(v:number)=>v])it(`preserves both axes after repeated zoom with ${quantize.name||"fractional"} offsets`,()=>{
  const f=fixture(quantize),point=f.center(1);for(const scale of [1.25,1.5625,2,3.125,1.25,1]){f.restore(point,scale);expect(f.center(scale).x).toBeCloseTo(point.x,8);expect(f.center(scale).y).toBeCloseTo(point.y,8);}
 });
 it("does not translate a graphic past real scroll bounds",()=>{const f=fixture(Math.floor);f.restore({x:0,y:0},1);expect(f.stage.scrollLeft).toBe(0);expect(f.stage.scrollTop).toBe(0);expect(f.offset).toEqual({x:0,y:0});});
});
