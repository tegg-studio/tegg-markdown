import {preserveCodeStructure, selectCodeBoundary} from "./codeStructure";
import {selectionHistory} from "./selectionHistory";
import {undo, redo} from "./selectionHistory";
import {indentList, editListBoundary, deleteListSelection, deleteListContinuation} from "./listCommands";
import {insertNewlineContinueMarkupCommand} from "@codemirror/lang-markdown";
import {editingPerformancePolicy} from "./editingBudget";
import {setUIText, setUILabel} from "./uiContext";
import {bindEngines} from "./renderEngines";
import {imageForView, resourceContext} from "./editorHost";
import {EditableCodeWidget, unwrapCodeContainer} from "./codeEditing";
import {LiteralWidget, decodeEntity, literalClipboardText} from "./literalEditing";
import {scriptFormatting} from "./scriptFormatting";
import {EmojiWidget} from "./emojiEditing";
import {inlineHtmlFormatting} from "./inlineHtml";
import {simpleBreakTag, trailingLiveBreak, InlineBreakWidget, deleteLiveBreak, insertLiveBreak} from "./liveBreaks";
import { liveLinks } from "./liveLinks";
import { createMetadataPanel, disposeMetadataPanel } from "./metadata";

import {observeSurfaceAppearance} from "./appearance";
import {inlineMathAt} from "./mathSyntax";
import {action, copySource, objectActions, imagePlaceholder, openPanel, openObjectViewer, disposeInteractions} from "./renderInteraction";
import {renderMarkdown} from "./markdown";
import { makeHorizontalScrollRegion } from "./localScroll";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, Prec, Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, Direction, EditorView, keymap, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
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
  createHtmlPreview,
  createRenderToolbar,
  renderClassNames,
  renderDiagram,
  renderMathInto,
  sanitizeRenderedHtml,
} from "./renderKit";
import {EditableTableWidget} from "./tableWidget";
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

