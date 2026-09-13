import {setUIText, setUILabel} from "./uiContext";
import {copySource, action, openObjectViewer, scopeIds, enhanceFigures} from "./renderInteraction";
import { makeHorizontalScrollRegion } from "./localScroll";
import DOMPurify from "dompurify";
import {enginesFor, type RenderEngines} from "./renderEngines";

import { applyCalloutAppearance, calloutIcon } from "./callouts";
import { resolveLocalImageSource } from "./profile";

export type RenderModel =
  | { kind: "code"; source: string; language: string }
  | { kind: "math"; source: string; display: "inline" | "block" }
  | { kind: "diagram"; source: string; engine: "mermaid" | "dot" | "graphviz" }
  | { kind: "html"; source: string; display: "inline" | "block" };

export type RenderAction = {
  label: string;
  run: () => void;
};

export const renderClassNames = {
  block: "md-render-block",
  toolbar: "md-render-toolbar",
  properties: "md-render-properties",
  heading: "md-render-heading",
  paragraph: "md-render-paragraph",
  strong: "md-render-strong",
  emphasis: "md-render-emphasis",
  strike: "md-render-strike",
  inlineCode: "md-render-inline-code",
  link: "md-render-link",
  wikiLink: "md-render-wikilink",
  quote: "md-render-quote",
  listItem: "md-render-list-item",
  listMarker: "md-render-list-marker",
  task: "md-render-task",
  rule: "md-render-rule",
  table: "md-render-table",
  image: "md-render-image",
  footnoteRef: "md-render-footnote-ref",
  footnoteDefinition: "md-render-footnote-definition",
  definitionTerm: "md-render-definition-term",
  definitionDescription: "md-render-definition-description",
  highlight: "md-render-highlight",
  subscript: "md-render-subscript",
  superscript: "md-render-superscript",
  code: "md-render-code",
  mathInline: "md-render-math-inline",
  mathBlock: "md-render-math-block",
  diagram: "md-render-diagram",
  canvas: "md-render-canvas",
  htmlInline: "md-render-html-inline",
  htmlBlock: "md-render-html-block",
  callout: "md-render-callout",
} as const;

export const safeHtmlOptions = {
  USE_PROFILES: { html: true },
  // Preserve explicit local URLs long enough to rewrite images to app-file.
  // Other schemes retain DOMPurify's default allowlist; unknown schemes stay blocked.
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|file|app-file):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "button", "template"],
  FORBID_ATTR: ["style", "onerror", "onclick", "onload", "formaction"],
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function sanitizeRenderedHtml(value: string, documentPath = "",
  resolveImage: (src: string, path: string) => string = () => ""): string {
  const fragment = DOMPurify.sanitize(value, {...safeHtmlOptions, RETURN_DOM_FRAGMENT: true});
  for (const element of fragment.querySelectorAll("[srcset], [ping]")) {element.removeAttribute("srcset"); element.removeAttribute("ping");}
  for (const node of fragment.querySelectorAll("[data-tegg-slot], [data-tegg-resource-src], [data-tegg-resource-poster], [data-tegg-ui-text], [data-tegg-ui-label]")) {
    node.removeAttribute("data-tegg-slot");
    node.removeAttribute("data-tegg-ui-text"); node.removeAttribute("data-tegg-ui-label");
    node.removeAttribute("data-tegg-resource-src"); node.removeAttribute("data-tegg-resource-poster");
  }
  let resourceIndex = 0;
  for (const element of fragment.querySelectorAll<HTMLElement>("[src], [poster]")) {
    for (const attribute of ["src", "poster"]) {
      const raw = element.getAttribute(attribute); if (raw == null) continue;
      const resolved = resolveImage(raw, documentPath);
      element.setAttribute(`data-tegg-resource-${attribute}`, String(resourceIndex++));
      if (resolved && !/^[\u0000-\u0020]*(?:javascript|vbscript):/i.test(resolved)) element.setAttribute(attribute, resolved);
      else {element.removeAttribute(attribute); element.dataset.resourceState = "blocked";}
    }
  }
  const container = document.createElement("div");
  container.append(fragment);
  return container.innerHTML;
}

