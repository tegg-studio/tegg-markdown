import {setUIText, setUILabel} from "./uiContext";
import {bindEngines} from "./renderEngines";
import {imageForView, resourceContext} from "./editorHost";
import {EditableCodeWidget} from "./codeEditing";
import {LiteralWidget, decodeEntity, literalClipboardText} from "./literalEditing";
import {scriptFormatting} from "./scriptFormatting";
import {EmojiWidget} from "./emojiEditing";
import {inlineHtmlFormatting} from "./inlineHtml";
import {simpleBreakTag, trailingLiveBreak, InlineBreakWidget, deleteLiveBreak, insertLiveBreak} from "./liveBreaks";
import { liveLinks } from "./liveLinks";
import { createMetadataPanel, disposeMetadataPanel } from "./metadata";
import { undo, redo } from "@codemirror/commands";
import {observeSurfaceAppearance} from "./appearance";
import {inlineMathAt} from "./mathSyntax";
import {action, openPanel, openObjectViewer, disposeInteractions, scopeIds, enhanceFigures} from "./renderInteraction";
import {renderMarkdown} from "./markdown";
import { makeHorizontalScrollRegion } from "./localScroll";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, Prec, Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, keymap, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import emojiMap from "markdown-it-emoji/lib/data/full.mjs";
import { dispatchSourcePatches } from "./editorPatches";
import { markdownParser, parserFor } from "./markdownParser";
import {
  findFrontmatter,
  parseInlineImage,
  resolveLocalImageSource,
  type TechnicalBlock,
} from "./profile";
import {
  applySemanticClasses,
  createHtmlPreview,
  createRenderToolbar,
  enhanceCallouts,
  renderClassNames,
  renderDiagram,
  renderMathInto,
  enhanceMathTokens,
  sanitizeRenderedHtml,
} from "./renderKit";
import { parseMarkdownTable, serializeMarkdownTable, type MarkdownTable } from "./table";
import type { SourceRange } from "./sourcePatch";
import { calloutRanges } from "./calloutEditing";
import { resolveCallout, applyCalloutAppearance } from "./callouts";
import { calloutTypeButton } from "./calloutInteraction";
import { enhanceRenderedLinks } from "./renderedLinks";
import { analyzeSource } from "./sourceAnalysis";

const widgetCleanup = new WeakMap<HTMLElement, () => void>();

type PreviewKind = TechnicalBlock["kind"];

function editSource(view: EditorView, from: number) {
  view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
  view.focus();
}

function toolbar(labelText: string, edit: () => void) {
  const result = createRenderToolbar(labelText, { label: "Edit Source", run: edit });
  result.classList.add("cm-preview-toolbar");
  return result;
}

class BlockWidget extends WidgetType {
  constructor(readonly kind: PreviewKind, readonly source: string, readonly from: number) { super(); }

  eq(other: BlockWidget) {
    return other.kind === this.kind && other.source === this.source && other.from === this.from;
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("section");
    wrapper.className = `cm-preview-widget ${renderClassNames.block}`;
    if (this.kind !== "math") wrapper.classList.add(renderClassNames.diagram);
    wrapper.setAttribute("aria-label", this.kind === "math" ? "Math formula" : `${this.kind} diagram`);

    const blockToolbar = toolbar(this.kind === "math" ? "Formula" : this.kind === "mermaid" ? "Mermaid" : "GraphViz", () => {
      view.dispatch({ selection: { anchor: this.from + (this.kind === "math" ? 2 : 3) }, scrollIntoView: true });
      view.focus();
    });

    const canvas = document.createElement("div");
    canvas.className = `diagram-canvas ${renderClassNames.canvas}`;
    wrapper.append(blockToolbar, canvas);

    if (this.kind === "math") {
      bindEngines(canvas, view.state.facet(resourceContext).engines);
      renderMathInto(canvas, { kind: "math", source: this.source, display: "block" });
    } else {
      const model = {kind: "diagram" as const, engine: this.kind, source: this.source};
      bindEngines(canvas, view.state.facet(resourceContext).engines);
      const update = () => {void renderDiagram(model, canvas, () => view.dom.contains(wrapper));};
      update();
      widgetCleanup.set(wrapper, observeSurfaceAppearance(view.dom.closest<HTMLElement>(".tegg-surface") ?? view.dom, update));
    }
    return wrapper;
  }

  destroy(dom: HTMLElement) { widgetCleanup.get(dom)?.(); disposeInteractions(dom); }
  ignoreEvent() { return true; }
}

class InlineMathWidget extends WidgetType {
  constructor(readonly source: string, readonly from: number) { super(); }
  eq(other: InlineMathWidget) { return other.source === this.source && other.from === this.from; }
  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.className = "cm-live-math-inline";
    span.tabIndex = 0;
    setUILabel(span, "Formula: {value}", {value: String(this.source)});
    bindEngines(span, view.state.facet(resourceContext).engines);
    renderMathInto(span, { kind: "math", source: this.source, display: "inline" });
    span.addEventListener("click", event => {event.stopPropagation(); openObjectViewer(span, span, this.source, "Formula", () => editSource(view, this.from + 1));});
    span.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {event.preventDefault(); event.stopPropagation(); openObjectViewer(span, span, this.source, "Formula", () => editSource(view, this.from + 1));}
    });
    return span;
  }

  destroy(dom: HTMLElement) { widgetCleanup.get(dom)?.(); disposeInteractions(dom); }
  ignoreEvent() { return true; }
}

class TextWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly className: string,
    readonly from: number,
    readonly label?: string,
  ) { super(); }
  eq(other: TextWidget) {
    return other.text === this.text && other.className === this.className
      && other.from === this.from && other.label === this.label;
  }
  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.className = this.className;
    span.textContent = this.text;
    if (this.label) span.setAttribute("aria-label", this.label);
    span.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      editSource(view, this.from);
    });
    return span;
  }

  destroy(dom: HTMLElement) { widgetCleanup.get(dom)?.(); disposeInteractions(dom); }
  ignoreEvent() { return true; }
}

class HtmlPreviewWidget extends WidgetType {
  constructor(readonly source: string, readonly from: number, readonly block: boolean) { super(); }
  eq(other: HtmlPreviewWidget) {
    return other.source === this.source && other.from === this.from && other.block === this.block;
  }
  toDOM(view: EditorView) {
    const renderedSource = this.block ? this.source : parserFor(view.state.facet(resourceContext).profile).renderInline(this.source);
    const wrapper = createHtmlPreview({
      kind: "html",
      source: this.source,
      display: this.block ? "block" : "inline",
    }, renderedSource, view.state.facet(resourceContext));
    wrapper.classList.add(this.block ? "cm-live-html-block" : "cm-live-html-inline");
    wrapper.tabIndex = 0;
    wrapper.addEventListener("click", () => editSource(view, this.from));
    wrapper.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") editSource(view, this.from);
    });
    return wrapper;
  }
  destroy(dom: HTMLElement) { widgetCleanup.get(dom)?.(); disposeInteractions(dom); }
  ignoreEvent() { return true; }
}

class FootnoteWidget extends WidgetType {
  constructor(readonly number: number, readonly definition: LinkDefinition) {super();}
  eq(other: FootnoteWidget) {return this.number === other.number && this.definition.value === other.definition.value && this.definition.from === other.definition.from;}
  toDOM(view: EditorView) {
    const button = action(`[${this.number}]`, () => {
      const panel = openPanel(button, `Footnote ${this.number}`);
      panel.body.classList.add("md-note-content");
      void renderMarkdown(this.definition.value, panel.body, {...view.state.facet(resourceContext), onOpenLink: href => view.dom.dispatchEvent(new CustomEvent("tegg-open-link", {detail:href,bubbles:true}))});
      panel.head.append(action("Edit Source", () => {panel.close(false); editSource(view, this.definition.from);}));
    });
    button.className = `cm-live-footnote-ref ${renderClassNames.footnoteRef}`;
    setUILabel(button, "Footnote {value}", {value: String(this.number)}); button.setAttribute("aria-haspopup", "dialog");
    button.addEventListener("mousedown", event => {event.preventDefault(); event.stopPropagation();});
    return button;
  }
  destroy(dom: HTMLElement) {disposeInteractions(dom);}
  ignoreEvent() {return true;}
}

class ReferenceDefinitionWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly destination: string,
    readonly from: number,
    readonly footnoteNumber?: number,
  ) { super(); }
  eq(other: ReferenceDefinitionWidget) {
    return other.label === this.label && other.destination === this.destination
      && other.from === this.from && other.footnoteNumber === this.footnoteNumber;
  }
  toDOM(view: EditorView) {
    if (this.footnoteNumber) {
      const wrapper = document.createElement("section"); wrapper.className = `cm-live-footnote-definition ${renderClassNames.footnoteDefinition}`;
      const content = document.createElement("div");
      void renderMarkdown(this.destination, content, {...view.state.facet(resourceContext), onOpenLink: href => view.dom.dispatchEvent(new CustomEvent("tegg-open-link", {detail:href,bubbles:true}))});
      wrapper.append(toolbar(`Footnote ${this.footnoteNumber}`, () => editSource(view, this.from)), content);
      return wrapper;
    }
    const wrapper = document.createElement("button");
    wrapper.type = "button";
    wrapper.className = this.footnoteNumber
      ? `cm-live-footnote-definition ${renderClassNames.footnoteDefinition}`
      : "cm-live-reference-definition";
    wrapper.textContent = this.footnoteNumber
      ? `${this.footnoteNumber}. ${this.destination}`
      : `${this.label} → ${this.destination}`;
    wrapper.addEventListener("click", () => editSource(view, this.from));
    return wrapper;
  }
  destroy(dom: HTMLElement) { widgetCleanup.get(dom)?.(); disposeInteractions(dom); }
  ignoreEvent() { return true; }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly title: string | undefined,
    readonly from: number,
  ) { super(); }

  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt && other.title === this.title && other.from === this.from;
  }

  toDOM(view: EditorView) {
    const figure = document.createElement("figure");
    figure.className = `cm-live-image ${renderClassNames.image}`;
    figure.tabIndex = 0;
    figure.setAttribute("aria-label", this.alt || "Markdown image");
    if (this.title) figure.title = this.title;

    const image = document.createElement("img");
    image.src = this.src;
    image.alt = this.alt;
    image.loading = "lazy";
    image.draggable = false;

    const fallback = document.createElement("div");
    fallback.className = "cm-live-image-fallback";
    fallback.hidden = true;
    setUIText(fallback,"Could not display image · {value}",{value:this.alt || this.src});
    image.addEventListener("error", () => {
      image.hidden = true;
      fallback.hidden = false;
    });

    const edit = () => {
      view.dispatch({ selection: { anchor: this.from + 2 }, scrollIntoView: true });
      view.focus();
    };
    figure.addEventListener("click", edit);
    figure.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        edit();
      }
    });
    figure.append(image, fallback);
    return figure;
  }

  destroy(dom: HTMLElement) { widgetCleanup.get(dom)?.(); disposeInteractions(dom); }
  ignoreEvent() { return true; }
}

class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number,
    readonly source: string,
  ) { super(); }
  eq(other: TaskWidget) {
    return other.checked === this.checked && other.from === this.from && other.source === this.source;
  }

  toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = `cm-live-task ${renderClassNames.task}`;
    input.setAttribute("aria-label", this.checked ? "Completed task" : "Incomplete task");
    input.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    input.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dispatchSourcePatches(view, [{
        from: this.from,
        to: this.to,
        insert: this.checked ? "[ ]" : "[x]",
        expected: this.source,
      }]);
      view.focus();
    });
    return input;
  }

  destroy(dom: HTMLElement) { widgetCleanup.get(dom)?.(); disposeInteractions(dom); }
  ignoreEvent() { return true; }
}

class MarkerWidget extends WidgetType {
  constructor(readonly text: string, readonly from: number) { super(); }
  eq(other: MarkerWidget) { return other.text === this.text && other.from === this.from; }
  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.className = `cm-live-list-marker ${renderClassNames.listMarker}`;
    span.textContent = this.text;
    span.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      editSource(view, this.from);
    });
    return span;
  }

  destroy(dom: HTMLElement) { widgetCleanup.get(dom)?.(); disposeInteractions(dom); }
  ignoreEvent() { return true; }
}

class HorizontalRuleWidget extends WidgetType {
  constructor(readonly from: number) { super(); }
  eq(other: HorizontalRuleWidget) { return other.from === this.from; }
  toDOM(view: EditorView) {
    const rule = document.createElement("hr");
    rule.className = `cm-live-rule ${renderClassNames.rule}`;
    setUILabel(rule, "Horizontal rule");
    rule.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      editSource(view, this.from);
    });
    return rule;
  }

  destroy(dom: HTMLElement) { widgetCleanup.get(dom)?.(); disposeInteractions(dom); }
  ignoreEvent() { return true; }
}

const setMetadataSource = StateEffect.define<SourceRange | null>();
const metadataSourceState = StateField.define<SourceRange | null>({
  create: () => null,
  update(value, transaction) {
    if (value) value = { from: transaction.changes.mapPos(value.from, -1), to: transaction.changes.mapPos(value.to, 1) };
    for (const effect of transaction.effects) if (effect.is(setMetadataSource)) value = effect.value;
    return value;
  },
});
const metadataExpansion = new WeakMap<EditorView, boolean>();

class MetadataSourceToolbar extends WidgetType {
  constructor(readonly end: number) { super(); }
  eq(other: MetadataSourceToolbar) { return other.end === this.end; }
  toDOM(view: EditorView) {
    const toolbar = document.createElement("div");
    toolbar.className = "cm-metadata-source-toolbar";
    toolbar.contentEditable = "false";
    const label = document.createElement("span");
    setUIText(label, "Metadata \u00b7 YAML");
    const done = document.createElement("button");
    done.type = "button";
    done.textContent = "Done";
    setUILabel(done, "Done editing YAML");
    done.addEventListener("mousedown", event => { event.preventDefault(); event.stopPropagation(); });
    done.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation();
      view.focus();
      requestAnimationFrame(() => {
        const current = findFrontmatter(view.state.doc.toString());
        const end = current.to || view.state.field(metadataSourceState)?.to || this.end;
        view.dispatch({ effects: setMetadataSource.of(null), selection: { anchor: Math.min(end, view.state.doc.length) }, scrollIntoView: true });
      });
    });
    toolbar.append(label, done);
    return toolbar;
  }
  ignoreEvent() { return true; }
}

class FrontmatterWidget extends WidgetType {
  constructor(readonly metadata: string, readonly from: number, readonly to: number, readonly source: string) { super(); }
  eq(other: FrontmatterWidget) {
    return other.metadata === this.metadata && other.from === this.from && other.to === this.to
      && other.source === this.source;
  }
  toDOM(view: EditorView) {
    const panel = createMetadataPanel(this.metadata, () => {
      view.focus();
      requestAnimationFrame(() => {
        const current = findFrontmatter(view.state.doc.toString());
        if (!current.to) return;
        const prefix = view.state.sliceDoc(0, 5).startsWith("---\r\n") ? 5 : 4;
        view.dispatch({ effects: setMetadataSource.of({ from: current.from, to: current.to }), selection: { anchor: prefix }, scrollIntoView: true });
      });
    }, {
      expanded: metadataExpansion.get(view),
      onExpandedChange: expanded => metadataExpansion.set(view, expanded),
      onChange: patch => {
        if (view.state.sliceDoc(this.from, this.to) !== this.source) return false;
        const prefix = this.source.startsWith("---\r\n") ? 5 : 4;
        const activePath = panel.querySelector<HTMLElement>(".md-metadata-value-display[hidden] .md-metadata-value-edit")?.dataset.metadataPath;
        dispatchSourcePatches(view, [{ ...patch, from: this.from + prefix + patch.from, to: this.from + prefix + patch.to }], { isolateHistory: true });
        requestAnimationFrame(() => {
          if (panel.dataset.metadataTransition === "source") return;
          const button = Array.from(view.dom.querySelectorAll<HTMLElement>(".md-metadata-value-edit")).find(node => node.dataset.metadataPath === activePath);
          (button?.hidden ? button.closest<HTMLElement>("dd") : button)?.focus();
        });
        return true;
      },
    });
    panel.classList.add("cm-live-properties");
    panel.addEventListener("keydown", event => {
      const target = event.target as HTMLElement;
      if (event.isComposing || event.keyCode === 229 || target.closest("input, textarea, select")) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "z") {
        event.preventDefault(); event.stopPropagation();
        const path = target.closest<HTMLElement>("[data-metadata-path]")?.dataset.metadataPath;
        (event.shiftKey ? redo : undo)(view);
        requestAnimationFrame(() => {
          const button = Array.from(view.dom.querySelectorAll<HTMLElement>(".md-metadata-value-edit")).find(node => node.dataset.metadataPath === path);
          (button?.hidden ? button.closest<HTMLElement>("dd") : button)?.focus();
        });
      }
    });
    enhanceRenderedLinks(panel, href => {
      view.dom.dispatchEvent(new CustomEvent("tegg-open-link", { bubbles: true, detail: href }));
    });
    return panel;
  }

  destroy(dom: HTMLElement) { disposeMetadataPanel(dom); widgetCleanup.get(dom)?.(); disposeInteractions(dom); }
  ignoreEvent() { return true; }
}

