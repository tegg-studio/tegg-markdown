import {describe,it,expect} from "vitest";
import {imageSelectionClip} from "./imageSelectionAppearance";
const box=(left:number,top:number,width:number,height:number)=>({left,top,width,height,right:left+width,bottom:top+height});
describe("graphic selection paint",()=>{
 it("cuts only the selected image intersection from a continuing prose selection",()=>{expect(imageSelectionClip(box(10,20,300,200),[box(30,70,100,300)])).toBe('path(evenodd,"M0 0H300V200H0ZM20 50H120V200H20Z")');});
 it("keeps ordinary prose and nonintersecting images intact",()=>{expect(imageSelectionClip(box(0,0,300,20),[box(0,30,100,40)])).toBeUndefined();});
 it("handles clipped and multiple graphic holes without changing the outer selection geometry",()=>{expect(imageSelectionClip(box(100,100,200,200),[box(0,0,150,150),box(280,280,50,50)])).toBe('path(evenodd,"M0 0H200V200H0ZM0 0H50V50H0ZM180 180H200V200H180Z")');});
});