function editObject(view:EditorView,from:number,kind?:string){
  const request=new CustomEvent("tegg-edit-object",{bubbles:true,cancelable:true,detail:{from,kind}});
  if(view.dom.dispatchEvent(request))editSource(view,from);
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

    const canvas = document.createElement("div");
    canvas.className = `diagram-canvas ${renderClassNames.canvas}`;
    canvas.dataset.enhancements="false";
    const edit=()=>editObject(view,this.from,this.kind==="dot"?"graphviz":this.kind);
    const blockToolbar=objectActions({
      edit:view.state.readOnly?undefined:edit, editLabel:this.kind==="math"?"Edit formula":"Edit diagram",
      view:()=>openObjectViewer(blockToolbar.querySelector<HTMLButtonElement>('button[data-tegg-ui-label="'+(this.kind==="math"?"View formula":"View diagram")+'"]')!,canvas,this.source,this.kind==="math"?"Formula":"Diagram",view.state.readOnly?undefined:edit),
      viewLabel:this.kind==="math"?"View formula":"View diagram",
      more:[{label:this.kind==="math"?"Copy TeX":"Copy source",run:()=>{void copySource(this.source,wrapper);}},
        ...(!view.state.readOnly?[{label:"Edit Source",run:()=>editSource(view,this.from+(this.kind==="math"?2:3))}]:[])]
    });
    wrapper.classList.add("md-object-block");
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
    const sourceDocument = view.state.doc;
    span.className = "cm-live-math-inline";
    span.dataset.sourceFrom = String(this.from);
    span.tabIndex = 0;
    setUILabel(span, "Formula: {value}", {value: String(this.source)});
    bindEngines(span, view.state.facet(resourceContext).engines);
    renderMathInto(span, { kind: "math", source: this.source, display: "inline" });
    const controls = document.createElement("span");
    controls.className = "md-object-actions cm-live-math-actions";
    controls.hidden = true;
    controls.style.display = "none";
    controls.append(action("View formula", () => openObjectViewer(span, span, this.source, "Formula",
      view.state.readOnly ? undefined : () => editObject(view, this.from, "math"))));
    if (!view.state.readOnly) controls.append(action("Edit formula", () => {
      if (!view.state.readOnly) editObject(view, this.from, "math");
    }));
    // Keep the menu outside CodeMirror's content and scroll layers. The
    // formula remains the focus target while the menu is a transient overlay.
    const overlayHost = view.dom.closest<HTMLElement>(".tegg-surface") ?? view.dom.parentElement ?? view.dom;
    overlayHost.append(controls);
    const lifetime = new AbortController();
    const select = () => {
      const rect = span.getBoundingClientRect();
      const surface = span.closest<HTMLElement>(".tegg-surface") ?? view.dom;
      const toolbarInset = Number.parseFloat(getComputedStyle(surface).getPropertyValue("--toolbar-inset")) || 0;
      const above = rect.top - toolbarInset - 8;
      const below = window.innerHeight - rect.bottom - 8;
      const side = above >= 48 || above > below ? "above" : "below";
      controls.dataset.side = side;
      // Anchor the separate overlay in viewport coordinates without moving
      // the formula or its following text.
      controls.style.position = "fixed";
      controls.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 190))}px`;
      controls.style.top = side === "below" ? `${rect.bottom + 5}px` : "auto";
      controls.style.bottom = side === "above" ? `${window.innerHeight - rect.top + 5}px` : "auto";
      controls.hidden = false;
      controls.style.removeProperty("display");
      span.classList.add("cm-live-object-selected");
    };
    const clearSelection = () => {
      controls.hidden = true;
      controls.style.display = "none";
      span.classList.remove("cm-live-object-selected");
    };
    // Keep focus on the formula while a pointer activates a menu button.
    // WebKit otherwise reports a null relatedTarget on focusout and can hide
    // the button before its click is delivered.
    controls.addEventListener("mousedown", event => event.preventDefault(), {signal: lifetime.signal});
    span.addEventListener("focusin", event => {
      if (event.target === span) select();
    }, {signal: lifetime.signal});
    span.addEventListener("focusout", event => {
      if (controls.contains(event.relatedTarget as Node | null)) return;
      if (event.relatedTarget) { clearSelection(); return; }
      queueMicrotask(() => {
        if (!controls.contains(document.activeElement)) clearSelection();
      });
    }, {signal: lifetime.signal});
    controls.addEventListener("focusout", event => {
      if (event.relatedTarget !== span && !controls.contains(event.relatedTarget as Node | null)) clearSelection();
    }, {signal: lifetime.signal});
    controls.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); clearSelection(); view.focus();
    }, {signal: lifetime.signal});
    const hideOnViewportMove = () => clearSelection();
    window.addEventListener("scroll", hideOnViewportMove, {capture: true, passive: true, signal: lifetime.signal});
    window.addEventListener("resize", hideOnViewportMove, {signal: lifetime.signal});
    span.addEventListener("click", event => {
      event.stopPropagation();
      select();
      span.focus();
    }, {signal: lifetime.signal});
    span.addEventListener("dblclick",event=>{
      event.stopPropagation();
      if (view.state.readOnly) openObjectViewer(span, span, this.source, "Formula");
      else editObject(view,this.from,"math");
    }, {signal: lifetime.signal});
    span.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); clearSelection(); view.focus(); return;
      }
      if (event.target !== span) return;
      if (event.key === "Enter" || event.key === "F2") {
        event.preventDefault(); event.stopPropagation();
        if (view.state.readOnly) openObjectViewer(span, span, this.source, "Formula");
        else editObject(view, this.from, "math");
      } else if (event.key === " ") {
        event.preventDefault(); event.stopPropagation(); select();
      }
    }, {signal: lifetime.signal});
    widgetCleanup.set(span, () => {
      lifetime.abort(); controls.remove();
      // Losing focus can replace this widget while its viewer is opening.
      // Retain it only for a replacement in the same document and Live view;
      // a mode/document switch must not retain an old viewer or edit callback.
      queueMicrotask(() => {
        const current = inlineMathAt(view.state.doc.toString(), this.from);
        const replacement = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-live-math-inline")]
          .find(node => node.dataset.sourceFrom === String(this.from));
        if (!view.dom.isConnected || view.state.doc !== sourceDocument || current?.source !== this.source || !replacement)
          disposeInteractions(span);
      });
    });
    return span;
  }

  destroy(dom: HTMLElement) { widgetCleanup.get(dom)?.(); }
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
    wrapper.addEventListener("click", event => {
      if ((event.target as Element).closest("summary")) return;
      editSource(view, this.from);
    });
    wrapper.addEventListener("keydown", (event) => {
      if (event.target === wrapper && (event.key === "Enter" || event.key === " ")) editSource(view, this.from);
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
    if(this.src)image.src = this.src;
    image.alt = this.alt;
    image.loading = "lazy";
    image.draggable = false;

    const fallback = imagePlaceholder(this.alt || this.src,!this.src);
    fallback.classList.add("cm-live-image-fallback");
    fallback.hidden = !!this.src;
    image.hidden = !this.src;
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
      if (event.target===figure && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        edit();
      }
    });
    const controls=objectActions({edit:view.state.readOnly?undefined:()=>editObject(view,this.from,"image"),editLabel:"Edit image"});
    figure.classList.add("md-object-block");
    figure.append(controls,image,fallback);
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
    readonly aligned = false,
    readonly editable = true,
  ) { super(); }
  eq(other: TaskWidget) {
    return other.checked === this.checked && other.from === this.from && other.source === this.source && other.aligned === this.aligned && other.editable === this.editable;
  }

  toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.disabled = !this.editable;
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
    if (!this.aligned) return input;
    const marker = document.createElement("span");
    marker.className = "cm-live-list-marker cm-live-task-marker";
    marker.append(input);
    return marker;
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
const setCalloutSource = StateEffect.define<number | null>();
const calloutSourceState = StateField.define<number | null>({
  create: () => null,
  update(value, transaction) {
    if (value != null) value = transaction.changes.mapPos(value, -1);
    for (const effect of transaction.effects) if (effect.is(setCalloutSource)) value = effect.value;
    return value;
  },
});
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
  constructor(readonly from: number, readonly type: string, readonly title: string, readonly titleFrom: number) { super(); }
  eq(other: CalloutHeaderWidget) { return this.from === other.from && this.type === other.type && this.title === other.title && this.titleFrom === other.titleFrom; }
  toDOM(view: EditorView) {
    const header = document.createElement("span");
    header.className = "callout-editor-header";
    applyCalloutAppearance(header, this.type);
    header.append(calloutTypeButton(view, this.from, this.type));
    if (!this.title) {
      const title = document.createElement("span");
      title.className = "callout-title";
      title.textContent = this.type.toUpperCase();
      if (!view.state.readOnly) title.addEventListener("click", () => {
        view.dispatch({changes: {from: this.titleFrom, insert: " "}, selection: {anchor: this.titleFrom + 1}, userEvent: "input"});
        view.focus();
      });
      header.append(title);
    }
    const source = document.createElement("button");
    source.type = "button";
    source.textContent = "⋯";
    setUILabel(source, "View Callout Markdown");
    source.title = "View Callout Markdown";
    source.addEventListener("click", event => {
      event.stopPropagation();
      view.dispatch({effects: setCalloutSource.of(this.from), selection: {anchor: this.titleFrom}, scrollIntoView: true});
      view.focus();
    });
    source.classList.add("callout-source-action");
    header.append(source);
    return header;
  }
  destroy(dom: HTMLElement) { widgetCleanup.get(dom)?.(); disposeInteractions(dom); }
  ignoreEvent() { return true; }
}

class CalloutSourceToolbar extends WidgetType {
  eq() { return true; }
  toDOM(view: EditorView) {
    const button = action("Return to Callout", () => {
      view.dispatch({effects: setCalloutSource.of(null)});
      view.focus();
    });
    button.classList.add("callout-source-action");
    return button;
  }
  ignoreEvent() { return true; }
}

class TableWidget extends EditableTableWidget {}

function isRangeActive(view: EditorView, from: number, to: number) {
  if (!view.hasFocus) return false;
  if (view.composing) return true;
  return view.state.selection.ranges.some((selection) => {
    if (selection.empty) return selection.from >= from && selection.from < to;
    return selection.from < to && selection.to > from;
  });
}

// Range lists in a decoration build are append-only. Prefix maxima answer
// containment in O(log n), avoiding quadratic scans of dense technical notes.
const containmentIndexes=new WeakMap<SourceRange[],{length:number;starts:number[];ends:number[]}>();
function containingEnd(position:number,containers:SourceRange[]){
  let index=containmentIndexes.get(containers);
  if(!index||index.length!==containers.length){
    const sorted=[...containers].sort((a,b)=>a.from-b.from);let end=-1;
    index={length:containers.length,starts:[],ends:[]};
    for(const item of sorted){index.starts.push(item.from);index.ends.push(end=Math.max(end,item.to));}
    containmentIndexes.set(containers,index);
  }
  let low=0,high=index.starts.length;
  while(low<high){const middle=(low+high)>>>1;if(index.starts[middle]<=position)low=middle+1;else high=middle;}
  return low?index.ends[low-1]:-1;
}
function isInside(range:SourceRange,containers:SourceRange[]){
  return containers.length<32?containers.some(c=>range.from>=c.from&&range.to<=c.to):containingEnd(range.from,containers)>=range.to;
}
function isPositionInside(position:number,containers:SourceRange[]){
  return containers.length<32?containers.some(c=>position>=c.from&&position<c.to):containingEnd(position,containers)>position;
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

// Lezer splits an HTML block at blank lines. A complete details element must
// be rendered from one source slice so the browser keeps its body inside it.
function collectDetailsRanges(view: EditorView, codeRanges: SourceRange[]) {
  const complete: SourceRange[] = [];
  const unsupported: SourceRange[] = [];
  const stack: number[] = [];
  const source = view.state.doc.toString();
  for (let number = 1; number <= view.state.doc.lines; number++) {
    const line = view.state.doc.line(number);
    for (const match of line.text.matchAll(/<\/?details\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
      const from = line.from + match.index!;
      const to = from + match[0].length;
      if (isInside({from, to}, codeRanges) || source.lastIndexOf("<!--", from) > source.lastIndexOf("-->", from)) continue;
      if (match[0][1] !== "/") {
        // A block opener may have attributes or other HTML on its line, but
        // prose containing the same text is ordinary editable Markdown.
        if (line.text.slice(0, match.index).trim() && stack.length === 0) continue;
        stack.push(line.from);
      } else if (stack.length) {
        const start = stack.pop()!;
        if (stack.length === 0) {
          // The multiline widget replaces its entire closing line. Preserve
          // adjacent Markdown on that line by leaving the container as source.
          const trailing = line.text.slice(match.index! + match[0].length);
          (trailing.trim() ? unsupported : complete).push({from: start, to: line.to});
        }
      } else unsupported.push({from: line.from, to: line.to});
    }
  }
  if (stack.length) unsupported.push({from: stack[0], to: source.length});
  return {complete, unsupported};
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
    if (isInside(range, codeRanges) || isInside(range, definitionRanges) || isEscaped(source, from)) continue;
    if (definitionRanges.some(definition => definition.label === match[1]) && !result.has(match[1])) result.set(match[1], result.size + 1);
  }
  for (const definition of definitionRanges) {
    if (!result.has(definition.label)) result.set(definition.label, result.size + 1);
  }
  return result;
}

function isEscaped(source: string, from: number) {
  let backslashes = 0;
  for (let index = from - 1; index >= 0 && source[index] === "\\"; index--) backslashes++;
  return backslashes % 2 === 1;
}


function buildDecorations(view: EditorView): DecorationSet {
  if(editingPerformancePolicy(view.state.doc.length).sourcePreview)return Decoration.none;
  const profile = view.state.facet(resourceContext).profile ?? "tegg";
  const analysis = analyzeSource(view.state.doc, profile);
  const source = analysis.source;
  const ranges: Range<Decoration>[] = [];
  const suppressed: SourceRange[] = [];
  const headingFollowers: SourceRange[] = [];
  const codeRanges = syntaxRanges(view, new Set(["FencedCode", "CodeBlock", "InlineCode"]));
  const inlineExcluded = syntaxRanges(view, new Set(["InlineCode", "URL", "LinkTitle", "HTMLTag", "Escape"]));

  // Lezer treats a lone nested '-' after a paragraph as an empty list;
  // CommonMark/Reader treats it as a Setext underline. Do not project a false
  // bullet or rewrite the source. Keep this ambiguous item directly editable.
  syntaxTree(view.state).iterate({enter(node) {
    if (node.name !== "BulletList" || node.node.parent?.name !== "ListItem") return;
    const paragraph = node.node.prevSibling;
    const items = node.node.getChildren("ListItem");
    const mark = items[0]?.getChild("ListMark");
    if (paragraph?.name !== "Paragraph" || !mark || source.slice(mark.from, mark.to) !== "-"
        || items[0].to !== mark.to || view.state.doc.lineAt(mark.from).number !== view.state.doc.lineAt(paragraph.to).number + 1) return;
    const item = node.node.parent;
    suppressed.push({from:item.from, to:item.to});
    addLineDecoration(view, ranges, item.from, item.to, "cm-live-list-source");
  }});

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

  const details = collectDetailsRanges(view, codeRanges);
  for (const container of details.complete) {
    suppressed.push(container);
    if (isRangeActive(view, container.from, container.to)) {
      addLineDecoration(view, ranges, container.from, container.to, "cm-live-technical-source");
    } else {
      collapseMultilineSource(view, ranges, container.from, container.to,
        new HtmlPreviewWidget(source.slice(container.from, container.to), container.from, true));
    }
  }

  const inlineHtml = inlineHtmlFormatting(view.state);
  for (const html of collectHtmlRanges(view, inlineHtml.paragraphs)) {
    if (isInside(html, codeRanges) || isInside(html, suppressed)
      || [...details.complete, ...details.unsupported].some(item => html.from < item.to && html.to > item.from)) continue;
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
    if (isInside(range, codeRanges) || isInside(range, definitions) || isEscaped(source, from)
      || inlineExcluded.some(item => range.from < item.to && range.to > item.from)) continue;
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
    const children = callouts.filter(item => item.from >= callout.from && item.to <= callout.to);
    const first = view.state.doc.lineAt(callout.from);
    const last = view.state.doc.lineAt(Math.max(callout.from, callout.to - 1));
    for (let number = first.number; number <= last.number; number++) {
      const line = view.state.doc.line(number);
      const owner = children.filter(item => item.from <= line.to && item.to >= line.from).at(-1) ?? callout;
      const style = resolveCallout(owner.type);
      const edge = `${number === first.number ? " cm-live-callout-source-first" : ""}${number === last.number ? " cm-live-callout-source-last" : ""}`;
      ranges.push(Decoration.line({class: `cm-live-callout-source ${renderClassNames.callout} cm-live-callout-source-${owner.type}${edge}`,
        attributes: {"data-callout-kind": style.id, style: `--callout-light:${style.light};--callout-dark:${style.dark}`},
      }).range(line.from));
    }
    for (const child of children) {
      if (view.state.field(calloutSourceState) === child.from) {
        suppressed.push({from: child.headerFrom, to: child.headerTo});
        ranges.push(Decoration.widget({widget: new CalloutSourceToolbar(), side: -1}).range(child.headerFrom));
        continue;
      }
      const header = source.slice(child.headerFrom, child.headerTo);
      const marker = header.match(/^\[![A-Za-z][A-Za-z0-9_-]*\][+-]?[ \t]*/)?.[0] ?? "";
      const titleFrom = child.headerFrom + marker.length;
      suppressed.push({from: child.headerFrom, to: titleFrom});
      ranges.push(Decoration.replace({widget: new CalloutHeaderWidget(child.from, child.type, child.title, child.headerTo)})
        .range(child.headerFrom, child.title ? titleFrom : child.headerTo));
      if (child.title) {
        ranges.push(Decoration.mark({class: "cm-live-callout-title callout-title"})
          .range(titleFrom, child.headerTo));
      }
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
  const definitionLines = new Map<number, number>();
  if (profile === "tegg" && /^\s*:[ \t]+\S/m.test(source)) {
    let termLine = -1;
    for (const token of parserFor(profile).parse(source, {})) {
      if (token.type === "dt_open") termLine = token.map?.[0] ?? -1;
      if (token.type === "dd_open" && token.map && termLine >= 0) definitionLines.set(token.map[0], termLine);
    }
  }
  let documentOffset = 0;
  for (let index = 0; index < documentLines.length; index += 1) {
    const line = documentLines[index].replace(/\r$/, "");
    const definition = line.match(/^([ \t]*):[ \t]+(.+)$/);
    const currentRange = { from: documentOffset, to: documentOffset + line.length };
    if (definition && definitionLines.has(index) && !isInside(currentRange, codeRanges) && !isInside(currentRange, suppressed)) {
      ranges.push(Decoration.line({ class: `cm-live-definition-description ${renderClassNames.definitionDescription}` }).range(currentRange.from));
      const term = definitionLines.get(index)!;
      const termFrom = view.state.doc.line(term + 1).from;
      ranges.push(Decoration.line({ class: `cm-live-definition-term ${renderClassNames.definitionTerm}` }).range(termFrom));
      if (!isRangeActive(view, currentRange.from, currentRange.to)) {
        ranges.push(Decoration.replace({}).range(currentRange.from, currentRange.from + definition[0].indexOf(definition[2])));
      }
    }
    documentOffset += documentLines[index].length + (index < documentLines.length - 1 ? 1 : 0);
  }

  const quoteDepths = new Map<number, number>();
  const quoteRails = new Map<number, string[]>();
  const literalReferences = new Set<number>();
  // Cache each list's ordinal and marker width once; source numbering is preserved.
  const listMarkers = new Map<number, {text: string; width: number; depth: number; offsets: number[]}>();
  syntaxTree(view.state).iterate({enter(node) {
    if (!["BulletList", "OrderedList"].includes(node.name)) return;
    const items = node.node.getChildren("ListItem");
    const start = Number(source.slice(items[0]?.getChild("ListMark")?.from ?? 0).match(/^\d+/)?.[0] ?? 1);
    const width = node.name === "OrderedList" ? String(start + items.length - 1).length + 1 : 1;
    let depth = 0;
    for (let ancestor = node.node.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.name === "ListItem") depth++;
    }
    const parentItem = node.node.parent?.name === "ListItem" ? node.node.parent : null;
    const parentMarker = parentItem?.getChild("ListMark");
    const parentLayout = parentMarker ? listMarkers.get(parentMarker.from) : undefined;
    const offsets = parentLayout ? [...parentLayout.offsets, parentLayout.width] : [];
    const columnWidth = Math.max(width, items.some(item => item.getChild("Task")) ? 2 : 1);
    items.forEach((item, index) => {
      const mark = item.getChild("ListMark");
      if (mark) listMarkers.set(mark.from, {text: node.name === "OrderedList" ? `${start + index}.` : "•", width: columnWidth, depth, offsets});
    });
  }});
  const listLines = new Map<number, {width: number; depth: number; offsets: number[]; first: boolean}>();
  const containingList = (node: SyntaxNode | null) => {
    for (let current = node; current; current = current.parent) {
      if (current.name === "ListItem") {
        const mark = current.getChild("ListMark");
        if (mark) return listMarkers.get(mark.from);
      }
    }
    return undefined;
  };
  const listOffset = (layout: {width: number; offsets: number[]}) =>
    [...layout.offsets.map(width => `max(1.5em, ${width}ch + .5em)`), `${layout.width}ch`, ".5em"].join(" + ");

  let referenceEnvironment: Record<string, unknown> | undefined;
  syntaxTree(view.state).iterate({
    enter(node) {
      const nodeRange = { from: node.from, to: node.to };
      if (isInside(nodeRange, suppressed)) return false;
      const name = node.name;
      if (name === "Document") return;
      if (name === "Paragraph" || name === "Task") {
        const trailing = trailingLiveBreak(source, node.node);
        if (trailing) ranges.push(Decoration.replace({breakSyntax: true}).range(trailing.from, trailing.to - 1));
        const item = node.node.parent;
        const mark = item?.name === "ListItem" ? item.getChild("ListMark") : null;
        const layout = containingList(item);
        // Quoted lists retain their container geometry; code and other block children
        // are never treated as paragraph indentation.
        if (layout) {
          const first = view.state.doc.lineAt(node.from).number;
          const last = view.state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
          for (let number = first; number <= last; number++) {
            const line = view.state.doc.line(number);
            const isFirst = line.number === (mark ? view.state.doc.lineAt(mark.from).number : -1);
            listLines.set(line.from, {...layout, first: isFirst});
            if (!isFirst) {
              const prefix = line.text.match(/^[ \t>]+/)?.[0] ?? "";
              for (const gap of prefix.matchAll(/(?:^|> ?)([ \t]+)/g)) {
                const start = gap.index! + gap[0].length - gap[1].length;
                ranges.push(Decoration.replace({listSyntax: true}).range(line.from + start, line.from + start + gap[1].length));
              }
            }
          }
        }
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
            const rails = quoteRails.get(from) ?? [];
            const layout = containingList(node.node.parent);
            rails.push(`calc(${layout ? listOffset(layout) : "0px"} + ${rails.length * 20}px)`);
            quoteRails.set(from, rails);
            quoteDepths.set(from, rails.length);
          }
        }
      } else if (name === "BulletList" || name === "OrderedList") {
        if (node.node.parent?.name !== "ListItem") {
          addBlockLineDecorations(view, ranges, node.from, node.to, "cm-live-list-block", "cm-live-list-block");
        }
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
        // Standalone fences inside containers use the same editor, with source
        // prefixes restored on write. Inline list-opening fences retain source.
        if (node.node.parent?.name !== "Document") {
          const firstLine = view.state.doc.lineAt(node.from);
          const prefix = source.slice(firstLine.from, node.from);
          const containerRaw = source.slice(firstLine.from, node.to);
          const safe = /^[ \t>]+$/.test(prefix) && containerRaw.split("\n").every(line => /^ +$/.test(prefix) || line.startsWith(prefix) || !line.trim() || line === prefix.trimEnd());
          if (safe && parseFencedCode(unwrapCodeContainer(containerRaw, prefix))) {
            suppressed.push(nodeRange);
            collapseMultilineSource(view, ranges, firstLine.from, node.to,
              new EditableCodeWidget(containerRaw, firstLine.from, node.to, prefix));
            const closing = view.state.doc.lineAt(Math.max(node.from, node.to - 1)).from;
            const layout = containingList(node.node.parent);
            if (layout) listLines.set(closing, {...layout, first: false});
            return false;
          }
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
          const indentation = source.slice(blockRange.from, node.from);
          // Indented code contributes four spaces of its own after the container.
          const prefix = indentation.endsWith("    ") ? indentation.slice(0, -4) : "";
          const containerRaw = source.slice(blockRange.from, blockRange.to);
          if (prefix && /^[ \t>]+$/.test(prefix) && containerRaw.split("\n").every(line => line.startsWith(prefix) || !line.trim() || line === prefix.trimEnd())) {
            suppressed.push(blockRange);
            collapseMultilineSource(view, ranges, blockRange.from, blockRange.to,
              new EditableCodeWidget(containerRaw, blockRange.from, blockRange.to, prefix));
            const closing = view.state.doc.lineAt(Math.max(blockRange.from, blockRange.to - 1)).from;
            const layout = containingList(node.node.parent);
            if (layout) listLines.set(closing, {...layout, first: false});
            return false;
          }
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

      if (active && name !== "ListMark" && name !== "TaskMarker"
        && !["Link", "Autolink", "StrongEmphasis", "Emphasis", "Strikethrough", "InlineCode"].includes(semantic.name)) return;

      if (["EmphasisMark", "StrikethroughMark", "CodeMark"].includes(name)) {
        ranges.push(Decoration.replace({inlineSyntax: true}).range(node.from, node.to));
      } else if (["LinkMark", "URL", "LinkTitle"].includes(name) && !literalReferences.has(semantic.from) && !/^\[![A-Za-z]+\]/.test(source.slice(semantic.from, semantic.to))) {
        if (name !== "URL" || semantic.name === "Link") {
          ranges.push(Decoration.replace({}).range(node.from, node.to));
        }
      } else if (name === "TaskMarker") {
        const line = view.state.doc.lineAt(node.from);
        const aligned = listLines.has(line.from);
        let to = node.to;
        if (aligned) while (source[to] === " " || source[to] === "\t") to++;
        if (to === line.to && to > node.to) to--;
        ranges.push(Decoration.replace({listSyntax: true,
          widget: new TaskWidget(/x/i.test(raw), node.from, node.to, raw, aligned, !view.state.readOnly),
        }).range(node.from, to));
      } else if (name === "ListMark") {
        if (node.node.parent?.getChild("Task")?.getChild("TaskMarker")) {
          const line = view.state.doc.lineAt(node.from);
          const prefix = source.slice(line.from, node.from);
          const plainPrefix = /^[ \t>]*$/.test(prefix);
          const afterQuote = prefix.lastIndexOf(">") + 1;
          const prefixFrom = line.from + (afterQuote ? afterQuote + (prefix[afterQuote] === " " ? 1 : 0) : 0);
          let to = node.to;
          if (plainPrefix) while (source[to] === " " || source[to] === "\t") to++;
          ranges.push(Decoration.replace({listSyntax: true}).range(plainPrefix ? prefixFrom : node.from, to));
        } else {
          const layout = listMarkers.get(node.from);
          const marker = layout?.text ?? (/^\d/.test(raw) ? raw : "•");
          const line = view.state.doc.lineAt(node.from);
          const prefix = source.slice(line.from, node.from);
          const plainPrefix = /^[ \t>]*$/.test(prefix);
          const afterQuote = prefix.lastIndexOf(">") + 1;
          const prefixFrom = line.from + (afterQuote ? afterQuote + (prefix[afterQuote] === " " ? 1 : 0) : 0);
          let to = node.to;
          while (source[to] === " " || source[to] === "\t") to++;
          // Leave a real insertion point on an empty item.
          if (to === line.to && to > node.to) to--;
          if (layout && plainPrefix) listLines.set(line.from, {...layout, first: true});
          ranges.push(Decoration.replace({listSyntax: true, widget: new MarkerWidget(marker, to)})
            .range(plainPrefix ? prefixFrom : node.from, to));
        }
      } else if (name === "QuoteMark") {
        ranges.push(Decoration.replace({}).range(node.from, node.to));
      } else if (name === "CodeInfo") {
        ranges.push(Decoration.replace({}).range(node.from, node.to));

      }
    },
  });

  for (const [from, layout] of listLines) {
    ranges.push(Decoration.line({class: `cm-live-list-layout${layout.first ? " cm-live-list-row" : ""}`,
      attributes: {style: `--md-list-depth: ${layout.depth}; --md-list-offset: ${layout.offsets.map(width => `max(1.5em, ${width}ch + .5em)`).join(" + ") || "0px"}; --md-list-marker-width: ${layout.width}ch`}}).range(from));
  }

  for (const [from, depth] of quoteDepths) {
    ranges.push(Decoration.line({class: `cm-live-quote-line ${renderClassNames.quote}`,
      attributes: {style: `--md-quote-depth: ${depth}; background-image: ${Array(depth).fill("linear-gradient(color-mix(in srgb, var(--text) 18%, transparent), color-mix(in srgb, var(--text) 18%, transparent))").join(",")}; background-size: ${Array(depth).fill("2px 100%").join(",")}; background-position: ${quoteRails.get(from)!.map(offset => `${offset} top`).join(",")}; background-repeat: no-repeat`}}).range(from));
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

/** Plain unadorned paragraph edits cannot alter distant Markdown objects.
 * Preserve their decoration identities instead of rescanning the whole document.
 * Any punctuation that can form syntax, multiline edit, decorated line or selection
 * across lines takes the full path, including code and metadata source lines. */
function canMapPlainEdit(update:ViewUpdate,decorations:DecorationSet){
  if(!update.docChanged||update.focusChanged||update.transactions.some(t=>t.effects.length)||update.startState.selection.ranges.length!==1||update.state.selection.ranges.length!==1)return false;
  const oldLine=update.startState.doc.lineAt(update.startState.selection.main.head);
  const newLine=update.state.doc.lineAt(update.state.selection.main.head);
  if(update.startState.doc.lineAt(update.startState.selection.main.anchor).number!==oldLine.number||update.state.doc.lineAt(update.state.selection.main.anchor).number!==newLine.number)return false;
  if(!/^[\p{L}\p{N} ,.!?:;']*$/u.test(oldLine.text)||! /^[\p{L}\p{N} ,.!?:;']*$/u.test(newLine.text))return false;
  if(oldLine.text.trimStart().startsWith(":")||/:[^:\s]+:/.test(oldLine.text)||/:[^:\s]+:/.test(newLine.text))return false;
  // Reparse only the affected line to distinguish punctuation from bare-domain
  // links. A space deletion can create a link, so both revisions must be plain.
  if(oldLine.text.includes(".")||newLine.text.includes(".")){
    const parser=parserFor(update.state.facet(resourceContext).profile??"tegg");
    if([oldLine.text,newLine.text].some(text=>parser.parseInline(text,{})[0]?.children?.some(token=>token.type!=="text")))return false;
  }
  if([oldLine.text,newLine.text].some(text=>/^ {4}|^ *\d+[.)]\s| {2,}$/.test(text)))return false;
  if(!oldLine.text.trim()||!newLine.text.trim()||update.changes.mapPos(oldLine.from)!==newLine.from)return false;
  let safe=true;
  decorations.between(oldLine.from,oldLine.to,(from,to,value)=>{
    const classes=String(value.spec.class??"").split(/\s+/);
    const paragraphLine=from===to&&classes.length>0&&classes.every(name=>/^cm-live-paragraph(?:-first|-last)?$|^md-render-paragraph$|^cm-live-after-heading$/.test(name));
    if(!paragraphLine)safe=false;
  });
  update.changes.iterChanges((from,to,_a,_b,insert)=>{if(from<oldLine.from||to>oldLine.to||insert.lines!==1||! /^[\p{L}\p{N} ,.!?;']*$/u.test(insert.toString()))safe=false;});
  if(safe){
    let first=update.startState.doc.length,shifts=false;
    update.changes.iterChanges((from,to,fromB,toB)=>{if(to-from!==toB-fromB){shifts=true;first=Math.min(first,from);}});
    if(shifts)decorations.between(first,update.startState.doc.length,(_from,_to,value)=>{if(value.spec.widget)safe=false;});
  }
  return safe;
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
    if(canMapPlainEdit(update,this.decorations)){this.decorations=this.decorations.map(update.changes);return;}
    if (update.docChanged || update.selectionSet || update.focusChanged
      || update.transactions.some((transaction) => transaction.effects.length > 0)) {
      this.decorations = buildDecorations(update.view);
    }
  }
}, {
  decorations: (plugin) => plugin.decorations,
  provide: (plugin) => EditorView.atomicRanges.of(view => {
    const decorations = view.plugin(plugin)?.decorations;
    if (!decorations) return Decoration.none;
    const blocks: Range<Decoration>[] = [];
    decorations.between(0, view.state.doc.length, (_from, _to, value) => {
      const widget = value.spec.widget;
      if (widget instanceof EditableCodeWidget) blocks.push(Decoration.replace({}).range(widget.from, widget.to));
    });
    return decorations.update({
      filter: (_from, _to, value) => value.spec.listSyntax === true || value.spec.quoteSyntax === true || value.spec.literalSyntax === true || value.spec.emojiSyntax === true || value.spec.headingSyntax === true || value.spec.breakSyntax === true || value.spec.inlineSyntax === true,
      add: blocks, sort: true,
    });
  }),
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

const continueLiveList = insertNewlineContinueMarkupCommand({nonTightLists: false});

// CodeMirror's wrapped-line command locates the edge through posAtCoords. In
// Live Preview, collapsed source rows can make that height-based lookup land
// on a later line. Correct a crossed source-line boundary with CodeMirror's
// visual side or the actual DOM row, and keep hidden prefixes outside typing.
function keepLiveLineBoundary(view: EditorView, forward: boolean, extend = false): boolean {
  if (!view.hasFocus || view.composing || view.state.selection.ranges.length !== 1) return false;
  const selection = view.state.selection.main;
  const sourceLine = view.state.doc.lineAt(selection.head);
  const safePosition = (position: number) => {
    let normalized = position;
    for (let previous = -1; normalized !== previous;) {
      previous = normalized;
      for (const getRanges of view.state.facet(EditorView.atomicRanges)) {
        getRanges(view).between(Math.max(0, normalized - 1), Math.min(view.state.doc.length, normalized + 1), (from, to, value) => {
          if (normalized === from && (value.spec.quoteSyntax || value.spec.listSyntax || value.spec.headingSyntax) && from < to)
            normalized = to;
          else if (from < normalized && normalized < to) normalized = forward ? to : from;
        });
      }
    }
    return normalized;
  };
  const place = (target: number) => {
    const normalized = safePosition(target);
    if (normalized < sourceLine.from || normalized > sourceLine.to) return true;
    const moved = extend ? EditorSelection.range(selection.anchor, normalized, undefined, undefined, forward ? -1 : 1)
      : EditorSelection.cursor(normalized, forward ? -1 : 1);
    if (!moved.eq(selection, true)) view.dispatch({selection: EditorSelection.create([moved]), scrollIntoView: true, userEvent: "select"});
    return true;
  };
  const block = view.lineBlockAt(selection.head);
  let candidate = view.moveToLineBoundary(selection, forward);
  if (candidate.head === selection.head && candidate.head !== (forward ? block.to : block.from))
    candidate = view.moveToLineBoundary(selection, forward, false);
  if (candidate.head >= sourceLine.from && candidate.head <= sourceLine.to)
    return candidate.head === sourceLine.from && safePosition(candidate.head) !== candidate.head ? place(candidate.head) : false;

  const first = view.coordsAtPos(sourceLine.from, 1);
  const last = view.coordsAtPos(sourceLine.to, -1);
  // On an unwrapped row CodeMirror already knows the bidi-aware visual side.
  // Avoid browser-specific caret hit testing (and a character walk) there.
  if (first && last && first.bottom > last.top + 2 && last.bottom > first.top + 2)
    return place(view.visualLineSide(sourceLine, forward).head);

  const dom = view.domAtPos(selection.head, selection.assoc || 1).node;
  const line = (dom instanceof Element ? dom : dom.parentElement)?.closest<HTMLElement>(".cm-line");
  if (!line || !view.contentDOM.contains(line)) return true;
  const caret = view.coordsAtPos(selection.head, selection.assoc || 1);
  const bounds = line.getBoundingClientRect();
  if (!caret || bounds.height <= 0) return true;
  const y = (caret.top + caret.bottom) / 2;
  if (y < bounds.top || y > bounds.bottom) return true;
  const direction = view.textDirectionAt(selection.head);
  const x = forward === (direction === Direction.LTR) ? bounds.right - 1 : bounds.left + 1;
  const owner = view.contentDOM.ownerDocument as CaretPointDocument;
  const point = owner.caretPositionFromPoint?.(x, y);
  const range = point ? null : owner.caretRangeFromPoint?.(x, y);
  const node = point?.offsetNode ?? range?.startContainer;
  const offset = point?.offset ?? range?.startOffset;
  let target: number | null = null;
  if (node && offset != null && line.contains(node)) {
    try { target = view.posAtDOM(node, offset); } catch { /* Keep the cursor on this line. */ }
  }
  if (target == null) return true;
  if (target < sourceLine.from || target > sourceLine.to) return true;
  return place(target);
}

export const livePreview = [preserveCodeStructure,selectionHistory,EditorView.clipboardOutputFilter.of(literalClipboardText), Prec.highest(keymap.of([
  {mac: "Cmd-ArrowRight", run: view => keepLiveLineBoundary(view, view.textDirectionAt(view.state.selection.main.head) === Direction.LTR),
    shift: view => keepLiveLineBoundary(view, view.textDirectionAt(view.state.selection.main.head) === Direction.LTR, true)},
  {mac: "Cmd-ArrowLeft", run: view => keepLiveLineBoundary(view, view.textDirectionAt(view.state.selection.main.head) !== Direction.LTR),
    shift: view => keepLiveLineBoundary(view, view.textDirectionAt(view.state.selection.main.head) !== Direction.LTR, true)},
  {key: "End", run: view => keepLiveLineBoundary(view, true), shift: view => keepLiveLineBoundary(view, true, true)},
  {key: "Home", run: view => keepLiveLineBoundary(view, false), shift: view => keepLiveLineBoundary(view, false, true)},
  {key: "Enter", run: view => !view.composing && (editListBoundary(view, true) || editQuoteBoundary(view, true) || continueLiveList(view))},
  {key: "Shift-Enter", run: insertLiveBreak},
  {key: "Tab", run: view => indentList(view)},
  {key: "Shift-Tab", run: view => indentList(view, true)},
  {key: "Backspace", run: view => selectCodeBoundary(view, true) || deleteListSelection(view) || editListBoundary(view, false) || editQuoteBoundary(view, false) || deleteScriptContent(view, true) || deleteBesideInlineSyntax(view, true) || deleteLiveBreak(view, true) || deleteListContinuation(view)},
  {key: "Delete", run: view => selectCodeBoundary(view, false) || deleteListSelection(view) || deleteScriptContent(view, false) || deleteBesideInlineSyntax(view, false) || deleteLiveBreak(view, false)},
])), metadataSourceState, calloutSourceState, livePreviewDecorations, livePreviewMouseSelection, liveLinks];
