/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { history, undo, redo, undoDepth } from "@codemirror/commands";
import { markdownParser } from "./markdownParser";
import { enhanceCallouts, sanitizeRenderedHtml } from "./renderKit";
import { calloutContext, calloutRanges, setCalloutType } from "./calloutEditing";
import { editorToolbarState } from "./editorToolbar";

// Acceptance expectations are independent of the implementation catalog.
const families: Record<string, string[]> = {
  note: [], abstract: ["summary", "tldr"], info: [], todo: [], tip: ["hint"],
  important: [], success: ["check", "done"], question: ["help", "faq"],
  warning: ["attention"], caution: [], failure: ["fail", "missing"],
  danger: ["error"], bug: [], example: [], quote: ["cite"],
};
const identifiers = Object.entries(families).flatMap(([canonical, aliases]) =>
  [canonical, ...aliases].map(id => ({id, canonical})));

function editor(source: string, anchor = source.length, head = anchor) {
  const view = {
    state: EditorState.create({doc: source, selection: {anchor, head}, extensions: [markdown(), history()]}),
    dispatch(transaction: TransactionSpec | Transaction) {
      this.state = transaction instanceof Transaction ? transaction.state : this.state.update(transaction).state;
    }, focus() {},
  };
  return view as unknown as EditorView;
}
function render(source: string) {
  const root = document.createElement("main");
  root.innerHTML = sanitizeRenderedHtml(markdownParser.render(source));
  enhanceCallouts(root);
  return root;
}

describe("27 identifier acceptance matrix", () => {
  it.each(identifiers)("$id: case/fold/title matrix agrees across Reader and editor", ({id, canonical}) => {
    for (const spelling of [id, id.toUpperCase(), id[0].toUpperCase() + id.slice(1)]) {
      for (const fold of ["", "+", "-"]) for (const title of ["", " 中文标题", " **标题** 与 `code`"]) {
        const source = `> [!${spelling}]${fold}${title}\n> **正文** [链接](https://example.com)\n>\n> 第二段`;
        const quote = render(source).querySelector<HTMLElement>(".callout")!;
        expect(quote?.dataset.calloutKind).toBe(canonical);
        expect(quote?.dataset.callout).toBe(id);
        expect(quote?.dataset.calloutFold ?? "").toBe(fold);
        expect(quote?.querySelector("p strong")?.textContent).toBe("正文");
        expect(quote?.querySelector("p a")?.getAttribute("href")).toBe("https://example.com");
        expect(quote?.querySelectorAll("p")).toHaveLength(2);
        if (title.includes("**")) expect(quote?.querySelector(".callout-title strong")?.textContent).toBe("标题");
        const view = editor(source);
        expect(calloutRanges(view.state)).toHaveLength(1);
        expect(calloutContext(view.state).enabled).toBe(true);
        expect(editorToolbarState(view.state).callout).toBe(canonical);
        expect(view.state.doc.toString()).toBe(source);
      }
    }
  });

  it.each(identifiers)("$id: all 15 conversions preserve everything except the identifier and round-trip undo/redo", ({id, canonical}) => {
    for (const next of Object.keys(families)) {
      const source = `> [!${id.toUpperCase()}]- **自定义标题**\n> **正文** [链接](https://example.com)\n>\n> 后续段落`;
      const view = editor(source, source.indexOf("正文"), source.indexOf("正文") + 2);
      setCalloutType(view, next);
      const expected = next === canonical ? source : source.replace(`[!${id.toUpperCase()}]`, `[!${next}]`);
      expect(view.state.doc.toString()).toBe(expected);
      expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("正文");
      expect(undoDepth(view.state)).toBe(next === canonical ? 0 : 1);
      if (next !== canonical) {
        undo({state: view.state, dispatch: t => view.dispatch(t)});
        expect(view.state.doc.toString()).toBe(source);
        redo({state: view.state, dispatch: t => view.dispatch(t)});
        expect(view.state.doc.toString()).toBe(expected);
      }
    }
  });

  it("recognizes title-only callouts without manufacturing a body", () => {
    for (const {id} of identifiers) for (const suffix of ["", " Title", "+ Title", "- **Title**"]) {
      const source = `> [!${id}]${suffix}`;
      expect(render(source).querySelector(".callout")).not.toBeNull();
      expect(render(source).querySelector(".callout p")).toBeNull();
      expect(calloutRanges(editor(source).state)).toHaveLength(1);
    }
  });
  it("handles nested, list-contained, lazy continuation and unknown callouts consistently", () => {
    for (const source of [
      "> > [!custom-type_2]- Title\n> > **body**",
      "- Item\n\n  > [!question] Title\n  > **body**",
      "> [!tip] Title\nlazy continuation",
    ]) {
      expect(render(source).querySelectorAll(".callout")).toHaveLength(1);
      const view = editor(source);
      expect(calloutRanges(view.state)).toHaveLength(1);
      setCalloutType(view, "success");
      expect(view.state.doc.toString()).toBe(source.replace(/\[![^\]]+\]/, "[!success]"));
    }
  });
});
