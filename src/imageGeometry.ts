import {objectViewerHost} from "./objectViewerHost";
/** Safe positive HTML pixel dimensions describe an author rectangle, never a font-scaled role. */
export type OriginalImageSize={width:number;height:number};
const originalSizes=new WeakMap<HTMLImageElement,{source:string;size:OriginalImageSize}>();
const requiredMetadata=new WeakMap<HTMLImageElement,string>();
const sourceOf=(image:HTMLImageElement)=>image.src||image.currentSrc||image.getAttribute('src')||'';
const positive=(value:number)=>Number.isFinite(value)&&value>0;
const svgSource=(source:string)=>/^data:image\/svg\+xml[;,]/i.test(source)||/\.svg(?:[?#]|$)/i.test(source);
/** Native raster previews may be thumbnails. Only this exact node/source's Host metadata is authoritative. */
export function originalImageSize(image:HTMLImageElement):OriginalImageSize|undefined {const record=originalSizes.get(image);return record?.source===sourceOf(image)?record.size:undefined;}
export function imageGeometrySize(image:HTMLImageElement):OriginalImageSize|undefined {
  const trusted=originalImageSize(image);if(trusted)return trusted;
  const source=sourceOf(image);if(requiredMetadata.get(image)===source&&!svgSource(source))return;
  return positive(image.naturalWidth)&&positive(image.naturalHeight)?{width:image.naturalWidth,height:image.naturalHeight}:undefined;
}
/** Reuses the established unavailable-image presentation rather than laying out a guessed raster ratio. */
export function imageGeometryUnavailable(image:HTMLImageElement):boolean {
 const source=sourceOf(image);return requiredMetadata.get(image)===source&&image.dataset.imageOriginalSizeState==='unavailable'&&!originalImageSize(image)&&!svgSource(source)&&!(pixels(image.getAttribute('width'))&&pixels(image.getAttribute('height')));
}
/** Does not fetch or decode source bytes; the optional scoped Host authorizes its own metadata read. */
export function bindAuthoredImageGeometry(image:HTMLImageElement,owner:HTMLElement,onChange?:()=>void):()=>void {
  let alive=true,requested='',controller:AbortController|undefined,resizeFrame:number|undefined;
  const update=()=>{
    if(!alive)return;
    applyAuthoredImageGeometry(image);onChange?.();
    const source=sourceOf(image),resolver=objectViewerHost(owner)?.resolveImageMetadata;
    if(!resolver||!source||source===requested)return;
    requested=source;controller?.abort();controller=new AbortController();const pending=controller;
    requiredMetadata.set(image,source);if(originalSizes.get(image)?.source!==source)originalSizes.delete(image);
    image.dataset.imageOriginalSizeState='pending';applyAuthoredImageGeometry(image);
    Promise.resolve().then(()=>resolver({source,signal:pending.signal})).then(result=>{
      if(!alive||pending.signal.aborted||sourceOf(image)!==source)return;
      if(result.status==='static'&&Number.isSafeInteger(result.width)&&result.width>0&&Number.isSafeInteger(result.height)&&result.height>0){originalSizes.set(image,{source,size:{width:result.width,height:result.height}});image.dataset.imageOriginalSizeState='ready';}
      else {image.dataset.imageOriginalSizeState=originalImageSize(image)?'ready':'unavailable';}
      applyAuthoredImageGeometry(image);onChange?.();
    }).catch(()=>{if(alive&&!pending.signal.aborted&&sourceOf(image)===source){image.dataset.imageOriginalSizeState=originalImageSize(image)?'ready':'unavailable';applyAuthoredImageGeometry(image);onChange?.();}});
  };
  const observer=typeof MutationObserver==='undefined'?undefined:new MutationObserver(update);observer?.observe(image,{attributes:true,attributeFilter:['src','width','height']});
  const scheduleResize=()=>{resizeFrame??=requestAnimationFrame(()=>{resizeFrame=undefined;update();});};
  const resize=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(scheduleResize);resize?.observe(image.parentElement??owner);
  image.addEventListener('load',update);update();
  return ()=>{alive=false;controller?.abort();observer?.disconnect();resize?.disconnect();if(resizeFrame!==undefined)cancelAnimationFrame(resizeFrame);image.removeEventListener('load',update);};
}
const generated = new WeakMap<HTMLImageElement, {aspectRatio: string; width: string; height:string; objectFit:string}>();
function pixels(value: string | null): number | undefined {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value.trim())) return;
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : undefined;
}
/** Applies presentation only. The original width/height attributes and source bytes stay untouched. */
export function applyAuthoredImageGeometry(image: HTMLImageElement): void {
  const previous = generated.get(image),style=image.style;
  // Compute the final presentation before touching style. Clearing a generated
  // width just to restore it can temporarily resize its owner during measurement.
  let aspectRatio=previous&&style.aspectRatio===previous.aspectRatio?'':style.aspectRatio,
    widthStyle=previous?.width&&style.width===previous.width?'':style.width,
    heightStyle=previous?.height&&style.height===previous.height?'':style.height,
    objectFit=previous&&style.objectFit===previous.objectFit?'':style.objectFit;
  const width=pixels(image.getAttribute('width')),height=pixels(image.getAttribute('height')),natural=imageGeometrySize(image);
  let tracked=false;
  if(width&&height){
    aspectRatio=`${width} / ${height}`;objectFit='contain';tracked=true;
  }else if(natural){
    const trusted=originalImageSize(image);
    if(!width&&height){
      const baseWidth=height*natural.width/natural.height,parent=image.parentElement,parentStyle=parent?getComputedStyle(parent):undefined,available=parent?parent.clientWidth-(parseFloat(parentStyle?.paddingLeft??'0')||0)-(parseFloat(parentStyle?.paddingRight??'0')||0):0;
      widthStyle=`${baseWidth}px`;heightStyle=`${height*Math.min(1,available>0?available/baseWidth:1)}px`;
    }else if(trusted&&!width&&!image.hasAttribute('width')&&!image.hasAttribute('height'))widthStyle=`${natural.width}px`;
    if(height||trusted){aspectRatio=`${natural.width} / ${natural.height}`;objectFit='contain';}
    tracked=true;
  }
  if(style.aspectRatio!==aspectRatio)style.aspectRatio=aspectRatio;
  if(style.width!==widthStyle)style.width=widthStyle;
  if(style.height!==heightStyle)style.height=heightStyle;
  if(style.objectFit!==objectFit)style.objectFit=objectFit;
  if(tracked)generated.set(image,{aspectRatio:style.aspectRatio,width:width&&height?'':style.width,height:width&&height?'':style.height,objectFit:style.objectFit});
  else generated.delete(image);
}
