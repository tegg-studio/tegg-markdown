/** Viewer dimensions are decoded image pixels or authored SVG coordinates, never a scaled preview box. */
export type ViewerSize = {width:number;height:number;kind:"image"|"svg"|"formula"};
const positive=(value:number)=>Number.isFinite(value)&&value>0;
export function svgLength(value:string|null):number|undefined {
 const match=value?.trim().match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+))(px|in|cm|mm|pt|pc)?$/i);if(!match)return;
 const factors:Record<string,number>={px:1,in:96,cm:96/2.54,mm:96/25.4,pt:96/72,pc:16};const result=Number(match[1])*(factors[match[2]?.toLowerCase()??"px"]);return positive(result)?result:undefined;
}
export function svgViewerSize(svg:SVGElement):ViewerSize|undefined {
 const coordinates=svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);const box=coordinates?.length===4&&coordinates.every(Number.isFinite)&&positive(coordinates[2])&&positive(coordinates[3])?coordinates:undefined;
 let width=svgLength(svg.getAttribute("width")),height=svgLength(svg.getAttribute("height"));
 if(width&&!height&&box)height=width*box[3]/box[2];if(height&&!width&&box)width=height*box[2]/box[3];
 width??=box?.[2];height??=box?.[3];return width&&height?{width,height,kind:"svg"}:undefined;
}
export function decodedImageSize(image:HTMLImageElement):ViewerSize|undefined {
 return positive(image.naturalWidth)&&positive(image.naturalHeight)?{width:image.naturalWidth,height:image.naturalHeight,kind:"image"}:undefined;
}
export function viewerFit(size:Pick<ViewerSize,"width"|"height">,width:number,height:number):number {
 if(!positive(size.width)||!positive(size.height)||!positive(width)||!positive(height))return 1;
 return Math.min(1,width/size.width,height/size.height);
}
export function viewerScale(value:number,fit:number):number {const lower=Math.min(positive(fit)?fit:1,.25);return Math.min(4,Math.max(lower,Number.isFinite(value)?value:1));}
