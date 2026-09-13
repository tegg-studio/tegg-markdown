import { createMetadataPanel, disposeMetadataPanel } from "./metadata";
import {disposeInteractions, scopeIds, enhanceFigures} from "./renderInteraction";
import {enhanceFootnotes} from "./footnotes";
import { makeHorizontalScrollRegion } from "./localScroll";
import { markdownParser as md } from "./markdownParser";
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
  enhancedInteractions?: boolean;
  documentPath?: string;
  resolveImage?: (src: string, documentPath: string) => string;
  contentState?: ReaderContentState;
  onOpenLink?: (href: string) => void;
  /** Hosts can schedule expensive diagrams after the initial readable content. */
  scheduleDiagram?: (target: HTMLElement, source: string, render: () => Promise<void>) => void;
  onEvent?: (event: ReaderEvent) => void;
};

const defaultFence = md.renderer.rules.fence?.bind(md.renderer.rules);
md.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const language = token.info.trim().split(/\s+/)[0].toLowerCase();
  if (["mermaid", "dot", "graphviz"].includes(language)) {
    return `<figure class="diagram ${renderClassNames.block} ${renderClassNames.diagram}" data-diagram="${language}"><pre class="diagram-source"><code>${escapeHtml(token.content)}</code></pre><div class="diagram-canvas ${renderClassNames.canvas}" role="img" aria-label="${language} diagram"></div></figure>`;
  }
  return defaultFence ? defaultFence(tokens, index, options, env, self) : "";
};


async function enhanceDiagrams(root: HTMLElement, contentState: ReaderContentState, schedule?: RenderMarkdownOptions["scheduleDiagram"]) {
  const figures = Array.from(root.querySelectorAll<HTMLElement>(".diagram"));
  for (const figure of figures) {
    const pre = figure.querySelector<HTMLElement>(".diagram-source");
    if (!pre) continue;
    const details = document.createElement("details");
    details.className = "md-diagram-source";
    const summary = document.createElement("summary");
    summary.textContent = "Diagram source";
    pre.tabIndex = 0;
    details.append(summary, pre); figure.append(details);
  }
  if (contentState === "streaming") {
    for (const figure of figures) {
      const canvas = figure.querySelector<HTMLElement>(".diagram-canvas");
      if (canvas) {
        canvas.classList.add("diagram-pending");
        canvas.textContent = "Content is still being generated. The diagram will render when it is complete.";
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
    }, canvas, () => root.contains(canvas));
    if (schedule) schedule(canvas, source, render);
    else await render();
  }));
}

function secureLinks(root: HTMLElement, options: RenderMarkdownOptions) {
  enhanceRenderedLinks(root, href => {
    options.onOpenLink?.(href);
    options.onEvent?.({type: "openLink", href});
  });
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
        await navigator.clipboard?.writeText(code);
        if (copy) {
          copy.textContent = "Copied";
          window.setTimeout(() => { copy.textContent = "Copy"; }, 1200);
        }
        options.onEvent?.({ type: "copyCode", language: languageClass, code });
      },
    });
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

export async function renderMarkdown(source: string, root: HTMLElement, options: RenderMarkdownOptions = {}) {
  disposeInteractions(root);
  root.dataset.enhancements = String(options.enhancedInteractions !== false);
  const { metadata, body } = extractFrontmatter(source);
  root.querySelectorAll<HTMLElement>(".frontmatter").forEach(disposeMetadataPanel);
  const raw = md.render(body, {outline: true});
  root.innerHTML = sanitizeRenderedHtml(raw, options.documentPath, options.resolveImage);
  if (metadata) root.prepend(createMetadataPanel(metadata));
  scopeIds(root);
  applySemanticClasses(root);
  enhanceCallouts(root);
  enhanceMathTokens(root);
  enhanceFigures(root);
  enhanceCodeBlocks(root, options);
  for (const table of root.querySelectorAll("table")) {
    const region = document.createElement("div");
    region.className = "md-table-scroll";
    makeHorizontalScrollRegion(region, "Table. Scroll horizontally for more columns.");
    table.replaceWith(region); region.append(table);
  }
  secureTaskInputs(root);
  enhanceFootnotes(root, href => options.onOpenLink?.(href), options.enhancedInteractions !== false);
  secureLinks(root, options);
  await enhanceDiagrams(root, options.contentState ?? "settled", options.scheduleDiagram);
}
