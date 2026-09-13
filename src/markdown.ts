import {bindEngines, enginesFor} from "./renderEngines";
import {setUIText, setUILabel} from "./uiContext";
import {type MarkdownProfile} from "./syntaxProfiles";
import { createMetadataPanel, disposeMetadataPanel } from "./metadata";
import {copySource, disposeInteractions, scopeIds, enhanceFigures} from "./renderInteraction";
import {enhanceFootnotes} from "./footnotes";
import { makeHorizontalScrollRegion } from "./localScroll";
import { parserFor, markdownParser as md } from "./markdownParser";
import { enhanceRenderedLinks } from "./renderedLinks";
import { extractFrontmatter } from "./profile";
import {
  applySemanticClasses,
  createCodeBlock,
  enhanceCallouts,
  escapeHtml,
  renderClassNames,
  renderDiagram,
  enhanceMathTokens,
  sanitizeRenderedHtml,
} from "./renderKit";

export { extractFrontmatter, parseWikiLink } from "./profile";
export { renderDiagram } from "./renderKit";

export type ReaderContentState = "streaming" | "settled";
export type ReaderEvent =
  | { type: "openLink"; href: string }
  | { type: "copyCode"; language: string; code: string };

export type RenderMarkdownOptions = {
  profile?: MarkdownProfile;
  /** Reuse independently rendered blocks within one document. */
  reuseKey?: string;
  signal?: AbortSignal;
  interactionSignal?: AbortSignal;
  enhancedInteractions?: boolean;
  documentPath?: string;
  resolveImage?: (src: string, documentPath: string) => string;
  contentState?: ReaderContentState;
  onOpenLink?: (href: string) => void;
  /** Hosts can schedule expensive diagrams after the initial readable content. */
  scheduleDiagram?: (target: HTMLElement, source: string, render: () => Promise<void>) => void;
  onEvent?: (event: ReaderEvent) => void;
};

const configured = new WeakSet<object>();
function rendererFor(profile: MarkdownProfile = "tegg") {
  const parser = parserFor(profile);
  if (configured.has(parser)) return parser;
  configured.add(parser);
  const fallback = parser.renderer.rules.fence?.bind(parser.renderer.rules);
  parser.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index], language = token.info.trim().split(/\s+/)[0].toLowerCase();
    if (profile !== "gfm" && (language === "mermaid" || (profile === "tegg" && ["dot", "graphviz"].includes(language)))) {
      return `<figure class="diagram ${renderClassNames.block} ${renderClassNames.diagram}" data-diagram="${language}"><pre class="diagram-source"><code>${escapeHtml(token.content)}</code></pre><div class="diagram-canvas ${renderClassNames.canvas}" role="img" aria-label="${language} diagram"></div></figure>`;
    }
    if (profile !== "gfm" && language === "math") return `<div data-tegg-math="block" data-tex="${parser.utils.escapeHtml(token.content)}"></div>`;
    return fallback ? fallback(tokens, index, options, env, self) : "";
  };
  return parser;
}
rendererFor();


async function enhanceDiagrams(root: HTMLElement, contentState: ReaderContentState, schedule?: RenderMarkdownOptions["scheduleDiagram"], signal?: AbortSignal, selected?: HTMLElement[]) {
  const figures = selected ?? Array.from(root.querySelectorAll<HTMLElement>(".diagram"));
  for (const figure of figures) {
    const pre = figure.querySelector<HTMLElement>(".diagram-source");
    if (!pre) continue;
    const details = document.createElement("details");
    details.className = "md-diagram-source";
    const summary = document.createElement("summary");
    setUIText(summary, "Diagram source");
    pre.tabIndex = 0;
    details.append(summary, pre); figure.append(details);
  }
  if (contentState === "streaming") {
    for (const figure of figures) {
      const canvas = figure.querySelector<HTMLElement>(".diagram-canvas");
      if (canvas) {
        canvas.classList.add("diagram-pending");
        setUIText(canvas, "Content is still being generated. The diagram will render when it is complete.");
      }
    }
    return;
  }
  await Promise.all(figures.map(async (figure) => {
    const kind = figure.dataset.diagram ?? "mermaid";
    const source = figure.querySelector("code")?.textContent ?? "";
    const canvas = figure.querySelector<HTMLElement>(".diagram-canvas");
    if (!canvas) return;
    const render = () => renderDiagram({
      kind: "diagram",
      engine: kind === "dot" || kind === "graphviz" ? kind : "mermaid",
      source,
    }, canvas, () => !signal?.aborted && root.contains(canvas));
    if (schedule) schedule(canvas, source, render);
    else await render();
  }));
}