class CalloutHeaderWidget extends WidgetType {
  constructor(readonly from: number, readonly type: string, readonly title: string, readonly showTitle: boolean) { super(); }
  eq(other: CalloutHeaderWidget) { return this.from === other.from && this.type === other.type && this.title === other.title && this.showTitle === other.showTitle; }
  toDOM(view: EditorView) {
    const header = document.createElement("span");
    header.className = "callout-editor-header";
    applyCalloutAppearance(header, this.type);
    header.append(calloutTypeButton(view, this.from, this.type));
    if (this.showTitle) {
      const title = document.createElement("span");
      title.className = "callout-title";
      title.innerHTML = sanitizeRenderedHtml(parserFor(view.state.facet(resourceContext).profile).renderInline(this.title || this.type.toUpperCase()), view.state.facet(resourceContext).documentPath, view.state.facet(resourceContext).resolveImage);
      title.addEventListener("click", () => editSource(view, this.from));
      header.append(title);
    }
    return header;
  }
  destroy(dom: HTMLElement) { widgetCleanup.get(dom)?.(); disposeInteractions(dom); }
  ignoreEvent() { return true; }
}

class BlockquoteWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
    readonly calloutType?: string,
  ) { super(); }

  eq(other: BlockquoteWidget) {
    return other.source === this.source && other.from === this.from && other.calloutType === this.calloutType;
  }

  toDOM(view: EditorView) {
    const shell = document.createElement("div");
    shell.innerHTML = sanitizeRenderedHtml(parserFor(view.state.facet(resourceContext).profile).render(this.source, {profile: view.state.facet(resourceContext).profile}), view.state.facet(resourceContext).documentPath, view.state.facet(resourceContext).resolveImage);
    scopeIds(shell); applySemanticClasses(shell);
    enhanceCallouts(shell); enhanceMathTokens(shell); enhanceFigures(shell);
    enhanceRenderedLinks(shell, href => view.dom.dispatchEvent(new CustomEvent("tegg-open-link", {detail: href, bubbles: true})));
    const quote = shell.querySelector<HTMLElement>("blockquote") ?? document.createElement("blockquote");
    quote.classList.add(this.calloutType ? "cm-live-callout" : "cm-live-quote-widget");
    if (this.calloutType) quote.classList.add(`cm-live-callout-${this.calloutType}`);
    if (this.calloutType) {
      const targets = calloutRanges(view.state).filter(range => range.from >= this.from && range.to <= this.from + this.source.length);
      const elements = [quote, ...quote.querySelectorAll<HTMLElement>("blockquote.callout")];
      elements.forEach((element, index) => {
        const target = targets[index];
        if (!target) return;
        element.querySelector(":scope > .callout-title > .callout-icon")?.replaceWith(calloutTypeButton(view, target.from, target.type));
      });
    }
    quote.tabIndex = 0;
    quote.setAttribute("aria-label", this.calloutType ? `${this.calloutType} callout` : "Block quote");
    const edit = () => editSource(view, this.from);
    quote.addEventListener("click", event => {
      if ((event.target as Element).closest("button, a, input, summary, [data-tex-source]")) return;
      edit();
    });
    quote.addEventListener("keydown", (event) => {
      if (event.target !== quote) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        edit();
      }
    });
    return quote;
  }

  destroy(dom: HTMLElement) { widgetCleanup.get(dom)?.(); disposeInteractions(dom); }
  ignoreEvent() { return true; }
}

class TableWidget extends WidgetType {
  constructor(readonly source: string, readonly from: number, readonly to: number) { super(); }
  eq(other: WidgetType) { return other instanceof TableWidget && other.source === this.source && other.from === this.from && other.to === this.to; }
  toDOM(view: EditorView) {
    const model = parseMarkdownTable(this.source);
    if (!model) {
      const fallback = document.createElement("pre");
      fallback.textContent = this.source;
      return fallback;
    }
    const panel = document.createElement("section");
    panel.className = `cm-live-table ${renderClassNames.table}`;
    makeHorizontalScrollRegion(panel, "Editable table. Scroll horizontally for more columns.");
    const toolbar = document.createElement("div");
    toolbar.className = "cm-preview-toolbar";
    const label = document.createElement("span");
    label.textContent = `${model.rows.length} rows × ${model.headers.length} columns`;
    const actions = document.createElement("div");
    const commit = () => dispatchSourcePatches(view, [{
      from: this.from,
      to: this.to,
      insert: serializeMarkdownTable(model),
      expected: this.source,
    }]);
    const button = (title: string, action: () => void) => {
      const result = document.createElement("button");
      result.type = "button"; setUIText(result,title); result.addEventListener("click", action); return result;
    };
    actions.append(
      button("Add Row", () => { model.rows.push(model.headers.map(() => "")); commit(); }),
      button("Add Column", () => {
        model.headers.push(`Column ${model.headers.length + 1}`);
        model.alignments.push(null);
        model.rows.forEach((row) => row.push(""));
        commit();
      }),
      button("Edit Source", () => { view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true }); view.focus(); }),
    );
    toolbar.append(label, actions);
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const body = document.createElement("tbody");
    const makeCell = (value: string, update: (value: string) => void, alignment: MarkdownTable["alignments"][number]) => {
      const shell = document.createElement("div");
      shell.className = "cm-live-table-cell";
      if (alignment) shell.dataset.align = alignment;
      const preview = document.createElement("button");
      preview.type = "button";
      preview.className = "cm-live-table-preview";
      preview.innerHTML = sanitizeRenderedHtml(parserFor(view.state.facet(resourceContext).profile).renderInline(value), view.state.facet(resourceContext).documentPath, view.state.facet(resourceContext).resolveImage);
      setUILabel(preview, "Edit table cell: {value}", {value: String(value)});
      const input = document.createElement("input");
      input.value = value;
      input.hidden = true;
      setUILabel(input, "Table cell: {value}", {value: String(value || "Empty")});
      let editing = false;
      const finish = (save: boolean) => {
        // Committing replaces this widget and can synchronously blur its input.
        // End the editing session first so Enter and blur cannot submit twice.
        if (!editing) return;
        editing = false;
        if (save && input.value !== value) { update(input.value); commit(); }
        input.hidden = true;
        preview.hidden = false;
      };
      preview.addEventListener("click", () => {
        editing = true;
        preview.hidden = true;
        input.hidden = false;
        input.focus();
        input.select();
      });
      input.addEventListener("blur", () => finish(true));
      input.addEventListener("keydown", (event) => {
        // Enter/Escape belong to the candidate window until composition ends.
        // WebKit can report the final candidate key as 229 without isComposing.
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter") { event.preventDefault(); finish(true); }
        if (event.key === "Escape") { event.preventDefault(); input.value = value; finish(false); }
      });
      shell.append(preview, input);
      return shell;
    };
    const headerRow = document.createElement("tr");
    model.headers.forEach((value, column) => {
      const cell = document.createElement("th");
      cell.append(makeCell(value, (next) => { model.headers[column] = next; }, model.alignments[column]));
      headerRow.append(cell);
    });
    head.append(headerRow);
    model.rows.forEach((row, rowIndex) => {
      const tableRow = document.createElement("tr");
      model.headers.forEach((_, column) => {
        const cell = document.createElement("td");
        cell.append(makeCell(row[column] ?? "", (next) => { model.rows[rowIndex][column] = next; }, model.alignments[column]));
        tableRow.append(cell);
      });
      body.append(tableRow);
    });
    table.append(head, body); panel.append(toolbar, table); return panel;
  }
  destroy(dom: HTMLElement) { widgetCleanup.get(dom)?.(); disposeInteractions(dom); }
  ignoreEvent() { return true; }
}

