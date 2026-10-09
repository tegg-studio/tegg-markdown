import {restoreViewerAnchor} from "./objectViewerScroll";
import {bindAuthoredImageGeometry,imageGeometryUnavailable} from "./imageGeometry";
import {contextFor,setUIText, setUILabel, mountOverlay} from "./uiContext";
import {bindImageSelection} from "./imageObjectSelection";
import {registerRenderedClipboardOpaque,isRenderedClipboardOpaque} from "./renderedSourceClipboard";
import {objectViewerHost,validImageAnimation,ImageAnimationTimeline} from "./objectViewerHost";
import {decodedImageSize, svgViewerSize, viewerFit, viewerScale, type ViewerSize} from "./objectViewerGeometry";
let serial = 0;
export function renderId() { return `tegg-${++serial}`; }

/** Remap generated IDs together with all their references, including SVG paint servers. */
export function scopeIds(root: HTMLElement | SVGElement) {
  const prefix = renderId(), ids = new Map<string, string>(); let index = 0;
  for (const node of root.querySelectorAll<HTMLElement>("[id]")) {
    const old = node.id; const next = `${prefix}-${index++}`;
    ids.set(old, next); node.dataset.originalId ??= old; node.id = next;
  }
  for (const node of root.querySelectorAll("*")) {
    for (const attr of [...node.attributes]) {
      let value = attr.value;
      if (["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "headers"].includes(attr.name)) value = value.split(/\s+/).map(id => ids.get(id) ?? id).join(" ");
      else if (["href", "xlink:href"].includes(attr.name) && value.startsWith("#")) value = `#${ids.get(value.slice(1)) ?? value.slice(1)}`;
      else value = value.replace(/url\(["']?#([^)'"\s]+)["']?\)/g, (all, id) => ids.has(id) ? `url(#${ids.get(id)})` : all);
      if (value !== attr.value) node.setAttribute(attr.name, value);
    }
    // Mermaid places ID selectors in its generated style sheet.
    if (node.tagName.toLowerCase() === "style") node.textContent = (node.textContent ?? "").replace(/#([\w-]+)/g, (all, id) => ids.has(id) ? `#${ids.get(id)}` : all);
  }
}
export function focusTarget(target?: HTMLElement | null) {
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
  target.scrollIntoView?.({block: "nearest"}); target.focus({preventScroll: true});
}
export function action(label: string, run: () => void) {
  const button = document.createElement("button"); button.type = "button"; setUIText(button, label);
  button.addEventListener("click", event => {event.stopPropagation(); run();});
  return button;
}
// Shared compact chrome for rendered objects. Labels remain available to AT.
export function objectIcon(button: HTMLButtonElement, name: "edit" | "view" | "more" | "close") {
  const paths = {edit:'<path d="m16 3 5 5L8 21H3v-5Z M14 5l5 5"/>',view:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>'};
  const label = button.dataset.teggUiText ?? button.textContent ?? "";
  delete button.dataset.teggUiText;
  setUILabel(button,label); button.title=button.getAttribute("aria-label")!;
  button.classList.add("md-object-icon");
  button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
  const text=document.createElement("span");text.className="md-object-label";setUIText(text,label);button.append(text);
  return button;
}
export function objectActions(options:{edit?:()=>void;editLabel?:string;view?:()=>void;viewLabel?:string;more?:Array<{label:string;run:()=>void}>}) {
  const bar=document.createElement("div");registerRenderedClipboardOpaque(bar);bar.className="md-object-actions md-object-toolbar";
  setUILabel(bar,"Object actions");bar.setAttribute("role","group");
  if(options.edit)bar.append(objectIcon(action(options.editLabel??"Edit object",options.edit),"edit"));
  if(options.view)bar.append(objectIcon(action(options.viewLabel??"View diagram",options.view),"view"));
  if(options.more?.length){
    const menu=document.createElement("details");menu.className="md-object-more";
    const summary=document.createElement("summary");setUILabel(summary,"More actions");summary.title="More actions";
    const icon=objectIcon(action("More actions",()=>{}),"more");summary.innerHTML=icon.innerHTML;
    const list=document.createElement("div");list.className="md-object-menu";
    for(const item of options.more)list.append(action(item.label,()=>{menu.open=false;item.run();}));
    menu.append(summary,list);bar.append(menu);
    menu.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();menu.open=false;summary.focus();}});
    menu.addEventListener("focusout",()=>queueMicrotask(()=>{if(!menu.contains(document.activeElement))menu.open=false;}));
    summary.addEventListener("click",event=>event.stopPropagation());
  }
  bar.addEventListener("click",event=>event.stopPropagation());
  return bar;
}
export function imagePlaceholder(alt:string, blocked=false){
  const note=document.createElement("span");registerRenderedClipboardOpaque(note);note.className="md-image-unavailable";note.dataset.teggEditorProjection="true";note.setAttribute("contenteditable","false");note.setAttribute("role","status");
  const title=document.createElement("strong");setUIText(title,blocked?"Image not loaded":"Image loading failed");
  const detail=document.createElement("span");detail.textContent=alt;note.append(title,detail);return note;
}
const panels = new Set<{owner: HTMLElement; trigger: HTMLElement; dialog: HTMLElement; close: (restore?: boolean) => void}>();
export function disposeInteractions(root: HTMLElement) {
  for (const panel of [...panels]) if (panel.owner === root || root.contains(panel.owner) || root === panel.trigger || root.contains(panel.trigger)) panel.close(false);
}
export function openPanel(trigger: HTMLElement, title: string, modal = false, takeFocus = true) {
  const owner = trigger.closest<HTMLElement>(".tegg-surface") ?? trigger.closest<HTMLElement>(".cm-editor") ?? trigger.parentElement!;
  if (!trigger.closest("dialog")) disposeInteractions(owner);
  const dialog = document.createElement("dialog");dialog.dataset.mobile=String(contextFor(owner).mobile??(typeof matchMedia!=="undefined"&&matchMedia("(pointer:coarse)").matches)); dialog.className = `md-object-panel ${modal ? "md-object-viewer" : "md-note-panel"}`;
  setUILabel(dialog, title);
  const head = document.createElement("header"), heading = document.createElement("strong"); setUIText(heading, title);
  const body = document.createElement("div"); body.className = "md-object-body";
  const returnContainer = trigger.closest<HTMLElement>(".diagram-canvas");
  const controller = new AbortController();
  let unmountOverlay = () => {};
  const close = (restore = true) => {
    controller.abort(); dialog.remove(); unmountOverlay(); panels.delete(record);
    if (restore) {
      const replacement = trigger.dataset.sourceFrom === undefined ? null
        : [...owner.querySelectorAll<HTMLElement>(".cm-content .cm-live-math-inline")]
          .find(node => node.dataset.sourceFrom === trigger.dataset.sourceFrom);
      const target = trigger.isConnected ? trigger : replacement ?? returnContainer?.querySelector<HTMLElement>(".md-object-actions button");
      target?.focus({preventScroll: true});
    }
  };
  const record = {owner: returnContainer ?? (modal ? owner : trigger), trigger, dialog, close}; panels.add(record);
  head.append(heading, objectIcon(action("Close", () => close()),"close")); dialog.append(head, body); unmountOverlay = mountOverlay(owner, dialog);
  dialog.addEventListener("cancel", event => {event.preventDefault(); close();});
  dialog.addEventListener("keydown", event => {event.stopPropagation(); if (event.key === "Escape") {event.preventDefault(); close();}});
  dialog.addEventListener("click", event => event.stopPropagation());
  if (modal && dialog.showModal) dialog.showModal(); else {
    dialog.setAttribute("open", "");
    if (dialog.showPopover) {dialog.setAttribute("popover", "manual"); dialog.showPopover();}
    const rect = trigger.getBoundingClientRect();
    if (owner.clientWidth >= 480 && window.innerHeight >= 600) {
      dialog.style.top = `${Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 380))}px`;
      dialog.style.left = `${Math.max(12, Math.min(rect.left - 100, window.innerWidth - 452))}px`;
    }
    document.addEventListener("pointerdown", event => {if (![...panels].some(panel => panel.dialog.contains(event.target as Node)) && event.target !== trigger) close(false);}, {signal: controller.signal});
  }
  if(takeFocus)head.querySelector("button")?.focus({preventScroll: true});
  return {dialog, body, head, close, signal: controller.signal};
}

export function openObjectViewer(trigger: HTMLElement, visual: HTMLElement, source: string, title: string, edit?: () => void) {
  const {dialog, body, head, signal, close} = openPanel(trigger, title, true);
  if(title==="Formula")dialog.classList.add("md-formula-viewer");
  const controls = document.createElement("nav"); setUILabel(controls, "View controls");
  const stage = document.createElement("div"); stage.className = "md-object-stage"; stage.tabIndex = 0; setUILabel(stage, "Diagram or formula. Scroll to pan; use zoom controls to enlarge.");
  // Scrolling is immediate, including hosts that set smooth scrolling globally.
  stage.style.scrollBehavior="auto";
  const content = document.createElement("div"); content.className = "md-object-content";
  const graphic=document.createElement("div");graphic.className="md-object-graphic";graphic.style.transformOrigin="0 0";
  const image=visual.tagName.toLowerCase()==="img"?visual as HTMLImageElement:undefined;
  const imageHost=objectViewerHost(trigger);
  const originalStyle=getComputedStyle(visual);
  const makeClone=()=>{
    // Reusing decoded pixels avoids a new load and does not restart the document GIF.
    let result:HTMLElement;
    if(image){const canvas=document.createElement("canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.setAttribute("role","img");canvas.setAttribute("aria-label",image.alt);try{canvas.getContext("2d")?.drawImage(image,0,0);}catch{ /* Failed decoded pixels remain unavailable, never cause a retry. */ }result=canvas;}
    else result=visual.cloneNode(true) as HTMLElement;
    result.querySelectorAll("button, .md-object-actions").forEach(node=>node.remove());
    for(const node of [result,...result.querySelectorAll("[tabindex], [aria-haspopup]")]){node.removeAttribute("tabindex");node.removeAttribute("aria-haspopup");}
    result.style.fontSize=originalStyle.fontSize;result.style.fontFamily=originalStyle.fontFamily;result.style.lineHeight=originalStyle.lineHeight;result.style.color=originalStyle.color;
    result.style.width="100%";result.style.height="100%";result.style.maxWidth="none";result.style.maxHeight="none";result.style.margin="0";result.style.padding="0";
    scopeIds(result);return result;
  };
  let clone=makeClone();graphic.append(clone);content.append(graphic);stage.append(content);body.append(controls,stage);
  const svgFor=(node:HTMLElement)=>node.tagName.toLowerCase()==="svg"?node as unknown as SVGSVGElement:node.querySelector("svg");
  let svg=svgFor(clone), natural:ViewerSize|undefined=image?(imageHost?.decodeAnimatedImage?undefined:decodedImageSize(image)):svg?svgViewerSize(svg):undefined;
  let extent={width:1,height:1},scale=1,fitting=true,fitScale=1;
  const label=document.createElement("output");label.setAttribute("aria-live","polite");
  const actual=action("Actual size",()=>zoom(1));
  const measure=()=>{
    graphic.style.transform="none";graphic.style.width="max-content";graphic.style.height="auto";
    if(natural){extent=natural;}
    else if(image){extent=decodedImageSize(image)??{width:1,height:1};}
    else{
      // Formula extent is measured at its resolved text role, after removing preview constraints.
      clone.style.width="max-content";clone.style.height="auto";
      const math=clone.matches(".katex")?clone:clone.querySelector<HTMLElement>(".katex");
      const rect=(math??clone).getBoundingClientRect();extent={width:Math.max(1,rect.width),height:Math.max(1,rect.height)};
      if(title==="Formula"&&math&&rect.width>0&&rect.height>0)natural={...extent,kind:"formula"};
    }
    clone.style.width="100%";clone.style.height="100%";graphic.style.width=`${extent.width}px`;graphic.style.height=`${extent.height}px`;
    dialog.dataset.naturalSize=natural?`${natural.width}x${natural.height}`:"unknown";actual.disabled=!natural;if(natural){setUILabel(actual,"Actual size");actual.removeAttribute("title");}
    if(!natural){setUILabel(actual,"Natural size unavailable");actual.title=actual.getAttribute("aria-label")!;}
  };
  const insets=()=>{const style=getComputedStyle(content);return {x:(parseFloat(style.paddingLeft)||0)+(parseFloat(style.paddingRight)||0),y:(parseFloat(style.paddingTop)||0)+(parseFloat(style.paddingBottom)||0)};};
  const recomputeFit=()=>{const padding=insets();fitScale=viewerFit(extent,Math.max(1,stage.clientWidth-padding.x),Math.max(1,stage.clientHeight-padding.y));return fitScale;};
  let center:{x:number;y:number}|undefined;
  const rememberCenter=()=>{if(stage.clientWidth!==lastWidth||stage.clientHeight!==lastHeight)return;const rect=graphic.getBoundingClientRect(),viewport=stage.getBoundingClientRect();center={x:(viewport.left+stage.clientLeft+stage.clientWidth/2-rect.left)/scale,y:(viewport.top+stage.clientTop+stage.clientHeight/2-rect.top)/scale};};
  const scrollOffset={x:0,y:0};
  const restorePoint=(point:{x:number;y:number},clientX:number,clientY:number)=>{restoreViewerAnchor(stage,graphic,point,scale,{x:clientX,y:clientY},scrollOffset);rememberCenter();};
  const applyScale=(value:number)=>{
    scale=viewerScale(value,recomputeFit());const padding=insets(),width=extent.width*scale,height=extent.height*scale;
    content.style.boxSizing="border-box";content.style.width=`${width+padding.x}px`;content.style.height=`${Math.max(stage.clientHeight,height+padding.y)}px`;
    graphic.style.position="relative";graphic.style.transform="none";graphic.style.width=`${width}px`;graphic.style.height=`${height}px`;graphic.style.top=`${Math.max(0,(stage.clientHeight-height-padding.y)/2)}px`;
    clone.style.position="absolute";clone.style.inset="0 auto auto 0";clone.style.width=`${extent.width}px`;clone.style.height=`${extent.height}px`;clone.style.transformOrigin="0 0";clone.style.transform=`scale(${scale})`;
    if(natural){delete label.dataset.teggUiText;label.textContent=`${Math.round(scale*100)}%`;}else setUIText(label,"Natural size unavailable");dialog.dataset.viewerScale=String(scale);
  };
  function zoom(value:number,anchor?:{x:number;y:number}){
    fitting=false;const rect=graphic.getBoundingClientRect(),viewport=stage.getBoundingClientRect();const at=anchor??{x:viewport.left+stage.clientLeft+stage.clientWidth/2,y:viewport.top+stage.clientTop+stage.clientHeight/2};const point={x:(at.x-rect.left)/scale,y:(at.y-rect.top)/scale};applyScale(value);restorePoint(point,at.x,at.y);
  }
  const fit=()=>{fitting=true;scrollOffset.x=scrollOffset.y=0;graphic.style.translate="";applyScale(recomputeFit());stage.scrollLeft=0;stage.scrollTop=0;rememberCenter();};
  controls.append(action("Fit",fit),actual,action("−",()=>zoom(scale/1.25)),label,action("+",()=>zoom(scale*1.25)));
  if(title==="Diagram"||image){
    const background=document.createElement("select");setUILabel(background,"Viewing background");
    for(const [value,text] of [["","Background: Automatic"],["#fff","Background: Light"],["#202124","Background: Dark"]]){const option=document.createElement("option");option.value=value;setUIText(option,text);background.append(option);}
    background.addEventListener("change",()=>{stage.style.backgroundColor=background.value;});controls.append(background);
  }
  if(!image){const details=document.createElement("details"),summary=document.createElement("summary"),pre=document.createElement("pre");setUIText(summary,title==="Formula"?"TeX source":"Diagram source");pre.textContent=source;details.append(summary,pre);body.append(details);controls.append(action(title==="Formula"?"Copy TeX":"Copy source",()=>{void copySource(source,dialog);}));}
  if(edit)head.append(action("Edit Source",()=>{close(false);edit();}));
  measure();
  const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let animations:Animation[]=[],animatedSVG=false,playing=!reduced?.matches;
  const playback=action("Pause",()=>{playing=!playing;updatePlayback();}),replay=action("Replay",()=>{for(const animation of animations)animation.currentTime=0;svg?.setCurrentTime?.(0);playing=true;updatePlayback();});
  function updatePlayback(){for(const animation of animations)playing?animation.play():animation.pause();if(animatedSVG)playing?svg?.unpauseAnimations?.():svg?.pauseAnimations?.();setUIText(playback,playing?"Pause":"Play");playback.setAttribute("aria-pressed",String(playing));}
  const connectAnimation=()=>{
    animations=clone.getAnimations?.({subtree:true})??[];animatedSVG=!!svg?.querySelector("animate,animateMotion,animateTransform,set")&&typeof svg.pauseAnimations==="function";
    playback.remove();replay.remove();if(animations.length||animatedSVG){controls.append(playback,replay);if(reduced?.matches&&!playing){for(const animation of animations)animation.currentTime=0;svg?.setCurrentTime?.(0);}updatePlayback();}
  };
  let decodedTimeline:ImageAnimationTimeline|undefined,animationFrame=0,decodedFrames:HTMLImageElement[]=[];
  const animationStatus=document.createElement("span");animationStatus.className="md-image-animation-status";animationStatus.setAttribute("role","status");
  const decodedPlayback=action("Play",()=>{if(!decodedTimeline)return;decodedTimeline.playing?decodedTimeline.pause(performance.now()):decodedTimeline.play(performance.now());renderDecodedFrame();scheduleDecoded();});
  const decodedReplay=action("Replay",()=>{if(!decodedTimeline)return;decodedTimeline.replay(performance.now());renderDecodedFrame();scheduleDecoded();});
  const renderDecodedFrame=()=>{if(!decodedTimeline||!decodedFrames.length||signal.aborted)return;const frame=decodedTimeline.advance(performance.now());const canvas=clone as HTMLCanvasElement;const context=canvas.getContext("2d");context?.clearRect(0,0,canvas.width,canvas.height);context?.drawImage(decodedFrames[frame],0,0);dialog.dataset.animationFrame=String(frame);setUIText(decodedPlayback,decodedTimeline.playing?"Pause":"Play");decodedPlayback.setAttribute("aria-pressed",String(decodedTimeline.playing));};
  const scheduleDecoded=()=>{cancelAnimationFrame(animationFrame);if(decodedTimeline?.playing&&!signal.aborted)animationFrame=requestAnimationFrame(()=>{renderDecodedFrame();scheduleDecoded();});};
  const unavailable=(reason:string)=>{dialog.dataset.animationState="unavailable";dialog.dataset.animationReason=reason;setUIText(animationStatus,reason==="budget"?"Image exceeds the viewing budget.":"Animation controls unavailable for this image.");};
  const decodeFrame=async(dataURL:string,width:number,height:number)=>{if(!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataURL))throw new Error("Invalid decoded frame source");const frame=new Image();frame.src=dataURL;await frame.decode();if(signal.aborted)throw new Error("Viewer closed");if(frame.naturalWidth!==width||frame.naturalHeight!==height)throw new Error("Invalid decoded frame dimensions");return frame;};
  if(image){
    controls.append(animationStatus);dialog.dataset.animationState="checking";setUIText(animationStatus,"Loading image information…");
    if(!imageHost?.decodeAnimatedImage)unavailable("unsupported");
    else void Promise.resolve().then(()=>imageHost.decodeAnimatedImage!({source:image.currentSrc||image.src,signal})).then(async result=>{
      if(signal.aborted)return;
      if(result.status==="unavailable"){unavailable(result.reason);return;}
      if(result.status==="ready"){
        if(!validImageAnimation(result))throw new Error("Invalid animation frames");
        decodedFrames=await Promise.all(result.frames.map(frame=>decodeFrame(frame.dataURL,result.width,result.height)));if(signal.aborted)return;
        natural={width:result.width,height:result.height,kind:"image"};const canvas=clone as HTMLCanvasElement;canvas.width=result.width;canvas.height=result.height;
        measure();fitting?fit():applyScale(scale);decodedTimeline=new ImageAnimationTimeline(result.frames.map(frame=>frame.durationMs),result.loopCount??0);if(!reduced?.matches)decodedTimeline.play(performance.now());controls.append(decodedPlayback,decodedReplay);animationStatus.remove();dialog.dataset.animationState="ready";renderDecodedFrame();scheduleDecoded();
      }else{
        if(result.width!==undefined||result.height!==undefined){if(!Number.isSafeInteger(result.width)||!Number.isSafeInteger(result.height)||!result.width||!result.height||result.width<0||result.height<0)throw new Error("Invalid source dimensions");
          if(result.dataURL){const full=await decodeFrame(result.dataURL,result.width,result.height);if(signal.aborted)return;const canvas=clone as HTMLCanvasElement;canvas.width=result.width;canvas.height=result.height;canvas.getContext("2d")?.drawImage(full,0,0);}
          natural={width:result.width,height:result.height,kind:"image"};measure();fitting?fit():applyScale(scale);
        }
        dialog.dataset.animationState="static";animationStatus.remove();
      }
    }).catch(()=>{if(!signal.aborted)unavailable("invalid");});
  }
  reduced?.addEventListener("change",event=>{if(event.matches&&decodedTimeline){decodedTimeline.pause(performance.now());renderDecodedFrame();cancelAnimationFrame(animationFrame);}},{signal});
  signal.addEventListener("abort",()=>{cancelAnimationFrame(animationFrame);decodedFrames=[];decodedTimeline=undefined;});
  requestAnimationFrame(()=>{if(signal.aborted)return;connectAnimation();if(fitting)fit();});
  reduced?.addEventListener("change",event=>{if(event.matches){playing=false;updatePlayback();}},{signal});
  signal.addEventListener("abort",()=>{for(const animation of animations)animation.cancel();});
  stage.addEventListener("scroll",rememberCenter,{signal});
  let lastWidth=stage.clientWidth,lastHeight=stage.clientHeight;
  const observer=new ResizeObserver(()=>{if(signal.aborted)return;const changed=stage.clientWidth!==lastWidth||stage.clientHeight!==lastHeight;lastWidth=stage.clientWidth;lastHeight=stage.clientHeight;if(fitting)fit();else if(changed){const point=center;applyScale(scale);if(point){const rect=stage.getBoundingClientRect();restorePoint(point,rect.left+stage.clientLeft+stage.clientWidth/2,rect.top+stage.clientTop+stage.clientHeight/2);}}});observer.observe(stage);signal.addEventListener("abort",()=>observer.disconnect());
  // A theme re-render refreshes only the graphic; session controls and focus remain mounted.
  const graphicObserver=new MutationObserver(()=>{if(visual.dataset.renderState!=="ready"||!svgFor(visual))return;const point=center;clone.replaceWith(clone=makeClone());svg=svgFor(clone);natural=svg?svgViewerSize(svg):undefined;measure();connectAnimation();if(fitting)fit();else{applyScale(scale);if(point){const rect=stage.getBoundingClientRect();restorePoint(point,rect.left+stage.clientLeft+stage.clientWidth/2,rect.top+stage.clientTop+stage.clientHeight/2);}}});
  if(title==="Diagram")graphicObserver.observe(visual,{childList:true,subtree:true,attributes:true,attributeFilter:["data-render-state"]});signal.addEventListener("abort",()=>graphicObserver.disconnect());
  // Gestures stay inside this viewer and share the same zoom bounds as accessible controls.
  const pointers=new Map<number,{x:number;y:number}>();let previous:{x:number;y:number;distance:number}|undefined;
  const position=()=>{const points=[...pointers.values()],a=points[0],b=points[1]??a;return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:points.length>1?Math.hypot(a.x-b.x,a.y-b.y):0};};
  stage.addEventListener("pointerdown",event=>{if(event.pointerType==="mouse"&&event.button!==0)return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});previous=position();stage.setPointerCapture?.(event.pointerId);event.preventDefault();});
  stage.addEventListener("pointermove",event=>{if(!pointers.has(event.pointerId)||!previous)return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});const next=position();if(next.distance&&previous.distance)zoom(scale*next.distance/previous.distance,{x:previous.x,y:previous.y});stage.scrollLeft+=previous.x-next.x;stage.scrollTop+=previous.y-next.y;previous=next;rememberCenter();});
  const release=(event:PointerEvent)=>{pointers.delete(event.pointerId);previous=pointers.size?position():undefined;};stage.addEventListener("pointerup",release);stage.addEventListener("pointercancel",release);
  stage.addEventListener("keydown",event=>{if(event.key==="+"||event.key==="="){event.preventDefault();zoom(scale*1.25);}if(event.key==="-"){event.preventDefault();zoom(scale/1.25);}if(event.key==="0"){event.preventDefault();fit();}});
}