function secureLinks(root: HTMLElement, options: RenderMarkdownOptions) {
  enhanceRenderedLinks(root, href => {
    options.onOpenLink?.(href);
    options.onEvent?.({type: "openLink", href});
  }, interactionRoots.get(root) ?? root);
}

function enhanceCodeBlocks(root: HTMLElement, options: RenderMarkdownOptions) {
  for (const pre of root.querySelectorAll<HTMLPreElement>("pre")) {
    if (pre.closest(".diagram-source, .frontmatter")) continue;
    const code = pre.querySelector("code")?.textContent ?? "";
    const languageClass = pre.querySelector("code")?.className.match(/language-([\w+-]+)/)?.[1] ?? "text";
    const wrapper = createCodeBlock({ kind: "code", source: code, language: languageClass }, {
      label: "Copy",
      run: async () => {
        const copy = wrapper.querySelector("button");
        await copySource(code, wrapper);
        if (!wrapper.isConnected || options.interactionSignal?.aborted) return;
        if (copy) {
          setUIText(copy, "Copied");
          const timer = window.setTimeout(() => {if(copy.isConnected) setUIText(copy, "Copy");}, 1200);
          options.interactionSignal?.addEventListener("abort",()=>window.clearTimeout(timer),{once:true});
        }
        options.onEvent?.({ type: "copyCode", language: languageClass, code });
      },
    }, enginesFor(root));
    wrapper.classList.add("code-block");
    wrapper.querySelector(`.${renderClassNames.toolbar}`)?.classList.add("code-toolbar");
    pre.replaceWith(wrapper);
  }
}

function secureTaskInputs(root: HTMLElement) {
  for (const input of root.querySelectorAll<HTMLInputElement>("input")) {
    if (input.type !== "checkbox") {
      input.remove();
      continue;
    }
    input.disabled = true;
    input.tabIndex = -1;
    input.removeAttribute("aria-hidden");
    input.setAttribute("aria-label", input.closest("li")?.textContent?.trim() || "Task");
  }
}