export function applySemanticClasses(root: ParentNode): void {
  for (const heading of root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")) {
    heading.classList.add(renderClassNames.heading, `${renderClassNames.heading}-${heading.tagName.slice(1)}`);
  }
  for (const paragraph of root.querySelectorAll("p")) paragraph.classList.add(renderClassNames.paragraph);
  for (const strong of root.querySelectorAll("strong")) strong.classList.add(renderClassNames.strong);
  for (const emphasis of root.querySelectorAll("em")) emphasis.classList.add(renderClassNames.emphasis);
  for (const strike of root.querySelectorAll("s, del")) strike.classList.add(renderClassNames.strike);
  for (const code of root.querySelectorAll("code:not(pre code)")) code.classList.add(renderClassNames.inlineCode);
  for (const link of root.querySelectorAll("a")) link.classList.add(renderClassNames.link);
  for (const wikiLink of root.querySelectorAll(".wikilink")) wikiLink.classList.add(renderClassNames.wikiLink);
  for (const quote of root.querySelectorAll("blockquote")) quote.classList.add(renderClassNames.quote);
  for (const item of root.querySelectorAll("li")) item.classList.add(renderClassNames.listItem);
  for (const task of root.querySelectorAll(".task-list-item input")) task.classList.add(renderClassNames.task);
  for (const rule of root.querySelectorAll("hr")) rule.classList.add(renderClassNames.rule);
  for (const table of root.querySelectorAll("table")) table.classList.add(renderClassNames.table);
  for (const image of root.querySelectorAll("img")) image.classList.add(renderClassNames.image);
  for (const reference of root.querySelectorAll(".footnote-ref")) reference.classList.add(renderClassNames.footnoteRef);
  for (const definition of root.querySelectorAll(".footnote-item")) definition.classList.add(renderClassNames.footnoteDefinition);
  for (const term of root.querySelectorAll("dt")) term.classList.add(renderClassNames.definitionTerm);
  for (const description of root.querySelectorAll("dd")) description.classList.add(renderClassNames.definitionDescription);
  for (const highlight of root.querySelectorAll("mark")) highlight.classList.add(renderClassNames.highlight);
  for (const subscript of root.querySelectorAll("sub")) subscript.classList.add(renderClassNames.subscript);
  for (const superscript of root.querySelectorAll("sup")) superscript.classList.add(renderClassNames.superscript);
}

export function enhanceCallouts(root: ParentNode): void {
  for (const quote of root.querySelectorAll<HTMLElement>("blockquote.callout[data-callout]")) {
    const type = quote.dataset.callout!;
    applyCalloutAppearance(quote, type);
    quote.setAttribute("aria-label", `${type} callout`);
    const title = quote.querySelector<HTMLElement>(":scope > .callout-title");
    if (title && !title.querySelector(":scope > .callout-icon")) title.prepend(calloutIcon(type));
  }
}

export function highlightCode(source: string, language: string, engines: RenderEngines = enginesFor()): string {
  return engines.highlight?.(source, language.trim().toLowerCase()) ?? escapeHtml(source);
}

export function createRenderToolbar(labelText: string, action: RenderAction): HTMLDivElement {
  const toolbar = document.createElement("div");
  toolbar.className = renderClassNames.toolbar;
  const label = document.createElement("span");
  label.textContent = labelText;
  const button = document.createElement("button");
  button.type = "button";
  setUIText(button, action.label);
  button.addEventListener("click", action.run);
  toolbar.append(label, button);
  return toolbar;
}

export function createCodeBlock(
  model: Extract<RenderModel, { kind: "code" }>,
  action: RenderAction,
  engines?: RenderEngines,
): HTMLElement {
  const wrapper = document.createElement("section");
  wrapper.className = `${renderClassNames.block} ${renderClassNames.code}`;
  const language = model.language.trim().toLowerCase() || "text";
  wrapper.append(createRenderToolbar(language, action));

  const pre = document.createElement("pre");
  makeHorizontalScrollRegion(pre, "Code. Scroll horizontally for long lines.");
  const code = document.createElement("code");
  code.className = `language-${language}`;
  code.innerHTML = highlightCode(model.source, language, engines);
  pre.append(code);
  wrapper.append(pre);
  return wrapper;
}

