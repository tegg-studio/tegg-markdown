/** A touch cell keeps selection and text editing as two explicit actions.
 * Movement/cancellation and other targets never become a second editing tap. */
let chosen:HTMLElement|undefined;
const bindings=new Set<HTMLElement>();
let compatibilityClick:{x:number;y:number;time:number}|undefined;
function matchesCompatibilityMouse(event:MouseEvent){const pending=compatibilityClick;return !!pending&&!!event.detail&&Date.now()-pending.time<700&&Math.hypot(event.clientX-pending.x,event.clientY-pending.y)<=8;}
// Firefox may emit compatibility mousedown after pointerup even when pointerup
// was prevented. Its default focus would replace the newly focused cell editor.
// A fresh real pointerdown clears this token, so the user's next input is free.
function consumeCompatibilityMouseDown(event:MouseEvent){if(matchesCompatibilityMouse(event)){event.preventDefault();event.stopImmediatePropagation();}}
function consumeCompatibilityClick(event:MouseEvent){const consume=matchesCompatibilityMouse(event);compatibilityClick=undefined;if(consume){event.preventDefault();event.stopImmediatePropagation();}}
function outside(event:Event){compatibilityClick=undefined;if(chosen&&event.target instanceof Node&&!chosen.contains(event.target))chosen=undefined;}
function reset(){chosen=undefined;}
// WebKit may defer compatibility click until after a second touch. Selection
// must therefore complete on the first valid touchup, before that later click.
export function bindTableCellTouch(element:HTMLElement,options:{enabled:()=>boolean;selected:()=>boolean;select?:()=>void;edit:(point:{x:number;y:number})=>void;allowLinks?:boolean}){
 let down:{id:number;x:number;y:number;cancelled:boolean}|undefined;
 const targetAllowed=(target:EventTarget|null)=>{const node=target instanceof Element?target:target instanceof Node?target.parentElement:null;return !!node&&element.contains(node)&&!node.closest(options.allowLinks?'input,textarea,select,summary,.md-html-object-actions,.md-object-toolbar':'a,input,textarea,select,summary,.md-html-object-actions,.md-object-toolbar');};
 const pointerDown=(event:PointerEvent)=>{if(event.pointerType!=='touch'||!options.enabled()||!targetAllowed(event.target)){reset();down=undefined;return;}down={id:event.pointerId,x:event.clientX,y:event.clientY,cancelled:false};};
 const pointerMove=(event:PointerEvent)=>{if(down&&down.id===event.pointerId&&Math.hypot(event.clientX-down.x,event.clientY-down.y)>8){down.cancelled=true;reset();}};
 const pointerCancel=()=>{down=undefined;reset();};
 const pointerUp=(event:PointerEvent)=>{const start=down;down=undefined;if(!start||start.id!==event.pointerId||start.cancelled||!options.enabled()||!targetAllowed(event.target))return;const second=chosen===element&&options.selected();chosen=element;if(second){reset();event.preventDefault();event.stopPropagation();compatibilityClick={x:event.clientX,y:event.clientY,time:Date.now()};options.edit({x:event.clientX,y:event.clientY});}else options.select?.();};
 if(!bindings.size){document.addEventListener('pointerdown',outside,true);document.addEventListener('mousedown',consumeCompatibilityMouseDown,true);document.addEventListener('click',consumeCompatibilityClick,true);window.addEventListener('blur',reset);}bindings.add(element);
 element.addEventListener('pointerdown',pointerDown);element.addEventListener('pointermove',pointerMove);element.addEventListener('pointercancel',pointerCancel);element.addEventListener('pointerup',pointerUp);
 let disposed=false;return()=>{if(disposed)return;disposed=true;if(chosen===element)reset();bindings.delete(element);element.removeEventListener('pointerdown',pointerDown);element.removeEventListener('pointermove',pointerMove);element.removeEventListener('pointercancel',pointerCancel);element.removeEventListener('pointerup',pointerUp);if(!bindings.size){document.removeEventListener('pointerdown',outside,true);document.removeEventListener('mousedown',consumeCompatibilityMouseDown,true);document.removeEventListener('click',consumeCompatibilityClick,true);compatibilityClick=undefined;window.removeEventListener('blur',reset);}};
}
