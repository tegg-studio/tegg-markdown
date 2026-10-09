import type {ContentDisplaySession} from './contentDisplaySession';
export type ContentObjectRange={from:number;to:number};
const bindings=new WeakMap<HTMLElement,()=>void>();
/** Bind a natural overflow viewport to the document session, without touching source. */
export function bindContentScroll(element:HTMLElement,session:ContentDisplaySession,kind:string,range:ContentObjectRange|(()=>ContentObjectRange)):()=>void {
  bindings.get(element)?.();let alive=true,restoring=false;
  const current=()=>typeof range==='function'?range():range;
  const restore=()=>{if(!alive)return;const {from,to}=current();element.dataset.contentObjectId=session.objectId(kind,from,to);element.dataset.sourceFrom=String(from);element.dataset.sourceTo=String(to);if(element.clientWidth<=0)return;restoring=true;element.scrollLeft=Math.min(session.horizontalOffset(kind,from,to),Math.max(0,element.scrollWidth-element.clientWidth));session.setHorizontalOffset(kind,from,to,element.scrollLeft);restoring=false;};
  const save=()=>{if(!alive||restoring||element.clientWidth<=0)return;const {from,to}=current();session.setHorizontalOffset(kind,from,to,element.scrollLeft);};
  element.addEventListener('scroll',save);const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(restore);observer?.observe(element);restore();requestAnimationFrame(restore);
  const cleanup=()=>{alive=false;element.removeEventListener('scroll',save);observer?.disconnect();bindings.delete(element);};bindings.set(element,cleanup);return cleanup;
}