const imageViewRecords=new WeakMap<HTMLImageElement,{owner:HTMLElement;controls:HTMLElement;editAction?:HTMLElement;place?:()=>void;dispose?:()=>void}>();
/** Internal lifecycle capability: reset only controls created for this exact image. */
export function disposeRenderedImageView(image:HTMLImageElement){imageViewRecords.get(image)?.dispose?.();}
/** Internal presentation binding for the existing HTML image editor action. */
export function attachRenderedImageEditAction(image:HTMLImageElement,action:HTMLElement):boolean {
  const record=imageViewRecords.get(image);if(!record||!record.owner.contains(image)||image.closest('a'))return false;
  record.editAction=action;record.place?.();return true;
}
/** Read-only identity of actual SDK controls for Host layout. Author attributes/classes
 * cannot register projections or grant editing/command authority. */
export function renderedImageViewControls(owner:HTMLElement):readonly HTMLElement[] {
  return [...owner.querySelectorAll<HTMLImageElement>("img")].flatMap(image=>{
    const record=imageViewRecords.get(image);
    return record?.owner===owner&&record.controls.parentElement===owner?[record.controls,...(record.editAction?.parentElement===owner?[record.editAction]:[])]:[];
  });
}
const imageViewBindings=new Set<{image:HTMLImageElement;cleanup:()=>void}>();
let imageRemovalObserver:MutationObserver|undefined;
const imageGeometryBindings=new WeakMap<HTMLImageElement,()=>void>();
const imageFailures=new WeakMap<HTMLImageElement,HTMLElement>();
function trackImageView(image:HTMLImageElement,cleanup:()=>void){
 const record={image,cleanup:()=>{cleanup();imageViewBindings.delete(record);if(!imageViewBindings.size){imageRemovalObserver?.disconnect();imageRemovalObserver=undefined;}}};imageViewBindings.add(record);
 imageRemovalObserver??=new MutationObserver(records=>{if(!records.some(record=>record.removedNodes.length))return;for(const binding of [...imageViewBindings])if(!binding.image.isConnected)binding.cleanup();});
 imageRemovalObserver.observe(document.documentElement,{subtree:true,childList:true});requestAnimationFrame(()=>{if(!image.isConnected)record.cleanup();});return record.cleanup;
}
export function enhanceFigures(root: ParentNode) {
  // CSS :only-child ignores text nodes. Classify image-only paragraphs from
  // authored content so mixed text/images keep their inline position, including
  // linked images and readers with interaction enhancements disabled.
  const authoredChildren=(node:Node)=>[...node.childNodes].filter(child=>!isRenderedClipboardOpaque(child)&&(child.nodeType!==Node.TEXT_NODE||!!child.textContent?.trim()));
  for(const paragraph of root.querySelectorAll<HTMLElement>('p')){
    const content=authoredChildren(paragraph),only=content.length===1?content[0]:undefined;
    const linked=only instanceof HTMLAnchorElement?authoredChildren(only):[];
    if(only instanceof HTMLImageElement||linked.length===1&&linked[0] instanceof HTMLImageElement)paragraph.dataset.imageParagraph='true';
    else delete paragraph.dataset.imageParagraph;
  }
  for (const figure of root.querySelectorAll<HTMLElement>("figure:has(figcaption)")) figure.classList.add("md-explicit-figure");
  for (const image of root.querySelectorAll("img")) {
    imageGeometryBindings.get(image)?.();
    if(!image.closest('[data-enhancements="false"]')&&!image.closest(".md-object-viewer")&&!imageViewRecords.has(image)){
      const owner=image.closest<HTMLElement>("figure")??(image.parentElement?.tagName==="A"?image.parentElement.parentElement:image.parentElement);
      const authored=owner?[...owner.childNodes].filter(node=>node.nodeType!==Node.TEXT_NODE||!!node.textContent?.trim()):[];
      const paragraph=owner?.tagName==="P"&&authored.length===1&&(authored[0]===image||authored[0]===image.parentElement);
      // Tight lists omit P. A following nested list is another block, not inline
      // author text; the first image still remains a standalone first block.
      const tightList=owner?.tagName==="LI"&&authored[0]===image&&authored.slice(1).every(node=>node instanceof Element&&/^(UL|OL)$/.test(node.tagName));
      const standalone=paragraph||tightList;
      const figure=owner?.tagName==="FIGURE"&&owner.querySelectorAll("img").length===1;
      if(owner&&!image.closest("a")&&(standalone||figure)){
        image.dataset.teggImageViewer="true";
        if(standalone){owner.dataset.imageStandalone="true";image.style.display="block";image.style.marginInline="auto";}
        owner.classList.add("md-image-container");owner.style.position="relative";
        const controls=objectActions({view:()=>openObjectViewer(button,image,"","Image"),viewLabel:"View image"});controls.classList.add("md-image-view-actions");controls.dataset.teggEditorProjection="true";controls.contentEditable="false";controls.style.position="absolute";controls.style.inset="auto";
        const button=controls.querySelector<HTMLButtonElement>("button")!;button.setAttribute("aria-haspopup","dialog");
        const place=()=>{
          const record=imageViewRecords.get(image);if(record?.controls!==controls)return;
          button.disabled=!image.naturalWidth||!image.naturalHeight||image.hidden;
          const at=image.getBoundingClientRect(),parent=owner.getBoundingClientRect(),edit=record.editAction;
          controls.hidden=false;
          // Measure the whole actual-role group without relocating a focused real
          // action just to measure it. The inert probe has no event handlers and is
          // removed synchronously before input or accessibility can act on it.
          let probe:HTMLElement|undefined;
          if(edit&&edit.parentElement!==controls){probe=edit.cloneNode(true) as HTMLElement;probe.inert=true;probe.setAttribute('aria-hidden','true');controls.prepend(probe);}
          const width=controls.offsetWidth||(edit?96:44),height=controls.offsetHeight||44;probe?.remove();
          const fits=!button.disabled&&at.width>=width+16&&at.height>=height+16;
          if(edit&&((edit.parentElement===controls)!==fits)){
            const focused=edit.contains(document.activeElement)?document.activeElement as HTMLElement:null;
            if(fits)controls.prepend(edit);else image.after(edit);
            focused?.focus({preventScroll:true});
          }
          controls.hidden=!fits;
          controls.style.left=`${Math.max(0,at.right-parent.left-width-8)}px`;controls.style.top=`${Math.max(0,at.top-parent.top+8)}px`;
        };
        imageViewRecords.set(image,{owner,controls,place});owner.append(controls);image.addEventListener("load",place);image.addEventListener("error",place);window.addEventListener("resize",place);
        // Relocating the existing Edit action or hiding the group can resize an
        // observed owner. Apply presentation in the next frame, outside observer
        // delivery, and coalesce image/owner/control notifications into one pass.
        let layoutFrame:number|undefined;
        const schedulePlace=()=>{layoutFrame??=requestAnimationFrame(()=>{layoutFrame=undefined;place();});};
        const observer=typeof ResizeObserver==="undefined"?undefined:new ResizeObserver(schedulePlace);observer?.observe(image);observer?.observe(owner);observer?.observe(controls);
        const selection=bindImageSelection(owner,{image,enabled:()=>!controls.hidden&&!button.disabled,preserveLinkClick:true});
        imageViewRecords.get(image)!.dispose=trackImageView(image,()=>{selection.dispose();observer?.disconnect();if(layoutFrame!==undefined)cancelAnimationFrame(layoutFrame);window.removeEventListener("resize",place);image.removeEventListener("load",place);image.removeEventListener("error",place);if(imageViewRecords.get(image)?.controls===controls){imageViewRecords.delete(image);controls.remove();delete image.dataset.teggImageViewer;}});schedulePlace();
      }
    }
    const failed = () => {
      if (imageFailures.get(image)) return;
      const placeholder = imagePlaceholder(image.alt || "", !image.getAttribute("src"));imageFailures.set(image,placeholder);
      image.hidden = true; image.after(placeholder);
    };
    image.addEventListener("error", failed);
    const loaded=()=>{if(imageGeometryUnavailable(image)){failed();return;}image.hidden = false; imageFailures.get(image)?.remove();imageFailures.delete(image);};
    image.addEventListener("load",loaded);
    const stopGeometry=bindAuthoredImageGeometry(image,image.parentElement??root as HTMLElement,()=>{if(imageGeometryUnavailable(image))failed();else if(image.complete&&image.naturalWidth)loaded();});
    imageGeometryBindings.set(image,trackImageView(image,()=>{stopGeometry();image.removeEventListener("error",failed);image.removeEventListener("load",loaded);}));
    if (image.complete && image.naturalWidth === 0) failed();
  }
}

