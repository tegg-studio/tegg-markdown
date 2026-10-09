import {EditorView,ViewPlugin,type ViewUpdate} from "@codemirror/view";
type Box={left:number;top:number;right:number;bottom:number;width:number;height:number};
/** Preserve text selection painting while keeping selected graphic pixels unchanged. */
export function imageSelectionClip(marker:Box,images:readonly Box[]):string|undefined {
 if(marker.width<=0||marker.height<=0)return;
 const holes=images.map(image=>({left:Math.max(0,image.left-marker.left),top:Math.max(0,image.top-marker.top),right:Math.min(marker.width,image.right-marker.left),bottom:Math.min(marker.height,image.bottom-marker.top)})).filter(box=>box.right>box.left&&box.bottom>box.top);
 if(!holes.length)return;
 const number=(value:number)=>String(Math.round(value*1000)/1000);
 let path=`M0 0H${number(marker.width)}V${number(marker.height)}H0Z`;
 for(const box of holes)path+=`M${number(box.left)} ${number(box.top)}H${number(box.right)}V${number(box.bottom)}H${number(box.left)}Z`;
 return `path(evenodd,"${path}")`;
}
export const imageSelectionAppearance=ViewPlugin.fromClass(class {
 alive=true;observer:MutationObserver;clips=new WeakMap<HTMLElement,string>();
 constructor(readonly view:EditorView){const layoutStyle=(style:string)=>style.replace(/clip-path\s*:[^;]*(?:;|$)/g,"").trim();this.observer=new MutationObserver(records=>{if(records.some(record=>record.type==="childList"||record.type==="attributes"&&record.target instanceof HTMLElement&&record.target.classList.contains("cm-selectionBackground")&&layoutStyle(record.oldValue??"")!==layoutStyle(record.target.getAttribute("style")??"")))this.measure();});this.observer.observe(view.dom,{childList:true,subtree:true,attributes:true,attributeFilter:["style"],attributeOldValue:true});this.measure();}
 measure(){if(!this.alive)return;this.view.requestMeasure({key:this,read:()=>{
  const images=[...this.view.dom.querySelectorAll<HTMLImageElement>('.cm-live-image.cm-live-object-selected img,.cm-live-html-block.cm-live-object-selected img')].filter(image=>image.closest('.cm-editor')===this.view.dom&&!image.hidden).map(image=>image.getBoundingClientRect());
  return [...this.view.dom.querySelectorAll<HTMLElement>(':scope>.cm-scroller>.cm-selectionLayer>.cm-selectionBackground')].map(marker=>({marker,clip:imageSelectionClip(marker.getBoundingClientRect(),images)}));
 },write:items=>{if(!this.alive)return;for(const {marker,clip} of items){if(clip){if(marker.style.clipPath!==clip)marker.style.clipPath=clip;this.clips.set(marker,marker.style.clipPath);}else if(marker.style.clipPath===this.clips.get(marker)){marker.style.removeProperty('clip-path');this.clips.delete(marker);}}}});}
 update(update:ViewUpdate){if(update.selectionSet||update.docChanged||update.geometryChanged||update.viewportChanged)this.measure();}
 destroy(){this.alive=false;this.observer.disconnect();for(const marker of this.view.dom.querySelectorAll<HTMLElement>('.cm-selectionBackground'))if(marker.style.clipPath===this.clips.get(marker))marker.style.removeProperty('clip-path');}
});