function isRangeActive(view: EditorView, from: number, to: number) {
  if (!view.hasFocus) return false;
  if (view.composing) return true;
  return view.state.selection.ranges.some((selection) => {
    if (selection.empty) return selection.from >= from && selection.from < to;
    return selection.from < to && selection.to > from;
  });
}

function isInside(range: SourceRange, containers: SourceRange[]) {
  return containers.some((container) => range.from >= container.from && range.to <= container.to);
}

function isPositionInside(position: number, containers: SourceRange[]) {
  return containers.some((container) => position >= container.from && position < container.to);
}

const semanticNodes = new Set([
  "ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6",
  "SetextHeading1", "SetextHeading2", "StrongEmphasis", "Emphasis", "Strikethrough", "InlineCode",
  "Link", "Autolink", "Image", "Escape", "HardBreak", "ListItem", "Blockquote", "FencedCode", "CodeBlock", "Task", "Table",
  "HorizontalRule",
]);

function semanticAncestor(node: SyntaxNode): SyntaxNode {
  let current: SyntaxNode | null = node;
  while (current?.parent && !semanticNodes.has(current.name)) current = current.parent;
  return current ?? node;
}

function addLineDecoration(view: EditorView, ranges: Range<Decoration>[], from: number, to: number, className: string) {
  let line = view.state.doc.lineAt(from);
  const endLine = to <= line.to + 1 ? line.number : view.state.doc.lineAt(Math.max(from, to - 1)).number;
  while (line.number <= endLine) {
    ranges.push(Decoration.line({ class: className }).range(line.from));
    if (line.number === endLine) break;
    line = view.state.doc.line(line.number + 1);
  }
}

function addBlockLineDecorations(
  view: EditorView,
  ranges: Range<Decoration>[],
  from: number,
  to: number,
  className: string,
  edgeClassName: string,
) {
  // Most paragraphs occupy one source line. Resolve it once and combine
  // identical-position line attributes instead of creating three decorations
  // and repeatedly looking up the same positions in the document tree.
  let line = view.state.doc.lineAt(from);
  const first = line.number;
  const last = to <= line.to + 1 ? first : view.state.doc.lineAt(Math.max(from, to - 1)).number;
  while (line.number <= last) {
    const edges = `${line.number === first ? ` ${edgeClassName}-first` : ""}${line.number === last ? ` ${edgeClassName}-last` : ""}`;
    ranges.push(Decoration.line({class: className + edges}).range(line.from));
    if (line.number === last) break;
    line = view.state.doc.line(line.number + 1);
  }
}

function collapseMultilineSource(
  view: EditorView,
  ranges: Range<Decoration>[],
  from: number,
  to: number,
  widget: WidgetType,
) {
  const closingLine = view.state.doc.lineAt(Math.max(from, to - 1));
  if (closingLine.from > from) {
    addLineDecoration(view, ranges, from, closingLine.from - 1, "cm-live-collapsed-source");
  }
  ranges.push(Decoration.line({ class: "cm-live-rendered-block-line" }).range(closingLine.from));
  ranges.push(Decoration.replace({ widget }).range(closingLine.from, closingLine.to));
}

function syntaxRanges(view: EditorView, names: Set<string>) {
  const result: Array<SourceRange & { name: string }> = [];
  syntaxTree(view.state).iterate({
    enter(node) {
      if (names.has(node.name)) {
        result.push({ name: node.name, from: node.from, to: node.to });
        return false;
      }
      // This pass collects block code only; inline paragraph descendants
      // cannot contain either of the requested block node types.
      if (node.name === "Paragraph" && [...names].every(name => name === "FencedCode" || name === "CodeBlock")) return false;
    },
  });
  return result;
}

function lineRange(view: EditorView, range: SourceRange): SourceRange {
  return {
    from: view.state.doc.lineAt(range.from).from,
    to: view.state.doc.lineAt(Math.max(range.from, range.to - 1)).to,
  };
}

function parseFencedCode(raw: string) {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const opening = lines[0]?.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!opening || lines.length < 2) return null;
  const language = opening[2].trim().split(/\s+/)[0] ?? "";
  return { language, source: lines.slice(1, -1).join("\n") };
}

function parseLinkedImage(raw: string) {
  if (!raw.startsWith("[![") || !raw.endsWith(")")) return null;
  const outerDestination = raw.lastIndexOf("](");
  if (outerDestination < 2) return null;
  const image = parseInlineImage(raw.slice(1, outerDestination));
  const destination = raw.slice(outerDestination).match(/^\]\(\s*(?:<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)$/);
  return image && destination ? image : null;
}

function collectHtmlRanges(view: EditorView, inlineParagraphs: Set<number>) {
  const result: Array<SourceRange & { block: boolean }> = [];
  const source = analyzeSource(view.state.doc).source;
  if (!source.includes("<")) return result;
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name === "HTMLBlock") {
        result.push({ from: node.from, to: node.to, block: true });
        return false;
      }
      if (node.name === "Paragraph") {
        if (inlineParagraphs.has(node.from)) return false;
        const raw = source.slice(node.from, node.to);
        if (markdownParser.parseInline(raw, {})[0]?.children?.some(token => token.type === "html_inline" && !simpleBreakTag.test(token.content))) {
          result.push({ from: node.from, to: node.to, block: false });
          return false;
        }
      }
    },
  });
  return result;
}

type LinkDefinition = { label: string; value: string; from: number; to: number; footnote: boolean };

function findLinkDefinitions(source: string, codeRanges: SourceRange[]): LinkDefinition[] {
  const result: LinkDefinition[] = [];
  const pattern = /^\[([^\]\n]+)\]:[ \t]*(.*)$/gm;
  for (const match of source.matchAll(pattern)) {
    const from = match.index ?? 0;
    let to = from + match[0].length;
    if (isInside({ from, to }, codeRanges)) continue;
    const footnote = match[1].startsWith("^");
    const label = footnote ? match[1].slice(1) : match[1];
    let value = match[2];
    if (footnote) {
      const tail = source.slice(to);
      const continuation = tail.match(/^(?:\r?\n(?:[ \t]*\r?\n)*(?: {4}|\t)[^\n]*)*/)?.[0] ?? "";
      to += continuation.length;
      value += continuation.replace(/^(?: {4}|\t)/gm, "");
    }
    result.push({ label, value, from, to, footnote });
  }
  return result;
}

function footnoteNumbers(source: string, definitions: LinkDefinition[], codeRanges: SourceRange[]) {
  const result = new Map<string, number>();
  const pattern = /\[\^([^\]\n]+)\]/g;
  const definitionRanges = definitions.filter((definition) => definition.footnote);
  for (const match of source.matchAll(pattern)) {
    const from = match.index ?? 0;
    const range = { from, to: from + match[0].length };
    if (isInside(range, codeRanges) || isInside(range, definitionRanges)) continue;
    if (definitionRanges.some(definition => definition.label === match[1]) && !result.has(match[1])) result.set(match[1], result.size + 1);
  }
  for (const definition of definitionRanges) {
    if (!result.has(definition.label)) result.set(definition.label, result.size + 1);
  }
  return result;
}


