/** @vitest-environment jsdom */
import { history, undoDepth, redoDepth } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { forceParsing, ParseContext, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { GFM } from "@lezer/markdown";
import type { ParseWrapper } from "@lezer/common";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { livePreview } from "./livePreview";

beforeAll(() => {
  if (typeof ResizeObserver === "undefined") {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  }
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null,
      [Symbol.iterator]: function* () {} }) as DOMRectList;
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  }
});

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(cleanup => cleanup()); });

async function pendingTableInRealComposition() {
  const initialOriginalSource = "before\n\n| A | B |\n| --- | --- |\n| old | 2 |\n\nafter";
  const actualComposedSource = initialOriginalSource + "中文";
  let released = false, release!: () => void;
  const pending = new Promise<void>(resolve => { release = () => { released = true; resolve(); }; });
  const wrap: ParseWrapper = (inner, input, fragments, ranges) => released ? inner
    : ParseContext.getSkippingParser(pending).startParse(input, fragments, ranges);
  const root = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({ parent: root, state: EditorState.create({
    doc: initialOriginalSource, selection: { anchor: initialOriginalSource.length },
    extensions: [history(), markdown({ extensions: [GFM, { wrap }] }), livePreview],
  }) });
  let alive = true;
  const destroy = () => { if (alive) { alive = false; view.destroy(); } };
  cleanups.push(() => { destroy(); root.remove(); if (!released) release(); });
  const table = () => root.querySelector('[aria-label="Editable Markdown table"]');
  const snapshot = () => ({ source: view.state.doc.toString(),
    selection: view.state.selection.toJSON(), undoDepth: undoDepth(view.state), redoDepth: redoDepth(view.state) });
  expect(view.state.doc.toString()).toBe(initialOriginalSource);
  expect(view.state.selection.main.head).toBe(initialOriginalSource.length);
  expect(undoDepth(view.state)).toBe(0);
  expect(redoDepth(view.state)).toBe(0);
  expect(table()).toBeNull();
  view.focus();
  await vi.waitFor(() => expect(view.hasFocus).toBe(true), { timeout: 1000, interval: 10 });
  view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  expect(view.compositionStarted).toBe(true);
  const text = view.contentDOM.querySelector(".cm-line:last-child")?.firstChild;
  expect(text?.nodeType).toBe(Node.TEXT_NODE);
  expect(text?.textContent).toBe("after");
  const actualText = text as Text;
  actualText.data += "中文";
  const range = document.createRange();
  range.setStart(actualText, actualText.length);
  range.collapse(true);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  view.contentDOM.dispatchEvent(new InputEvent("input", {
    bubbles: true, inputType: "insertCompositionText", data: "中文", isComposing: true,
  }));
  await vi.waitFor(() => {
    // Failure here means the real composing precondition was not established.
    // compositionStarted alone must never substitute for this assertion.
    expect(view.composing).toBe(true);
    expect(view.state.doc.toString()).toBe(actualComposedSource);
    expect(view.state.selection.main.head).toBe(actualComposedSource.length);
    expect(undoDepth(view.state)).toBe(1);
    expect(redoDepth(view.state)).toBe(0);
  }, { timeout: 2000, interval: 10 });
  const baseline = snapshot(), doc = view.state.doc;
  expect(table()).toBeNull();
  release();
  expect(forceParsing(view, view.state.doc.length, 1000)).toBe(true);
  expect(view.composing).toBe(true);
  expect(syntaxTreeAvailable(view.state, view.state.doc.length)).toBe(true);
  expect(syntaxTree(view.state).toString()).toContain("Table");
  expect(table()).toBeNull();
  expect(actualText.isConnected).toBe(true);
  expect(view.state.doc).toBe(doc);
  expect(snapshot()).toEqual(baseline);
  const unchanged = () => {
    expect(view.state.doc).toBe(doc);
    expect(snapshot()).toEqual(baseline);
  };
  const end = () => view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", {
    bubbles: true, data: "中文",
  }));
  const restored = async () => {
    await vi.waitFor(() => {
      expect(table()).not.toBeNull();
      expect(root.querySelector('[aria-label="Edit table cell: 2"]')).not.toBeNull();
      expect(view.composing).toBe(false);
      unchanged();
    }, { timeout: 2000, interval: 10 });
  };
  return { view, root, table, unchanged, end, restored, destroy };
}

it("restores a table parsed during real composition after source-stable compositionend", async () => {
  const fixture = await pendingTableInRealComposition();
  fixture.end();
  expect(fixture.view.composing).toBe(false);
  fixture.unchanged();
  await fixture.restored();
}, 10_000);

it("does not let an older compositionend callback rebuild into a newly started composition", async () => {
  const fixture = await pendingTableInRealComposition();
  fixture.end();
  fixture.view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  expect(fixture.view.compositionStarted).toBe(true);
  expect(fixture.view.composing).toBe(false); // The new session has no text change yet.
  await Promise.resolve();
  await Promise.resolve();
  expect(fixture.table()).toBeNull();
  fixture.unchanged();
  fixture.end();
  await fixture.restored();
}, 10_000);

it("does not dispatch a queued deferred projection after its actual view is destroyed", async () => {
  const fixture = await pendingTableInRealComposition();
  const dispatch = vi.spyOn(fixture.view, "dispatch"); // Record calls; original implementation remains active.
  try {
    fixture.end();
    fixture.destroy();
    await Promise.resolve();
    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();
    expect(fixture.table()).toBeNull();
    fixture.unchanged();
  } finally { dispatch.mockRestore(); }
}, 10_000);
