import {isRenderedClipboardOpaque} from "./renderedSourceClipboard";
import {type TaskMarker} from "./taskMarker";
const markers=new WeakMap<HTMLInputElement,TaskMarker>();
const textBodies=new WeakMap<Node,TaskMarker>();
const capturedSources=new WeakMap<TaskMarker,string>();
const excludedChildren=new WeakMap<TaskMarker,readonly Node[]>();
/** Only fresh renderer/AST registration grants a control or own-body identity. */
export function registerReaderTask(input:HTMLInputElement,marker:TaskMarker,bodies:readonly Node[],blocked:readonly Node[],source:string) {
  markers.set(input,marker);capturedSources.set(marker,source);
  for(const body of bodies)textBodies.set(body,marker);
  excludedChildren.set(marker,Object.freeze([...blocked]));
}
export function renderedTaskMarker(input:HTMLInputElement):TaskMarker|undefined {return markers.get(input);}
export function renderedTaskSource(marker:TaskMarker):string|undefined {return capturedSources.get(marker);}
export function queryRenderedTask(root:HTMLElement,node:Node):TaskMarker|null {
  if(!root.contains(node))return null;
  if(node instanceof HTMLInputElement)return markers.get(node)??null;
  for(let current:Node|null=node;current&&current!==root;current=current.parentNode){
    if(isRenderedClipboardOpaque(current))return null;
    const marker=textBodies.get(current);if(marker)return marker;
  }
  return null;
}
/** Side-effect free single own-body query; crossing excluded AST children rejects. */
export function querySelectedRenderedTask(root:HTMLElement,selection:Selection|null):TaskMarker|null {
  if(!selection||selection.isCollapsed||selection.rangeCount!==1||!selection.anchorNode||!selection.focusNode)return null;
  const first=queryRenderedTask(root,selection.anchorNode),last=queryRenderedTask(root,selection.focusNode);
  if(!first||first!==last)return null;
  const range=selection.getRangeAt(0);
  if((excludedChildren.get(first)??[]).some(node=>root.contains(node)&&range.intersectsNode(node)))return null;
  for(const input of root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    const other=markers.get(input);if(other&&other!==first&&range.intersectsNode(input))return null;
  }
  return first;
}
