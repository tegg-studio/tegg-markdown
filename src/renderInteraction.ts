import {setUIText, setUILabel, mountOverlay} from "./uiContext";
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
const panels = new Set<{owner: HTMLElement; trigger: HTMLElement; dialog: HTMLElement; close: (restore?: boolean) => void}>();
export function disposeInteractions(root: HTMLElement) {
  for (const panel of [...panels]) if (panel.owner === root || root.contains(panel.owner) || root === panel.trigger || root.contains(panel.trigger)) panel.close(false);
}
export function openPanel(trigger: HTMLElement, title: string, modal = false) {
  const owner = trigger.closest<HTMLElement>(".tegg-surface") ?? trigger.parentElement!;
  if (!trigger.closest("dialog")) disposeInteractions(owner);
  const dialog = document.createElement("dialog"); dialog.className = `md-object-panel ${modal ? "md-object-viewer" : "md-note-panel"}`;
  setUILabel(dialog, title);
  const head = document.createElement("header"), heading = document.createElement("strong"); setUIText(heading, title);
  const body = document.createElement("div"); body.className = "md-object-body";
  const returnContainer = trigger.closest<HTMLElement>(".diagram-canvas");
  const controller = new AbortController();
  let unmountOverlay = () => {};
  const close = (restore = true) => {
    controller.abort(); dialog.remove(); unmountOverlay(); panels.delete(record);
    if (restore) {
      const target = trigger.isConnected ? trigger : returnContainer?.querySelector<HTMLElement>(".md-object-actions button");
      target?.focus({preventScroll: true});
    }
  };
  const record = {owner: returnContainer ?? trigger, trigger, dialog, close}; panels.add(record);
  head.append(heading, action("Close", () => close())); dialog.append(head, body); unmountOverlay = mountOverlay(owner, dialog);
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
  head.querySelector("button")?.focus({preventScroll: true});
  return {dialog, body, head, close, signal: controller.signal};
}

