import {contextFor} from './uiContext';

/** Independent editing controls use the actual allocated Host surface. */
export function allocatedEditingSurface(owner:HTMLElement):{left:number;width:number;owners:readonly HTMLElement[]} {
  const viewportWidth=window.innerWidth,context=contextFor(owner);
  const frame=owner.closest<HTMLElement>('.tegg-sdk-frame');
  const owners=[...new Set([context.overlayContainer,frame].filter((node):node is HTMLElement=>!!node?.isConnected))];
  for(const candidate of owners){
    const rect=candidate.getBoundingClientRect(),left=Math.max(0,rect.left),right=Math.min(viewportWidth,rect.right);
    if(right>left)return {left,width:right-left,owners};
  }
  return {left:0,width:viewportWidth,owners};
}