function buildDecorations(view: EditorView): DecorationSet {
  const profile = view.state.facet(resourceContext).profile ?? "tegg";
  const analysis = analyzeSource(view.state.doc, profile);
  const source = analysis.source;
  const ranges: Range<Decoration>[] = [];
  const suppressed: SourceRange[] = [];
  const headingFollowers: SourceRange[] = [];
  const codeRanges = syntaxRanges(view, new Set(["FencedCode", "CodeBlock", "InlineCode"]));
  const inlineExcluded = syntaxRanges(view, new Set(["InlineCode", "URL", "LinkTitle", "HTMLTag", "Escape"]));

  const frontmatter = analysis.frontmatter;
  const explicitSource = view.state.field(metadataSourceState);
  if (frontmatter.to > 0 || explicitSource) {
    const range = frontmatter.to > 0 ? { from: frontmatter.from, to: frontmatter.to } : explicitSource!;
    suppressed.push(range);
    if (explicitSource || isRangeActive(view, range.from, range.to)) {
      addLineDecoration(view, ranges, range.from, range.to, "cm-live-frontmatter-source");
      ranges.push(Decoration.widget({ widget: new MetadataSourceToolbar(range.to), side: -1 }).range(range.from));
    } else {
      collapseMultilineSource(
        view,
        ranges,
        range.from,
        range.to,
        new FrontmatterWidget(frontmatter.metadata ?? "", range.from, range.to, source.slice(range.from, range.to)),
      );
    }
  }

  for (const block of analysis.technicalBlocks) {
    suppressed.push(block);
    const widget = new BlockWidget(block.kind, block.source, block.from);
    if (isRangeActive(view, block.from, block.to)) {
      addLineDecoration(view, ranges, block.from, block.to, "cm-live-technical-source");
      ranges.push(Decoration.widget({ widget, side: 1 }).range(block.to));
    } else {
      collapseMultilineSource(view, ranges, block.from, block.to, widget);
    }
  }

  for (const match of source.matchAll(/<!--[\s\S]*?-->/g)) {
    const from = match.index ?? 0;
    const range = { from, to: from + match[0].length };
    if (isInside(range, codeRanges)) continue;
    suppressed.push(range);
    if (isRangeActive(view, range.from, range.to)) continue;
    const line = view.state.doc.lineAt(range.from);
    if (source.slice(line.from, line.to).trim() === match[0].trim()) {
      ranges.push(Decoration.line({ class: "cm-live-collapsed-source" }).range(line.from));
      ranges.push(Decoration.replace({}).range(range.from, range.to));
    } else {
      ranges.push(Decoration.replace({}).range(range.from, range.to));
    }
  }

  const inlineHtml = inlineHtmlFormatting(view.state);
  for (const html of collectHtmlRanges(view, inlineHtml.paragraphs)) {
    if (isInside(html, codeRanges) || isInside(html, suppressed)) continue;
    suppressed.push(html);
    if (isRangeActive(view, html.from, html.to)) {
      addLineDecoration(view, ranges, html.from, html.to, "cm-live-technical-source");
    } else if (html.block || view.state.doc.lineAt(html.from).number !== view.state.doc.lineAt(Math.max(html.from, html.to - 1)).number) {
      // View-plugin replacements must stay within one source line. Render a
      // multiline paragraph on its closing line, as with other multiline previews.
      collapseMultilineSource(view, ranges, html.from, html.to, new HtmlPreviewWidget(source.slice(html.from, html.to), html.from, html.block));
    } else {
      ranges.push(Decoration.replace({ widget: new HtmlPreviewWidget(source.slice(html.from, html.to), html.from, false) }).range(html.from, html.to));
    }
  }

  for (const pair of inlineHtml.pairs) {
    if (isInside(pair, codeRanges) || isInside(pair, suppressed)) continue;
    const classes: Record<string, string> = {
      mark: `cm-live-highlight ${renderClassNames.highlight}`, u: "cm-live-underline",
      strong: `cm-live-strong ${renderClassNames.strong}`, em: `cm-live-emphasis ${renderClassNames.emphasis}`,
      del: `cm-live-strike ${renderClassNames.strike}`,
      sub: `cm-live-sub ${renderClassNames.subscript}`, sup: `cm-live-sup ${renderClassNames.superscript}`,
    };
    if (pair.contentFrom < pair.contentTo) ranges.push(Decoration.mark({class: classes[pair.tag]}).range(pair.contentFrom, pair.contentTo));
    ranges.push(Decoration.replace({inlineSyntax: true}).range(pair.from, pair.contentFrom));
    ranges.push(Decoration.replace({inlineSyntax: true}).range(pair.contentTo, pair.to));
  }

  const definitions = findLinkDefinitions(source, codeRanges).filter(item => profile !== "gfm" || !item.footnote);
  const numbers = footnoteNumbers(source, definitions, codeRanges);
  for (const definition of definitions) {
    suppressed.push(definition);
    if (isRangeActive(view, definition.from, definition.to)) {
      addLineDecoration(view, ranges, definition.from, definition.to, "cm-live-reference-source");
    } else {
      const widget = new ReferenceDefinitionWidget(definition.label, definition.value, definition.from, definition.footnote ? numbers.get(definition.label) : undefined);
      if (source.slice(definition.from, definition.to).includes("\n")) collapseMultilineSource(view, ranges, definition.from, definition.to, widget);
      else ranges.push(Decoration.replace({widget}).range(definition.from, definition.to));
    }
  }

  for (const match of (profile === "gfm" ? [] : source.matchAll(/\[\^([^\]\n]+)\]/g))) {
    const from = match.index ?? 0;
    const range = { from, to: from + match[0].length };
    if (isInside(range, codeRanges) || isInside(range, definitions)) continue;
    const number = numbers.get(match[1]);
    suppressed.push(range);
    if (!number) continue;
    if (!isRangeActive(view, range.from, range.to)) {
      ranges.push(Decoration.replace({
        widget: new FootnoteWidget(number, definitions.find(definition => definition.footnote && definition.label === match[1])!),
      }).range(range.from, range.to));
    }
  }

  const callouts = profile === "gfm" ? [] : calloutRanges(view.state).filter(item => profile === "tegg" || /^[ \t]{0,3}>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/.test(view.state.doc.lineAt(item.from).text));
  const outerCallouts = callouts.filter(item => !callouts.some(parent => parent.from < item.from && parent.to >= item.to));
  for (const callout of outerCallouts) {
    if (isRangeActive(view, callout.from, callout.to) || (view.hasFocus && view.state.selection.ranges.some(selection => selection.empty && selection.from === callout.to))) {
      const children = callouts.filter(item => item.from >= callout.from && item.to <= callout.to);
      const first = view.state.doc.lineAt(callout.from);
      const last = view.state.doc.lineAt(Math.max(callout.from, callout.to - 1));
      for (let number = first.number; number <= last.number; number++) {
        const line = view.state.doc.line(number);
        const owner = children.filter(item => item.from <= line.to && item.to >= line.from).at(-1) ?? callout;
        const style = resolveCallout(owner.type);
        const edge = `${number === first.number ? " cm-live-callout-source-first" : ""}${number === last.number ? " cm-live-callout-source-last" : ""}`;
        ranges.push(Decoration.line({class: `cm-live-callout-source cm-live-callout-source-${owner.type}${edge}`,
          attributes: {"data-callout-kind": style.id, style: `--callout-light:${style.light};--callout-dark:${style.dark}`},
        }).range(line.from));
      }
      for (const child of children) {
        const headerLine = view.state.doc.lineAt(child.headerFrom);
        const editingHeader = view.state.selection.ranges.some(selection =>
          selection.from <= headerLine.to && selection.to >= headerLine.from);
        if (editingHeader) {
          ranges.push(Decoration.widget({widget: new CalloutHeaderWidget(child.from, child.type, child.title, false), side: -1}).range(child.headerFrom));
        } else {
          suppressed.push({from: child.headerFrom, to: child.headerTo});
          ranges.push(Decoration.replace({widget: new CalloutHeaderWidget(child.from, child.type, child.title, true)}).range(child.headerFrom, child.headerTo));
        }
      }
    } else {
      suppressed.push(callout);
      collapseMultilineSource(
        view,
        ranges,
        callout.from,
        callout.to,
        new BlockquoteWidget(source.slice(callout.from, callout.to), callout.from, callout.type),
      );
    }
  }

  for (const wiki of analysis.wikiLinks) {
    if (isInside(wiki, codeRanges) || isInside(wiki, suppressed)) continue;
    suppressed.push(wiki);
      ranges.push(Decoration.mark({ class: `cm-live-wikilink ${renderClassNames.link} ${renderClassNames.wikiLink}` }).range(wiki.from, wiki.to));

    ranges.push(Decoration.replace({}).range(wiki.from, wiki.separator == null ? wiki.from + 2 : wiki.separator + 1));
    ranges.push(Decoration.replace({}).range(wiki.to - 2, wiki.to));
  }

  for (const highlight of analysis.highlights) {
    if (isInside(highlight, codeRanges) || isInside(highlight, suppressed)) continue;
    ranges.push(Decoration.mark({ class: `cm-live-highlight ${renderClassNames.highlight}` }).range(highlight.contentFrom, highlight.contentTo));
    ranges.push(Decoration.replace({inlineSyntax: true}).range(highlight.from, highlight.contentFrom));
    ranges.push(Decoration.replace({inlineSyntax: true}).range(highlight.contentTo, highlight.to));
  }

  for (const match of (profile === "tegg" ? source.matchAll(/[ \t]*\{#([A-Za-z][A-Za-z0-9_.:-]*)\}[ \t]*$/gm) : [])) {
    const from = match.index ?? 0;
    const range = { from, to: from + match[0].length };
    if (isInside(range, codeRanges) || isInside(range, suppressed)) continue;
    if (isRangeActive(view, view.state.doc.lineAt(from).from, range.to)) {
      ranges.push(Decoration.mark({ class: "cm-live-heading-id" }).range(range.from, range.to));
    } else {
      ranges.push(Decoration.replace({}).range(range.from, range.to));
    }
  }

  for (let from = 0; profile !== "gfm" && from < source.length; from++) {
    const match = inlineMathAt(source, from);
    if (!match) continue;
    const range = {from, to: match.to};
    from = match.to - 1;
    if (isInside(range, codeRanges) || isInside(range, suppressed)) continue;
    suppressed.push(range);
    if (!isRangeActive(view, range.from, range.to)) {
      ranges.push(Decoration.replace({ widget: new InlineMathWidget(match.source, range.from) }).range(range.from, range.to));
    }
  }

  for (const match of (profile === "gfm" ? [] : source.matchAll(/:([+\-\w]+):/g))) {
    const emoji = (emojiMap as Record<string, string>)[match[1]];
    if (!emoji) continue;
    const range = {from: match.index!, to: match.index! + match[0].length};
    if (isInside(range, codeRanges) || isInside(range, suppressed) || inlineExcluded.some(r => range.from < r.to && range.to > r.from)) continue;
    ranges.push(Decoration.replace({emojiSyntax: true, widget: new EmojiWidget(emoji, match[1], range.from)}).range(range.from, range.to));
  }
  for (const pair of (profile === "tegg" ? scriptFormatting(view.state) : [])) {
    if (isInside(pair, codeRanges) || isInside(pair, suppressed)) continue;
    const className = pair.tag === "sub" ? `cm-live-sub ${renderClassNames.subscript}` : `cm-live-sup ${renderClassNames.superscript}`;
    ranges.push(Decoration.mark({class: className}).range(pair.contentFrom, pair.contentTo));
    ranges.push(Decoration.replace({inlineSyntax: true}).range(pair.from, pair.contentFrom));
    ranges.push(Decoration.replace({inlineSyntax: true}).range(pair.contentTo, pair.to));
  }

  const documentLines = source.split("\n");
  let documentOffset = 0;
  for (let index = 0; index < documentLines.length; index += 1) {
    const line = documentLines[index].replace(/\r$/, "");
    const definition = line.match(/^([ \t]*):[ \t]+(.+)$/);
    const currentRange = { from: documentOffset, to: documentOffset + line.length };
    if (profile === "tegg" && definition && !isInside(currentRange, codeRanges) && !isInside(currentRange, suppressed)) {
      ranges.push(Decoration.line({ class: `cm-live-definition-description ${renderClassNames.definitionDescription}` }).range(currentRange.from));
      const previousLine = index > 0 ? documentLines[index - 1].replace(/\r$/, "") : "";
      if (previousLine.trim() && !/^\s*:/.test(previousLine)) {
        const previousFrom = currentRange.from - documentLines[index - 1].length - 1;
        ranges.push(Decoration.line({ class: `cm-live-definition-term ${renderClassNames.definitionTerm}` }).range(previousFrom));
      }
      if (!isRangeActive(view, currentRange.from, currentRange.to)) {
        ranges.push(Decoration.replace({}).range(currentRange.from, currentRange.from + definition[0].indexOf(definition[2])));
      }
    }
    documentOffset += documentLines[index].length + (index < documentLines.length - 1 ? 1 : 0);
  }

  const quoteDepths = new Map<number, number>();
  const literalReferences = new Set<number>();
  let referenceEnvironment: Record<string, unknown> | undefined;
  syntaxTree(view.state).iterate({
    enter(node) {
      const nodeRange = { from: node.from, to: node.to };
      if (isInside(nodeRange, suppressed)) return false;
      const name = node.name;
      if (name === "Document") return;
      if (name === "Paragraph") {
        const trailing = trailingLiveBreak(source, node.node);
        if (trailing) ranges.push(Decoration.replace({breakSyntax: true}).range(trailing.from, trailing.to - 1));
        if (!isInside(nodeRange, callouts)) addBlockLineDecorations(view, ranges, node.from, node.to,
          `cm-live-paragraph ${renderClassNames.paragraph}`, "cm-live-paragraph");
        return;
      }
      const semantic = semanticAncestor(node.node);
      const active = isRangeActive(view, semantic.from, semantic.to);
      const raw = source.slice(node.from, node.to);

      if (name === "Entity" || name === "Escape") {
        const decoded = name === "Entity" ? decodeEntity(raw) : raw.slice(1);
        if (decoded !== raw) ranges.push(Decoration.replace({literalSyntax: true, widget: new LiteralWidget(decoded, name === "Escape")}).range(node.from, node.to));
        else ranges.push(Decoration.mark({class: "cm-live-literal"}).range(node.from, node.to));
        return false;
      }

      if (/^(?:ATXHeading[1-6]|SetextHeading[12])$/.test(name)) {
        const level = Number(name.slice(-1));
        addBlockLineDecorations(view, ranges, node.from, node.to,
          `${renderClassNames.heading} ${renderClassNames.heading}-${level} cm-live-heading cm-live-heading-${level}`, "cm-live-heading");
        if (!source.slice(0, node.from).trim()) {
          ranges.push(Decoration.line({class: "cm-live-heading-document-start"}).range(view.state.doc.lineAt(node.from).from));
        } else if (frontmatter.to > 0 && node.from >= frontmatter.to && !source.slice(frontmatter.to, node.from).trim()) {
          // Metadata already supplies the shared 24px gap.
          ranges.push(Decoration.line({class: "cm-live-heading-after-metadata"}).range(view.state.doc.lineAt(node.from).from));
        }
        if (node.node.prevSibling?.name === "HorizontalRule") {
          // The rule's existing bottom margin already exceeds a heading's gap.
          ranges.push(Decoration.line({class: "cm-live-heading-after-spaced-block"}).range(view.state.doc.lineAt(node.from).from));
        }
        const next = node.node.nextSibling;
        if (next) {
          headingFollowers.push({from: next.from, to: next.to});
        }
      } else if (name === "StrongEmphasis") {
        ranges.push(Decoration.mark({ class: `cm-live-strong ${renderClassNames.strong}` }).range(node.from, node.to));
      } else if (name === "Emphasis") {
        ranges.push(Decoration.mark({ class: `cm-live-emphasis ${renderClassNames.emphasis}` }).range(node.from, node.to));
      } else if (name === "Strikethrough") {
        ranges.push(Decoration.mark({ class: `cm-live-strike ${renderClassNames.strike}` }).range(node.from, node.to));
      } else if (name === "InlineCode") {
        ranges.push(Decoration.mark({ class: `cm-live-inline-code ${renderClassNames.inlineCode}` }).range(node.from, node.to));
      } else if (name === "Link") {
        if (!node.node.getChild("URL")) {
          const parser = parserFor(profile);
          if (!referenceEnvironment) {referenceEnvironment = {}; parser.parse(source, referenceEnvironment);}
          const tokens = parser.parseInline(raw, referenceEnvironment)[0]?.children ?? [];
          if (tokens[0]?.type !== "link_open" || tokens.at(-1)?.type !== "link_close") {
            literalReferences.add(node.from);
            return;
          }
        }
        if (!/^\[![A-Za-z]+\]/.test(raw)) {
          const linkedImage = parseLinkedImage(raw);
          if (linkedImage && !active) {
            suppressed.push(nodeRange);
            const resolvedSource = imageForView(view, linkedImage.src);
            ranges.push(Decoration.replace({
              widget: new ImageWidget(resolvedSource, linkedImage.alt, linkedImage.title, node.from),
            }).range(node.from, node.to));
            return false;
          }
          ranges.push(Decoration.mark({ class: `cm-live-link ${renderClassNames.link}` }).range(node.from, node.to));
          const reference = raw.match(/^\[([^\]]+)\]\[([^\]]*)\]$/);
          if (reference) {
            const labelEnd = raw.indexOf("]");
            ranges.push(Decoration.replace({}).range(node.from, node.from + 1));
            ranges.push(Decoration.replace({}).range(node.from + labelEnd, node.to));
            return false;
          }
        }
      } else if (name === "Autolink") {
        ranges.push(Decoration.mark({ class: `cm-live-link ${renderClassNames.link}` }).range(node.from, node.to));
      } else if (name === "URL" && semantic.name !== "Link" && semantic.name !== "Autolink") {
        ranges.push(Decoration.mark({ class: `cm-live-link ${renderClassNames.link}` }).range(node.from, node.to));
      } else if (name === "Image") {
        const image = parseInlineImage(raw);
        if (image && !active) {
          suppressed.push(nodeRange);
          const resolvedSource = imageForView(view, image.src);
          ranges.push(Decoration.replace({ widget: new ImageWidget(resolvedSource, image.alt, image.title, node.from) }).range(node.from, node.to));
          return false;
        }
      } else if (name === "Blockquote") {
        if (!isInside(nodeRange, callouts)) {
          const first = view.state.doc.lineAt(node.from).number;
          const last = view.state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
          for (let number = first; number <= last; number++) {
            const from = view.state.doc.line(number).from;
            quoteDepths.set(from, (quoteDepths.get(from) ?? 0) + 1);
          }
        }
      } else if (name === "BulletList" || name === "OrderedList") {
        addBlockLineDecorations(view, ranges, node.from, node.to, "cm-live-list-block", "cm-live-list-block");
      } else if (name === "ListItem") {
        addLineDecoration(view, ranges, node.from, node.to, `cm-live-list-item ${renderClassNames.listItem}`);
      } else if (name === "Table") {
        if (!active) {
          suppressed.push(nodeRange);
          collapseMultilineSource(view, ranges, node.from, node.to, new TableWidget(raw, node.from, node.to));
          return false;
        }
        addLineDecoration(view, ranges, node.from, node.to, "cm-live-table-line");
      } else if (name === "FencedCode") {
        const code = parseFencedCode(raw);
        // Container prefixes belong to the quote/list, not the editable code body.
        if (node.node.parent?.name !== "Document") {
          addLineDecoration(view, ranges, node.from, node.to, "cm-live-code-line");
          return false;
        }
        if (code) {
          suppressed.push(nodeRange);
          collapseMultilineSource(view, ranges, node.from, node.to, new EditableCodeWidget(raw, node.from, node.to));
          return false;
        }
        addLineDecoration(view, ranges, node.from, node.to, "cm-live-code-line");
      } else if (name === "CodeBlock") {
        const blockRange = lineRange(view, nodeRange);
        if (node.node.parent?.name !== "Document") {
          addLineDecoration(view, ranges, blockRange.from, blockRange.to, "cm-live-code-line");
          return false;
        }
        suppressed.push(blockRange);
        collapseMultilineSource(view, ranges, blockRange.from, blockRange.to, new EditableCodeWidget(source.slice(blockRange.from, blockRange.to), blockRange.from, blockRange.to));
        return false;
      } else if (name === "HorizontalRule" && !active) {
        ranges.push(Decoration.replace({ widget: new HorizontalRuleWidget(node.from) }).range(node.from, node.to));
        return false;
      }

      // Breaks remain visual line boundaries while editing the surrounding text.
      if (name === "HardBreak") {
        const markerTo = source[node.to - 1] === "\n" ? node.to - 1 : node.to;
        if (markerTo > node.from) ranges.push(Decoration.replace({breakSyntax: true}).range(node.from, markerTo));
        return;
      }
      if (name === "HTMLTag" && simpleBreakTag.test(raw)) {
        ranges.push(Decoration.replace({widget: new InlineBreakWidget(), breakSyntax: true}).range(node.from, node.to));
        return;
      }

      if (name === "QuoteMark") {
        // Keep the final blank space as a real caret anchor on empty quote lines.
        // WebKit otherwise maps the all-hidden line back to the preceding text.
        const tail = source.slice(node.to, view.state.doc.lineAt(node.to).to);
        const to = source[node.to] === " " && tail.trim() ? node.to + 1 : node.to;
        ranges.push(Decoration.replace({quoteSyntax: true}).range(node.from, to));
        return;
      }

      // Heading syntax stays hidden even when its text is being edited.
      if (name === "HeaderMark") {
        let to = node.to;
        while (source[to] === " " || source[to] === "\t") to += 1;
        ranges.push(Decoration.replace({ headingSyntax: true }).range(node.from, to));
        return;
      }

      if (active && !(name === "ListMark" && quoteDepths.has(view.state.doc.lineAt(node.from).from))
        && !["Link", "Autolink", "StrongEmphasis", "Emphasis", "Strikethrough", "InlineCode"].includes(semantic.name)) return;

      if (["EmphasisMark", "StrikethroughMark", "CodeMark"].includes(name)) {
        ranges.push(Decoration.replace({inlineSyntax: true}).range(node.from, node.to));
      } else if (["LinkMark", "URL", "LinkTitle"].includes(name) && !literalReferences.has(semantic.from) && !/^\[![A-Za-z]+\]/.test(source.slice(semantic.from, semantic.to))) {
        if (name !== "URL" || semantic.name === "Link") {
          ranges.push(Decoration.replace({}).range(node.from, node.to));
        }
      } else if (name === "TaskMarker") {
        ranges.push(Decoration.replace({
          widget: new TaskWidget(/x/i.test(raw), node.from, node.to, raw),
        }).range(node.from, node.to));
      } else if (name === "ListMark") {
        const following = source.slice(node.to, Math.min(source.length, node.to + 5));
        if (/^\s+\[[ xX]\]/.test(following)) {
          ranges.push(Decoration.replace({}).range(node.from, node.to));
        } else {
          const marker = /^\d/.test(raw) ? raw : "•";
          ranges.push(Decoration.replace({ widget: new MarkerWidget(marker, node.from) }).range(node.from, node.to));
        }
      } else if (name === "QuoteMark") {
        ranges.push(Decoration.replace({}).range(node.from, node.to));
      } else if (name === "CodeInfo") {
        ranges.push(Decoration.replace({}).range(node.from, node.to));

      }
    },
  });

  for (const [from, depth] of quoteDepths) {
    ranges.push(Decoration.line({class: `cm-live-quote-line ${renderClassNames.quote}`,
      attributes: {style: `--md-quote-depth: ${depth}`}}).range(from));
  }

  // Attach the gap to the following block's first visible line, including
  // widgets on a collapsed block's closing line. Never reduce its inner rows.
  const hiddenLines = new Set(ranges.filter(range =>
    /cm-live-collapsed-source/.test(range.value.spec.class ?? "")
  ).map(range => range.from));
  for (const block of headingFollowers) {
    let line = view.state.doc.lineAt(block.from);
    while (line.from < block.to) {
      if (!hiddenLines.has(line.from)) {
        ranges.push(Decoration.line({class: "cm-live-after-heading"}).range(line.from));
        break;
      }
      if (line.number === view.state.doc.lines) break;
      line = view.state.doc.line(line.number + 1);
    }
  }
  return Decoration.set(ranges, true);
}