/** Additive completion leaves existing string-detail Host listeners compatible. */
export type TextCopyEvent=CustomEvent<string>&{completion?:Promise<void>};
const copyRequests=new WeakMap<HTMLElement,number>();
const copyFailures=new WeakMap<HTMLElement,HTMLElement>();
/** true requires completed clipboard work; a legacy handled event has no inferred acknowledgement. */
export async function copySource(text:string,trigger:HTMLElement,fallback?:()=>boolean|Promise<boolean>,valid?:()=>boolean):Promise<boolean|undefined> {
  const parent=trigger.parentElement,epoch=(copyRequests.get(trigger)??0)+1;copyRequests.set(trigger,epoch);
  const current=()=>trigger.isConnected&&trigger.parentElement===parent&&copyRequests.get(trigger)===epoch&&valid?.()!==false;
  const request=new CustomEvent("tegg-copy-text",{detail:text,bubbles:true,cancelable:true}) as TextCopyEvent;
  try {
    const browser=trigger.dispatchEvent(request);
    if(!browser){if(!request.completion)return;await request.completion;}
    else {try{await navigator.clipboard.writeText(text);}catch(error){if(!fallback||!current()||!await fallback())throw error;}}
    if(!current())return;copyFailures.get(trigger)?.remove();copyFailures.delete(trigger);return true;
  } catch {
    if(current()){
      copyFailures.get(trigger)?.remove();const status=document.createElement("span");copyFailures.set(trigger,status);registerRenderedClipboardOpaque(status);status.setAttribute("role","status");setUIText(status,"Copy unavailable. Select the source to copy.");parent?.append(status);
    }
    return false;
  }
}