export function renderMathInto(
  target: HTMLElement,
  model: Extract<RenderModel, { kind: "math" }>,
): void {
  target.classList.add(model.display === "block" ? renderClassNames.mathBlock : renderClassNames.mathInline);
  if (model.display === "block") makeHorizontalScrollRegion(target, "Math. Scroll horizontally for long expressions.");
  target.dataset.texSource = model.source;
  target.dataset.renderState = "ready";
  try {
    const engine = enginesFor(target).math;
    if (engine) target.innerHTML = engine(model.source, model.display);
    else {target.textContent = model.source; target.dataset.renderState = "unavailable";}
  } catch (error) {
    target.dataset.renderState = "error";
    const message = document.createElement("span"); message.className = "md-math-error";
    setUIText(message, "Could not render formula"); message.title = error instanceof Error ? error.message : "Invalid TeX";
    const source = document.createElement("code"); source.textContent = model.source;
    target.replaceChildren(message, source);
  }
  if (model.display === "block" && !target.closest('[data-enhancements="false"]')) {
    const controls = document.createElement("div"); controls.className = "md-object-actions";
    const view = action("View formula", () => openObjectViewer(view, target, model.source, "Formula"));
    controls.append(view, action("Copy TeX", () => {void copySource(model.source, target);})); target.append(controls);
  }
}

export function createHtmlPreview(
  model: Extract<RenderModel, { kind: "html" }>,
  renderedSource = model.source,
  resources?: {documentPath: string; resolveImage?: (src: string, path: string) => string},
): HTMLElement {
  const wrapper = document.createElement(model.display === "block" ? "section" : "span");
  wrapper.className = model.display === "block" ? renderClassNames.htmlBlock : renderClassNames.htmlInline;
  wrapper.innerHTML = sanitizeRenderedHtml(renderedSource, resources?.documentPath, resources?.resolveImage);
  enhanceMathTokens(wrapper); enhanceFigures(wrapper);
  return wrapper;
}


export function enhanceMathTokens(root: ParentNode) {
  let rendered = 0;
  for (const target of root.querySelectorAll<HTMLElement>("[data-tegg-math][data-tex]")) {
    const source = target.dataset.tex ?? "", display = target.dataset.teggMath === "block" ? "block" : "inline";
    target.removeAttribute("data-tegg-math"); target.removeAttribute("data-tex");
    if (++rendered > 128 || source.length > 16384) {
      target.dataset.texSource=source; target.dataset.renderState="deferred"; target.textContent=source;
      if(source.length <= 16384 && !target.closest('[data-enhancements="false"]')) target.append(action("Preview formula",()=>renderMathInto(target,{kind:"math",source,display})));
      continue;
    }
    renderMathInto(target, {kind: "math", source, display});
    if (display === "inline" && !target.closest('[data-enhancements="false"]')) {
      target.tabIndex = 0;
      target.setAttribute("aria-haspopup", "dialog");
      target.addEventListener("click", event => {event.stopPropagation(); openObjectViewer(target, target, source, "Formula");});
      target.addEventListener("keydown", event => {if (event.key === "Enter") {event.preventDefault(); event.stopPropagation(); openObjectViewer(target, target, source, "Formula");}});
    }
  }
}