const livePreviewDecorations = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.view.composing) {
      // Keep the marked-text DOM owned by WebKit intact. Mapping existing
      // decorations is safe; rebuilding widgets can cancel an IME session.
      this.decorations = this.decorations.map(update.changes);
      return;
    }
    if (update.docChanged || update.selectionSet || update.focusChanged
      || update.transactions.some((transaction) => transaction.effects.length > 0)) {
      this.decorations = buildDecorations(update.view);
    }
  }
}, {
  decorations: (plugin) => plugin.decorations,
  provide: (plugin) => EditorView.atomicRanges.of(view =>
    view.plugin(plugin)?.decorations.update({
      filter: (_from, _to, value) => value.spec.quoteSyntax === true || value.spec.literalSyntax === true || value.spec.emojiSyntax === true || value.spec.headingSyntax === true || value.spec.breakSyntax === true || value.spec.inlineSyntax === true,
    }) ?? Decoration.none),
});

type CaretPointDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => globalThis.Range | null;
};

// Live Preview intentionally collapses blank and internal-marker lines to zero height.
// CodeMirror's coordinate-only hit testing cannot distinguish stacked zero-height rows,
// so resolve the caret through the line that actually received the pointer event first.
function liveLinePositionAtPointer(view: EditorView, event: MouseEvent): number | null {
  const target = event.target as Node | null;
  const element = target instanceof Element ? target : target?.parentElement;
  const line = element?.closest<HTMLElement>(".cm-line");
  if (!line || !view.contentDOM.contains(line) || element?.closest('[contenteditable="false"]')) return null;

  try {
    const lineFrom = view.posAtDOM(line, 0);
    const lineTo = view.posAtDOM(line, line.childNodes.length);
    const ownerDocument = view.contentDOM.ownerDocument as CaretPointDocument;
    const caretPosition = ownerDocument.caretPositionFromPoint?.(event.clientX, event.clientY);
    const caretRange = caretPosition ? null : ownerDocument.caretRangeFromPoint?.(event.clientX, event.clientY);
    const caretNode = caretPosition?.offsetNode ?? caretRange?.startContainer;
    const caretOffset = caretPosition?.offset ?? caretRange?.startOffset;
    if (caretNode && caretOffset != null && (caretNode === line || line.contains(caretNode))) {
      return Math.max(lineFrom, Math.min(lineTo, view.posAtDOM(caretNode, caretOffset)));
    }

    const bounds = line.getBoundingClientRect();
    return event.clientX <= bounds.left + bounds.width / 2 ? lineFrom : lineTo;
  } catch {
    return null;
  }
}

