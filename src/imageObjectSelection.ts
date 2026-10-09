/** Shared DOM-only image selection. It never parses or writes document source. */
let selected: HTMLElement | undefined;
const bindings = new Set<HTMLElement>();
function clear() { if(selected) selected.dataset.imageSelected="false"; selected=undefined; }
function outside(event: Event) { if(selected&&event.target instanceof Node&&!selected.contains(event.target)) clear(); }

export function bindImageSelection(owner:HTMLElement,options:{image:HTMLImageElement;enabled:()=>boolean;selectOnImageClick?:boolean;preserveLinkClick?:boolean}) {
  owner.dataset.imageSelected="false";
  const select=()=>{if(!options.enabled())return; if(selected!==owner)clear(); selected=owner;owner.dataset.imageSelected="true";};
  const click=(event:MouseEvent)=>{if(options.selectOnImageClick===false||event.target!==options.image)return;if(options.preserveLinkClick&&options.image.closest("a"))return;select();};
  const focus=(event:FocusEvent)=>{if(options.preserveLinkClick&&event.target instanceof Element&&event.target.closest("a"))return;select();};
  if(!bindings.size){document.addEventListener("pointerdown",outside,true);window.addEventListener("blur",clear);}
  bindings.add(owner);options.image.addEventListener("click",click);owner.addEventListener("focusin",focus);
  let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;if(selected===owner)clear();bindings.delete(owner);options.image.removeEventListener("click",click);owner.removeEventListener("focusin",focus);if(!bindings.size){document.removeEventListener("pointerdown",outside,true);window.removeEventListener("blur",clear);}};
  return {select,dispose};
}
