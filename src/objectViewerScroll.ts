/** Preserve a viewer anchor even when the browser quantizes scroll offsets. */
export function restoreViewerAnchor(stage: HTMLElement, graphic: HTMLElement,
  point: {x:number;y:number}, scale:number, client:{x:number;y:number}, offset:{x:number;y:number}) {
  const before=graphic.getBoundingClientRect();
  const wantedX=stage.scrollLeft+before.left+point.x*scale-client.x;
  const wantedY=stage.scrollTop+before.top+point.y*scale-client.y;
  const boundedX=wantedX>=0&&wantedX<=stage.scrollWidth-stage.clientWidth;
  const boundedY=wantedY>=0&&wantedY<=stage.scrollHeight-stage.clientHeight;
  stage.scrollLeft=wantedX;stage.scrollTop=wantedY;
  const after=graphic.getBoundingClientRect();
  // Correct only representational rounding; true scroll-bound clamping remains.
  if(boundedX)offset.x+=client.x-after.left-point.x*scale;
  if(boundedY)offset.y+=client.y-after.top-point.y*scale;
  graphic.style.translate=`${offset.x}px ${offset.y}px`;
}
