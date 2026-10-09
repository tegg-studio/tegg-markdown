/** @vitest-environment jsdom */
import {it,expect} from 'vitest';
import {bindObjectViewerHost,type ImageMetadataResult} from './objectViewerHost';
import {applyAuthoredImageGeometry,bindAuthoredImageGeometry,originalImageSize,imageGeometrySize,imageGeometryUnavailable} from './imageGeometry';
it('retains exact safe author attributes while using their rectangle rather than the natural bitmap ratio',()=>{const img=document.createElement('img');img.setAttribute('width','500');img.setAttribute('height','120');Object.defineProperties(img,{naturalWidth:{value:5000},naturalHeight:{value:1}});applyAuthoredImageGeometry(img);expect(img.getAttribute('width')).toBe('500');expect(img.getAttribute('height')).toBe('120');expect(img.style.aspectRatio).toBe('500 / 120');expect(img.style.objectFit).toBe('contain');expect(img.style.width).toBe('');img.removeAttribute('height');applyAuthoredImageGeometry(img);expect(img.style.aspectRatio).toBe('');expect(img.style.width).toBe('');});
it('completes only a single positive pixel height from actually decoded dimensions and refuses unsupported units',()=>{const img=document.createElement('img');img.setAttribute('height','120');Object.defineProperties(img,{naturalWidth:{value:500},naturalHeight:{value:250}});applyAuthoredImageGeometry(img);expect(img.style.width).toBe('240px');img.setAttribute('height','120%');applyAuthoredImageGeometry(img);expect(img.style.width).toBe('');expect(img.style.aspectRatio).toBe('');img.setAttribute('width','0');img.setAttribute('height','NaN');applyAuthoredImageGeometry(img);expect(img.style.aspectRatio).toBe('');});

const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
function proxy(source='app-file:///wide.png'){const root=document.createElement('div'),image=document.createElement('img');root.append(image);image.src=source;Object.defineProperties(image,{naturalWidth:{value:2048},naturalHeight:{value:1}});return {root,image};}
it('uses only original oriented Host dimensions for an unsized proxy and either single author dimension without altering attributes',async()=>{
  const {root,image}=proxy();let calls=0;const stopHost=bindObjectViewerHost(root,{resolveImageMetadata:async()=>{calls++;return {status:'static',width:5000,height:1};}}),off=bindAuthoredImageGeometry(image,root);expect(imageGeometrySize(image)).toBeUndefined();await flush();expect(originalImageSize(image)).toEqual({width:5000,height:1});expect(image.style.width).toBe('5000px');expect(image.style.aspectRatio).toBe('5000 / 1');
  image.setAttribute('height','120');await flush();expect(image.style.width).toBe('600000px');expect(image.getAttribute('height')).toBe('120');expect(image.hasAttribute('width')).toBe(false);
  image.removeAttribute('height');image.setAttribute('width','500');await flush();expect(image.style.width).toBe('');expect(image.style.aspectRatio).toBe('5000 / 1');expect(image.getAttribute('width')).toBe('500');expect(calls).toBe(1);off();stopHost();
});
it('keeps an explicit author rectangle when metadata is unavailable and never claims thumbnail pixels as original raster size',async()=>{
  const {root,image}=proxy();image.setAttribute('width','500');image.setAttribute('height','120');const stopHost=bindObjectViewerHost(root,{resolveImageMetadata:async()=>({status:'unavailable',reason:'budget'})}),off=bindAuthoredImageGeometry(image,root);await flush();expect(image.dataset.imageOriginalSizeState).toBe('unavailable');expect(originalImageSize(image)).toBeUndefined();expect(imageGeometrySize(image)).toBeUndefined();expect(image.style.aspectRatio).toBe('500 / 120');expect(imageGeometryUnavailable(image)).toBe(false);image.removeAttribute('width');await flush();expect(image.style.width).toBe('');expect(image.style.aspectRatio).toBe('');expect(imageGeometryUnavailable(image)).toBe(true);off();stopHost();
});
it('refuses a stale metadata completion after the same image node changes its actual source',async()=>{
 const {root,image}=proxy();const pending:Array<(value:ImageMetadataResult)=>void>=[],signals:AbortSignal[]=[];const stopHost=bindObjectViewerHost(root,{resolveImageMetadata:async({signal})=>{signals.push(signal);return new Promise(resolve=>pending.push(resolve));}}),off=bindAuthoredImageGeometry(image,root);await flush();image.src='app-file:///rotated.jpg';await flush();expect(signals[0].aborted).toBe(true);pending[0]({status:'static',width:5000,height:1});await flush();expect(originalImageSize(image)).toBeUndefined();pending[1]({status:'static',width:8,height:12});await flush();expect(originalImageSize(image)).toEqual({width:8,height:12});expect(image.style.width).toBe('8px');expect(image.style.aspectRatio).toBe('8 / 12');off();stopHost();
});
it('abort on disposal cannot apply an original-size result to a removed or replaced owner',async()=>{
 const {root,image}=proxy();let complete!:(result:ImageMetadataResult)=>void,signal!:AbortSignal;const stopHost=bindObjectViewerHost(root,{resolveImageMetadata:async(request)=>{signal=request.signal;return new Promise(resolve=>complete=resolve);}}),off=bindAuthoredImageGeometry(image,root);await flush();off();expect(signal.aborted).toBe(true);complete({status:'static',width:5000,height:1});await flush();expect(originalImageSize(image)).toBeUndefined();stopHost();
});
it('preserves decoded SVG dimensions if the Native ImageIO metadata adapter cannot resolve that format',async()=>{
 const {root,image}=proxy('app-file:///authored.svg');image.setAttribute('height','120');const stopHost=bindObjectViewerHost(root,{resolveImageMetadata:async()=>({status:'unavailable',reason:'unsupported'})}),off=bindAuthoredImageGeometry(image,root);await flush();expect(imageGeometrySize(image)).toEqual({width:2048,height:1});expect(image.style.width).toBe('245760px');expect(image.getAttribute('height')).toBe('120');off();stopHost();
});
it('does not accept fractional, negative or nonfinite claimed original raster dimensions',async()=>{
 for(const dimensions of [{width:0,height:1},{width:10.5,height:3},{width:1,height:NaN}]){const {root,image}=proxy();const stopHost=bindObjectViewerHost(root,{resolveImageMetadata:async()=>({status:'static',...dimensions})}),off=bindAuthoredImageGeometry(image,root);await flush();expect(image.dataset.imageOriginalSizeState).toBe('unavailable');expect(originalImageSize(image)).toBeUndefined();expect(imageGeometrySize(image)).toBeUndefined();off();stopHost();}
});

it('repeating an unchanged authored geometry does not rewrite presentation styles or author attributes',()=>{
 const {root,image}=proxy();image.setAttribute('height','120');Object.defineProperty(root,'clientWidth',{value:320});applyAuthoredImageGeometry(image);
 const observer=new MutationObserver(()=>{});observer.observe(image,{attributes:true});const snapshot=image.outerHTML;
 for(let i=0;i<5;i++)applyAuthoredImageGeometry(image);
 expect(observer.takeRecords()).toEqual([]);expect(image.outerHTML).toBe(snapshot);expect(image.getAttribute('height')).toBe('120');expect(image.hasAttribute('width')).toBe(false);observer.disconnect();
});