const livePreviewMouseSelection = EditorView.mouseSelectionStyle.of((view, event) => {
  if (event.button !== 0) return null;
  const initialAnchor = liveLinePositionAtPointer(view, event);
  if (initialAnchor == null) return null;
  let anchor: number = initialAnchor;
  let initialSelection = view.state.selection;
  const clickCount = event.detail;

  return {
    get(currentEvent, extend, multiple) {
      const fallback = view.posAtCoords({ x: currentEvent.clientX, y: currentEvent.clientY }, false);
      const head = liveLinePositionAtPointer(view, currentEvent) ?? fallback ?? anchor;
      let range = EditorSelection.range(anchor, head);
      if (clickCount === 2) range = view.state.wordAt(head) ?? EditorSelection.cursor(head);
      if (clickCount >= 3) {
        const line = view.state.doc.lineAt(head);
        range = EditorSelection.range(line.from, line.to);
      }
      if (extend) range = EditorSelection.range(initialSelection.main.anchor, range.head);
      if (multiple) return EditorSelection.create([...initialSelection.ranges, range], initialSelection.ranges.length);
      return EditorSelection.create([range]);
    },
    update(update) {
      if (!update.docChanged) return false;
      anchor = update.changes.mapPos(anchor);
      initialSelection = initialSelection.map(update.changes);
      return true;
    },
  };
});