const interactionRoots = new WeakMap<HTMLElement, HTMLElement>();
const blockCaches = new WeakMap<HTMLElement, {key: string; blocks: Array<{raw: string; node: Node}>}>();
/** Reuse is deliberately limited to blocks without cross-block IDs, resources or custom ownership. */
function independentBlock(node: Node) {
  if (!(node instanceof HTMLElement)) return true;
  if(node.tagName === "P" && !node.attributes.length && !node.childElementCount) return true;
  return !node.matches(".frontmatter, .footnotes, [id], [src], [poster]") && !node.querySelector('[id], [src], [poster], [href^="#"], [data-tegg-math], .footnote-ref');
}
export async function renderMarkdown(source: string, root: HTMLElement, options: RenderMarkdownOptions = {}) {
  if (options.signal?.aborted) return;
  if (new TextEncoder().encode(source).byteLength >= 1024 * 1024) {
    disposeInteractions(root); root.querySelectorAll<HTMLElement>(".frontmatter").forEach(disposeMetadataPanel);
    blockCaches.delete(root); const status=document.createElement("p"), pre=document.createElement("pre");
    setUIText(status,"Large document: source preview is shown to keep the interface responsive."); status.setAttribute("role","status"); pre.textContent=source; pre.className="tegg-source-fallback"; makeHorizontalScrollRegion(pre,"Markdown source. Scroll to read the complete document.");
    root.replaceChildren(status,pre); root.dataset.renderState="source-fallback"; return;
  }
  delete root.dataset.renderState;
  root.dataset.enhancements = String(options.enhancedInteractions !== false);
  const {metadata, body} = options.profile && options.profile !== "tegg" ? {metadata: null, body: source} : extractFrontmatter(source);
  const raw = rendererFor(options.profile).render(body, {outline: true, profile: options.profile ?? "tegg"});
  const work = document.createElement("div"); work.className = root.className; work.dataset.enhancements = root.dataset.enhancements;
  const stopEngines = bindEngines(work, enginesFor(root)); interactionRoots.set(work, root);
  work.innerHTML = sanitizeRenderedHtml(raw, options.documentPath, options.resolveImage);
  if (metadata) work.prepend(createMetadataPanel(metadata));
  const key = `${options.reuseKey ?? ""}:${options.profile ?? "tegg"}:${options.enhancedInteractions}`;
  const previous = options.reuseKey !== undefined && blockCaches.get(root)?.key === key ? blockCaches.get(root)!.blocks : [];
  const candidates = new Map<string,{nodes:Node[]; index:number}>();
  for(const item of previous) {let group=candidates.get(item.raw); if(!group) candidates.set(item.raw,group={nodes:[],index:0});group.nodes.push(item.node);}
  const entries = Array.from(work.childNodes, node => {
    const raw = node instanceof HTMLElement ? node.tagName === "P" && !node.attributes.length && !node.childElementCount ? "plain-paragraph:" + node.textContent : node.outerHTML : node.textContent ?? "";
    const reusable = independentBlock(node) && !(node instanceof HTMLElement && node.matches(".diagram") && options.contentState === "streaming");
    const group = reusable ? candidates.get(raw) : undefined;
    let old: Node | undefined;
    while(group && group.index < group.nodes.length) {
      const candidate=group.nodes[group.index++];
      if(candidate.parentNode === root && !(candidate instanceof HTMLElement && candidate.childElementCount && candidate.querySelector('[data-render-state="pending"], .diagram-pending'))) {old=candidate;break;}
    }
    if(old) {const placeholder=document.createComment("retained block");node.replaceWith(placeholder);return {raw,node:old,placeholder,reusable};}
    return {raw, node, placeholder: undefined, reusable};
  });
  scopeIds(work); applySemanticClasses(work); enhanceCallouts(work); enhanceMathTokens(work); enhanceFigures(work); enhanceCodeBlocks(work, options);
  for (const table of work.querySelectorAll("table")) {
    const region = document.createElement("div"); region.className = "md-table-scroll";
    makeHorizontalScrollRegion(region, "Table. Scroll horizontally for more columns."); table.replaceWith(region); region.append(table);
  }
  secureTaskInputs(work); enhanceFootnotes(work, href => options.onOpenLink?.(href), options.enhancedInteractions !== false); secureLinks(work, options);
  const diagrams = Array.from(work.querySelectorAll<HTMLElement>(".diagram"));
  const enhanced = Array.from(work.childNodes);
  const next = entries.map((entry,index) => ({...entry, node: entry.placeholder ? entry.node : enhanced[index]}));
  // Keep retained nodes in place: moving through a detached staging tree loses focus.
  const keep = new Set(next.map(entry => entry.node));
  for (const node of Array.from(root.childNodes)) if (!keep.has(node)) {
    if (node instanceof HTMLElement) {disposeInteractions(node); if(node.matches(".frontmatter")) disposeMetadataPanel(node);}
    node.remove();
  }
  if (!root.hasChildNodes()) {
    // Transfer the staging subtree in one native operation, retaining listeners.
    const range = document.createRange(); range.selectNodeContents(work);
    root.append(range.extractContents());
  } else {
    let cursor = root.firstChild;
    for (const entry of next) {if (entry.node === cursor) cursor = cursor.nextSibling; else root.insertBefore(entry.node,cursor);}
  }
  stopEngines();
  blockCaches.set(root, {key, blocks: next.filter(entry => entry.reusable).map(({raw,node}) => ({raw,node}))});
  await enhanceDiagrams(root, options.contentState ?? "settled", options.scheduleDiagram, options.signal, diagrams);
}