export function openObjectViewer(trigger: HTMLElement, visual: HTMLElement, source: string, title: string, edit?: () => void) {
  const {dialog, body, head, signal} = openPanel(trigger, title, true);
  const controls = document.createElement("nav"); setUILabel(controls, "View controls");
  const stage = document.createElement("div"); stage.className = "md-object-stage"; stage.tabIndex = 0; setUILabel(stage, "Diagram or formula. Scroll to pan; use zoom controls to enlarge.");
  const content = document.createElement("div"); content.className = "md-object-content";
  let clone = visual.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("button, .md-object-actions").forEach(node => node.remove());
  for (const node of [clone, ...clone.querySelectorAll("[tabindex], [aria-haspopup]")]) {node.removeAttribute("tabindex"); node.removeAttribute("aria-haspopup");}
  scopeIds(clone);
  content.append(clone); stage.append(content);
  let svg = clone.querySelector("svg"); const box = svg?.viewBox?.baseVal;
  let naturalWidth = box?.width || visual.scrollWidth || 600;
  let scale = 1, fitting = true;
  const label = document.createElement("output"); label.setAttribute("aria-live", "polite");
  const zoom = (value: number, automatic = false) => {
    if (!automatic) fitting = false;
    scale = Math.max(.1, Math.min(4, value)); content.style.width = `${naturalWidth * scale}px`;
    if (!svg) { clone.style.fontSize = `${scale}em`; }
    label.textContent = `${Math.round(scale * 100)}%`;
  };
  const fit = () => {fitting = true; zoom(Math.min(1, (stage.clientWidth - 40) / naturalWidth), true); stage.scrollTo?.(0, 0);};
  controls.append(action("Fit", fit), action("100%", () => zoom(1)), action("−", () => zoom(scale / 1.25)), label, action("+", () => zoom(scale * 1.25)));
  if (title === "Diagram") {
    const background = document.createElement("select"); setUILabel(background, "Viewing background");
    for (const [value, label] of [["", "Background: Automatic"], ["#fff", "Background: Light"], ["#202124", "Background: Dark"]]) {
      const option = document.createElement("option"); option.value = value; setUIText(option, label); background.append(option);
    }
    background.addEventListener("change", () => {stage.style.backgroundColor = background.value;}); controls.append(background);
  }
  const details = document.createElement("details"), summary = document.createElement("summary"), pre = document.createElement("pre");
  summary.textContent = title === "Formula" ? "TeX source" : "Diagram source"; pre.textContent = source; details.append(summary, pre);
  controls.append(action(title === "Formula" ? "Copy TeX" : "Copy source", () => { void copySource(source, dialog); }));
  if (edit) head.append(action("Edit Source", () => {disposeInteractions(dialog.parentElement!); edit();}));
  body.append(controls, stage, details); requestAnimationFrame(() => {if (fitting) fit();});
  const observer = new ResizeObserver(() => {if (fitting) fit();}); observer.observe(stage); signal.addEventListener("abort", () => observer.disconnect());
  // Refresh only the graphic after a theme render. Preserve the open panel, focus,
  // selected background, source disclosure, zoom and scroll coordinates.
  const graphicObserver = new MutationObserver(() => {
    if (visual.dataset.renderState !== "ready" || !visual.querySelector("svg")) return;
    const left = stage.scrollLeft, top = stage.scrollTop;
    const replacement = visual.cloneNode(true) as HTMLElement;
    replacement.querySelectorAll("button, .md-object-actions").forEach(node => node.remove());
    replacement.querySelectorAll("[tabindex], [aria-haspopup]").forEach(node => {node.removeAttribute("tabindex"); node.removeAttribute("aria-haspopup");});
    scopeIds(replacement); clone.replaceWith(replacement); clone = replacement;
    svg = clone.querySelector("svg"); naturalWidth = svg?.viewBox?.baseVal?.width || naturalWidth;
    zoom(scale, true); stage.scrollLeft = left; stage.scrollTop = top;
  });
  if (title === "Diagram") graphicObserver.observe(visual, {childList:true, subtree:true, attributes:true, attributeFilter:["data-render-state"]});
  signal.addEventListener("abort", () => graphicObserver.disconnect());
  // All pointer gestures are local to the viewer. Two fingers zoom around their midpoint.
  const pointers = new Map<number, {x:number; y:number}>();
  let previous: {x:number; y:number; distance:number} | undefined;
  const position = () => {
    const points = [...pointers.values()], a=points[0], b=points[1] ?? a;
    return {x:(a.x+b.x)/2, y:(a.y+b.y)/2, distance:points.length>1 ? Math.hypot(a.x-b.x,a.y-b.y) : 0};
  };
  stage.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY}); previous=position();
    stage.setPointerCapture?.(event.pointerId); event.preventDefault();
  });
  stage.addEventListener("pointermove", event => {
    if (!pointers.has(event.pointerId) || !previous) return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY}); const next=position();
    const oldScale=scale, rect=stage.getBoundingClientRect();
    const anchorX=stage.scrollLeft+previous.x-rect.left, anchorY=stage.scrollTop+previous.y-rect.top;
    if (next.distance && previous.distance) zoom(scale*next.distance/previous.distance);
    stage.scrollLeft=anchorX*(scale/oldScale)-(next.x-rect.left);
    stage.scrollTop=anchorY*(scale/oldScale)-(next.y-rect.top); previous=next;
  });
  const release = (event: PointerEvent) => {pointers.delete(event.pointerId); previous=pointers.size ? position() : undefined;};
  stage.addEventListener("pointerup", release); stage.addEventListener("pointercancel", release);
  stage.addEventListener("keydown", event => {
    if (event.key === "+" || event.key === "=") {event.preventDefault(); zoom(scale * 1.25);}
    if (event.key === "-") {event.preventDefault(); zoom(scale / 1.25);}
    if (event.key === "0") {event.preventDefault(); fit();}
  });
}

export function enhanceFigures(root: ParentNode) {
  for (const figure of root.querySelectorAll<HTMLElement>("figure:has(figcaption)")) {
    figure.classList.add("md-explicit-figure");
    for (const image of figure.querySelectorAll("img")) {
      const failed = () => {
        if (figure.querySelector(".md-image-unavailable")) return;
        const note = document.createElement("span"); note.className = "md-image-unavailable"; note.setAttribute("role", "status");
        note.textContent = `Image unavailable · ${image.alt || "Image"}`; image.hidden = true; image.after(note);
      };
      image.addEventListener("error", failed, {once:true});
      if (image.complete && image.naturalWidth === 0) failed();
    }
  }
}

/** Native hosts handle this user action on their pasteboard; SDKs use the browser clipboard. */
export async function copySource(text: string, trigger: HTMLElement) {
  const request = new CustomEvent("tegg-copy-text", {detail:text, bubbles:true, cancelable:true});
  if (!trigger.dispatchEvent(request)) return;
  try {await navigator.clipboard.writeText(text);} catch {
    const status=document.createElement("span");status.setAttribute("role","status");setUIText(status, "Copy unavailable. Select the source to copy.");
    trigger.parentElement?.append(status);
  }
}