// Keep an empty script editable without leaving an unmatched Markdown delimiter.
export function deleteScriptContent(view: EditorView, backwards: boolean) {
  if (view.composing || view.state.selection.ranges.length !== 1 || !view.state.selection.main.empty) return false;
  const head = view.state.selection.main.head;
  const pair = [...scriptFormatting(view.state), ...inlineHtmlFormatting(view.state).pairs.filter(p => p.tag === "sub" || p.tag === "sup")]
    .find(p => backwards ? head === p.contentTo || head === p.to : head === p.contentFrom || head === p.from);
  if (!pair) return false;
  const content = view.state.sliceDoc(pair.contentFrom, pair.contentTo);
  if (Array.from(new Intl.Segmenter(undefined, {granularity: "grapheme"}).segment(content)).length !== 1) return false;
  const insert = `<${pair.tag}></${pair.tag}>`;
  view.dispatch({changes: {from: pair.from, to: pair.to, insert}, selection: {anchor: pair.from + pair.tag.length + 2}, userEvent: "delete"});
  return true;
}

// Deleting next to hidden formatting must not delete half of its delimiter pair.
export function deleteBesideInlineSyntax(view: EditorView, backwards: boolean) {
  if (view.composing || view.state.selection.ranges.length !== 1 || !view.state.selection.main.empty) return false;
  const spans: {from: number; to: number}[] = [];
  view.plugin(livePreviewDecorations)?.decorations.between(0, view.state.doc.length, (from, to, value) => {
    if (value.spec.inlineSyntax) spans.push({from, to});
  });
  let position = view.state.selection.main.head;
  const original = position;
  for (;;) {
    const span = spans.find(span => backwards ? span.to === position : span.from === position);
    if (!span) break;
    position = backwards ? span.from : span.to;
  }
  if (position === original) return false;
  const next = view.moveByChar(EditorSelection.cursor(position), !backwards).head;
  if (next === position) return true;
  const from = Math.min(position, next), to = Math.max(position, next);
  // A grapheme deletion only touches visible text, leaving the skipped syntax intact.
  view.dispatch({changes: {from, to, insert: ""}, selection: {anchor: from}, userEvent: "delete"});
  return true;
}

/** Keep plain quote editing structural, even though its prefixes are hidden. */
export function editQuoteBoundary(view: EditorView, enter: boolean): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty || view.state.selection.ranges.length !== 1) return false;
  const line = view.state.doc.lineAt(selection.head);
  const prefix = /^(?: {0,3}>[ \t]?)+/.exec(line.text)?.[0];
  if (!prefix) return false;
  let quote = false, excluded = false;
  syntaxTree(view.state).iterate({from: selection.head, to: selection.head, enter(node) {
    if (node.name === "Blockquote") quote = true;
    if (["FencedCode", "CodeBlock", "ListItem"].includes(node.name)) excluded = true;
  }});
  if (!quote || excluded || /^\[!/.test(line.text.slice(prefix.length))) return false;
  const contentFrom = line.from + prefix.length;
  if (!enter && selection.head > contentFrom) return false;
  if (!enter || !line.text.slice(prefix.length).trim()) {
    const lastMarker = prefix.lastIndexOf(">");
    view.dispatch({changes: {from: line.from + lastMarker, to: contentFrom},
      selection: {anchor: line.from + lastMarker}, userEvent: "delete"});
  } else {
    const at = Math.max(contentFrom, selection.head);
    view.dispatch({changes: {from: at, insert: "\n" + prefix},
      selection: {anchor: at + 1 + prefix.length}, userEvent: "input"});
  }
  return true;
}

export const livePreview = [EditorView.clipboardOutputFilter.of(literalClipboardText), Prec.highest(keymap.of([
  {key: "Enter", run: view => editQuoteBoundary(view, true)},
  {key: "Shift-Enter", run: insertLiveBreak},
  {key: "Backspace", run: view => editQuoteBoundary(view, false) || deleteScriptContent(view, true) || deleteBesideInlineSyntax(view, true) || deleteLiveBreak(view, true)},
  {key: "Delete", run: view => deleteScriptContent(view, false) || deleteBesideInlineSyntax(view, false) || deleteLiveBreak(view, false)},
])), metadataSourceState, livePreviewDecorations, livePreviewMouseSelection, liveLinks];
