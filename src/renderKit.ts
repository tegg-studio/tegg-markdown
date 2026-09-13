import {copySource, action, openObjectViewer, scopeIds, enhanceFigures} from "./renderInteraction";
import { makeHorizontalScrollRegion } from "./localScroll";
import DOMPurify from "dompurify";
import hljs from "highlight.js";
import katex from "katex";
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
  resolveImage: (src: string, path: string) => string = resolveLocalImageSource): string {
  const fragment = DOMPurify.sanitize(value, {...safeHtmlOptions, RETURN_DOM_FRAGMENT: true});
  for (const element of fragment.querySelectorAll("[srcset]")) element.removeAttribute("srcset");
  for (const image of fragment.querySelectorAll<HTMLImageElement>("img[src]")) {
    image.setAttribute("src", resolveImage(image.getAttribute("src")!, documentPath));
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

export function highlightCode(source: string, language: string): string {
  const normalizedLanguage = language.trim().toLowerCase();
  if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
    return hljs.highlight(source, { language: normalizedLanguage, ignoreIllegals: true }).value;
  }
  return escapeHtml(source);
}

export function createRenderToolbar(labelText: string, action: RenderAction): HTMLDivElement {
  const toolbar = document.createElement("div");
  toolbar.className = renderClassNames.toolbar;
  const label = document.createElement("span");
  label.textContent = labelText;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = action.label;
  button.addEventListener("click", action.run);
  toolbar.append(label, button);
  return toolbar;
}

export function createCodeBlock(
  model: Extract<RenderModel, { kind: "code" }>,
  action: RenderAction,
): HTMLElement {
  const wrapper = document.createElement("section");
  wrapper.className = `${renderClassNames.block} ${renderClassNames.code}`;
  const language = model.language.trim().toLowerCase() || "text";
  wrapper.append(createRenderToolbar(language, action));

  const pre = document.createElement("pre");
  makeHorizontalScrollRegion(pre, "Code. Scroll horizontally for long lines.");
  const code = document.createElement("code");
  code.className = `language-${language}`;
  code.innerHTML = highlightCode(model.source, language);
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
    target.innerHTML = katex.renderToString(model.source, {
      displayMode: model.display === "block", throwOnError: true, strict: false,
      trust: false, maxExpand: 1000, maxSize: 20, macros: {}, output: "htmlAndMathml",
    });
  } catch (error) {
    target.dataset.renderState = "error";
    const message = document.createElement("span"); message.className = "md-math-error";
    message.textContent = "Could not render formula"; message.title = error instanceof Error ? error.message : "Invalid TeX";
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
): HTMLElement {
  const wrapper = document.createElement(model.display === "block" ? "section" : "span");
  wrapper.className = model.display === "block" ? renderClassNames.htmlBlock : renderClassNames.htmlInline;
  wrapper.innerHTML = sanitizeRenderedHtml(renderedSource);
  enhanceMathTokens(wrapper); enhanceFigures(wrapper);
  return wrapper;
}


export function enhanceMathTokens(root: ParentNode) {
  for (const target of root.querySelectorAll<HTMLElement>("[data-tegg-math][data-tex]")) {
    const source = target.dataset.tex ?? "", display = target.dataset.teggMath === "block" ? "block" : "inline";
    target.removeAttribute("data-tegg-math"); target.removeAttribute("data-tex");
    renderMathInto(target, {kind: "math", source, display});
    if (display === "inline" && !target.closest('[data-enhancements="false"]')) {
      target.tabIndex = 0;
      target.setAttribute("aria-haspopup", "dialog");
      target.addEventListener("click", event => {event.stopPropagation(); openObjectViewer(target, target, source, "Formula");});
      target.addEventListener("keydown", event => {if (event.key === "Enter") {event.preventDefault(); event.stopPropagation(); openObjectViewer(target, target, source, "Formula");}});
    }
  }
}

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
let mermaidTheme = "";
async function diagramMermaid(target: HTMLElement) {
  mermaidPromise ??= import("mermaid").then(module => module.default);
  const mermaid = await mermaidPromise;
  const surface = target.closest<HTMLElement>(".tegg-surface") ?? target;
  const explicit = surface.dataset.theme;
  const color = getComputedStyle(surface).getPropertyValue("--background").trim();
  const rgb = color.startsWith("#") ? color.slice(1).match(/.{2}/g)?.map(x => parseInt(x,16)) : color.match(/[\d.]+/g)?.slice(0,3).map(Number);
  const dark = explicit ? explicit === "dark" : rgb?.length === 3 ? rgb.reduce((a,b) => a+b, 0) < 384 : window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const theme = dark ? "dark" : "neutral";
  if (mermaidTheme !== theme) mermaid.initialize({
    startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true,
    theme, maxEdges: 500, maxTextSize: 64 * 1024,
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
  });
  mermaidTheme = theme;
  return mermaid;
}

let mermaidPending = 0;
let diagramQueue: Promise<void> = Promise.resolve();
const diagramGeneration = new WeakMap<HTMLElement, object>();
export function renderDiagram(model: Extract<RenderModel, {kind: "diagram"}>, target: HTMLElement, isCurrent?: () => boolean): Promise<void> {
  const generation = {}; diagramGeneration.set(target, generation);
  target.dataset.engine = model.engine; target.dataset.renderState = "pending";
  target.classList.add(renderClassNames.canvas); target.classList.remove("diagram-error"); target.textContent = "Rendering…";
  const wasConnected = target.isConnected;
  const current = () => diagramGeneration.get(target) === generation && (isCurrent ? isCurrent() : !wasConnected || target.isConnected);
  let expired = false;
  let finishBudget: () => void = () => {};
  const waitingBudget = new Promise<void>(resolve => {finishBudget = resolve;});
  // Include queue waiting in the readiness budget. The engine may continue in the background.
  const timer = window.setTimeout(() => {
    expired = true;
    if (current()) {target.dataset.renderState = "over-budget"; target.textContent = "Diagram preview exceeded its waiting budget. Source remains available.";}
    finishBudget();
  }, 4000);
  const run = async () => {
    if (!current() || expired) {window.clearTimeout(timer); return;}
    try {
      if (new TextEncoder().encode(model.source).byteLength > 64 * 1024) {
        target.dataset.renderState = "over-budget"; target.textContent = "Diagram is too large to preview. Its source remains available."; return;
      }
      let svg: string;
      if (model.engine === "mermaid") {
        const mermaid = await diagramMermaid(target);
        if (!current()) return;
        svg = (await mermaid.render(`mermaid-${crypto.randomUUID()}`, model.source)).svg;
      } else {
        const {graphvizRenderer} = await import("./graphviz");
        if (!current()) return;
        svg = await graphvizRenderer.render(model.source, () => current() && !expired);
      }
      if (!current() || expired) return;
      if (svg.length > 2_000_000) throw new Error("Diagram output exceeds the preview budget.");
      target.innerHTML = DOMPurify.sanitize(svg, {USE_PROFILES: {svg: true, svgFilters: true}, ADD_TAGS: ["foreignObject"]});
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
      target.textContent = error instanceof Error ? error.message : "Could not render diagram";
    } finally {window.clearTimeout(timer);}
  };
  let result: Promise<void>;
  if (model.engine === "mermaid") {
    if (mermaidPending >= 24) {
      window.clearTimeout(timer); target.dataset.renderState = "over-budget";
      target.textContent = "Too many diagrams. Split this document into smaller sections.";
      return Promise.resolve();
    }
    mermaidPending++;
    result = diagramQueue.then(run).finally(() => {mermaidPending--;});
    diagramQueue = result.catch(() => {});
  } else result = run();
  return Promise.race([result, waitingBudget]);
}