/** Diagram SVG is untrusted output: keep local references, never remote fetches. */
export function sanitizeDiagramSvg(svg: string): DocumentFragment {
  const fragment = DOMPurify.sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true},ADD_TAGS:["foreignObject"],RETURN_DOM_FRAGMENT:true});
  for(const element of fragment.querySelectorAll("*")) {
    for(const attr of [...element.attributes]) {
      if(attr.name.startsWith("data-tegg-ui-") || attr.name === "data-tegg-slot") element.removeAttribute(attr.name);
      if(["href","xlink:href","src","poster"].includes(attr.name) && !attr.value.startsWith("#")) element.removeAttribute(attr.name);
      if(attr.name === "style" && unsafeSvgStyle(attr.value)) element.removeAttribute("style");
    }
    if(element.tagName.toLowerCase() === "style" && unsafeSvgStyle(element.textContent ?? "")) element.remove();
  }
  return fragment;
}
function unsafeSvgStyle(value: string) {
  const withoutLocalUrls = value.replace(/url\(\s*(["']?)#[\w:.-]+\1\s*\)/gi, "");
  return /url\s*\(|image-set\s*\(|src\s*\(|@|\\/i.test(withoutLocalUrls);
}

let mermaidPending = 0;
let diagramQueue: Promise<void> = Promise.resolve();
const diagramGeneration = new WeakMap<HTMLElement, object>();
export function renderDiagram(model: Extract<RenderModel, {kind: "diagram"}>, target: HTMLElement, isCurrent?: () => boolean): Promise<void> {
  const engines = enginesFor(target);
  if ((model.engine === "mermaid" && !engines.mermaid) || (model.engine !== "mermaid" && !engines.graphviz)) {
    target.dataset.renderState = "unavailable"; target.textContent = model.source; return Promise.resolve();
  }
  const generation = {}; diagramGeneration.set(target, generation);
  target.dataset.engine = model.engine; target.dataset.renderState = "pending";
  target.classList.add(renderClassNames.canvas); target.classList.remove("diagram-error"); setUIText(target, "Rendering\u2026");
  const wasConnected = target.isConnected;
  const current = () => diagramGeneration.get(target) === generation && (isCurrent ? isCurrent() : !wasConnected || target.isConnected);
  let expired = false;
  let finishBudget: () => void = () => {};
  const waitingBudget = new Promise<void>(resolve => {finishBudget = resolve;});
  // Include queue waiting in the readiness budget. The engine may continue in the background.
  const timer = window.setTimeout(() => {
    expired = true;
    if (current()) {target.dataset.renderState = "over-budget"; setUIText(target, "Diagram preview exceeded its waiting budget. Source remains available.");}
    finishBudget();
  }, 4000);
  const run = async () => {
    if (!current() || expired) {window.clearTimeout(timer); return;}
    try {
      if (new TextEncoder().encode(model.source).byteLength > 64 * 1024) {
        target.dataset.renderState = "over-budget"; setUIText(target, "Diagram is too large to preview. Its source remains available."); return;
      }
      const engine = model.engine === "mermaid" ? engines.mermaid! : engines.graphviz!;
      const svg = await engine(model.source, target, () => current() && !expired);
      if (!current() || expired) return;
      if (svg.length > 2_000_000) throw new Error("Diagram output exceeds the preview budget.");
      delete target.dataset.teggUiText;
      target.replaceChildren(sanitizeDiagramSvg(svg));
      scopeIds(target); target.dataset.renderState = "ready";
      const graphic = target.querySelector("svg");
      const title = graphic?.querySelector("title"), description = graphic?.querySelector("desc");
      if (graphic && (title || description)) {
        graphic.setAttribute("role", "img");
        if (title) {title.id ||= `title-${crypto.randomUUID()}`; graphic.setAttribute("aria-labelledby", title.id);}
        if (description) {description.id ||= `desc-${crypto.randomUUID()}`; graphic.setAttribute("aria-describedby", description.id);}
        target.removeAttribute("role"); target.removeAttribute("aria-label");
      }
      if (!target.closest('[data-enhancements="false"]')) {
        const controls = document.createElement("div"); controls.className = "md-object-actions";
        const view = action("View diagram", () => openObjectViewer(view, target, model.source, "Diagram"));
        controls.append(view); target.append(controls);
      }
    } catch (error) {
      if (!current() || expired) return;
      target.dataset.renderState = "error"; target.classList.add("diagram-error");
      delete target.dataset.teggUiText;
      target.textContent = error instanceof Error ? error.message : "Could not render diagram";
    } finally {window.clearTimeout(timer);}
  };
  let result: Promise<void>;
  if (model.engine === "mermaid") {
    if (mermaidPending >= 24) {
      window.clearTimeout(timer); target.dataset.renderState = "over-budget";
      setUIText(target, "Too many diagrams. Split this document into smaller sections.");
      return Promise.resolve();
    }
    mermaidPending++;
    result = diagramQueue.then(run).finally(() => {mermaidPending--;});
    diagramQueue = result.catch(() => {});
  } else result = run();
  return Promise.race([result, waitingBudget]);
}
