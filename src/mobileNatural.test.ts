/** @vitest-environment jsdom */
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {EditorState} from "@codemirror/state";
import {EditorView, runScopeHandlers} from "@codemirror/view";
import {markdown} from "@codemirror/lang-markdown";
import {ensureSyntaxTree} from "@codemirror/language";
import {GFM} from "@lezer/markdown";
import {deleteCharBackward, history, redo, undo} from "@codemirror/commands";
import {mobileNaturalExtensions} from "./core";
import {livePreview} from "./livePreview";
import {editorToolbarState} from "./editorToolbar";

// Exercise the opt-in extension through a real EditorView and public export.
// These DOM tests do not establish native keyboard, device or viewport acceptance.
class ResizeObserverProbe {
  static instances: ResizeObserverProbe[] = [];
  targets = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) { ResizeObserverProbe.instances.push(this); }
  observe(target: Element) { this.targets.add(target); }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  notify(target: Element) {
    if (this.targets.has(target)) this.callback([{target} as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}
const mounted = new Set<EditorView>();
let viewport: EventTarget;
beforeEach(() => {
  ResizeObserverProbe.instances = [];
  vi.stubGlobal("ResizeObserver", ResizeObserverProbe);
  viewport = new EventTarget();
  vi.stubGlobal("visualViewport", viewport);
  Range.prototype.getClientRects ??= () => ({length: 0, item: () => null, [Symbol.iterator]: function* () {}}) as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(() => {
  for (const view of mounted) view.destroy();
  mounted.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount(source: string, anchor = source.length, head = anchor, options: {natural?: boolean; readonly?: boolean; preview?: boolean} = {}) {
  const parent = document.createElement("div");document.body.append(parent);
  const view = new EditorView({parent, state: EditorState.create({doc: source, selection: {anchor, head}, extensions: [
    markdown({extensions: GFM}), history(), EditorState.readOnly.of(options.readonly ?? false),
    options.preview === false ? [] : livePreview,
    options.natural === false ? [] : mobileNaturalExtensions,
  ]})});
  mounted.add(view);
  ensureSyntaxTree(view.state, view.state.doc.length, 1000);
  view.focus();view.dispatch({selection: {anchor, head}});
  return {view, parent};
}
function destroy(view: EditorView) { view.destroy();mounted.delete(view); }
function key(view: EditorView, value: string, modified = false) {
  const mac = /Mac/.test(navigator.platform);
  return runScopeHandlers(view, new KeyboardEvent("keydown", {key: value, code: value.length === 1 ? `Key${value.toUpperCase()}` : value,
    ctrlKey: modified && !mac, metaKey: modified && mac}), "editor");
}
function frames() {
  let sequence = 1000;
  const pending = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { const id = ++sequence;pending.set(id, callback);return id; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => {pending.delete(id);});
  return {pending, last: () => sequence, run(id: number) { const callback = pending.get(id);expect(callback).toBeDefined();pending.delete(id);callback!(0); }};
}

describe("mobile natural editing integration", () => {
  it.each([true, false])("preserves source while active headings and bold remain formatted (mobile facet: %s)", natural => {
    const source = "## 标题\n\n**自然编辑**";
    const {view} = mount(source, 12, 12, {natural});
    expect(view.contentDOM.textContent).toContain("自然编辑");
    expect(view.contentDOM.textContent).not.toContain("**");
    expect(view.contentDOM.textContent).not.toContain("##");
    expect(view.state.doc.toString()).toBe(source);
  });

  it.each([["b", "**", "bold"], ["i", "*", "italic"]] as const)("formats selected Chinese with Mod-%s and restores it with one undo/redo", (shortcut, delimiter, stateKey) => {
    const source = "before 中文 after";
    const {view} = mount(source, 7, 9);
    expect(key(view, shortcut, true)).toBe(true);
    expect(view.state.doc.toString()).toBe(`before ${delimiter}中文${delimiter} after`);
    expect(editorToolbarState(view.state)[stateKey]).toBe(true);
    expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(source);
    expect(redo(view)).toBe(true);expect(view.state.doc.toString()).toBe(`before ${delimiter}中文${delimiter} after`);
  });

  it.each([["**正文**", 2], ["*正文*", 1], ["~~正文~~", 2], ["`正文`", 1], ["## 正文", 3]] as const)("the standalone mobile keymap removes the complete wrapper at %s's leading boundary", (original, offset) => {
    const prefix = "before\n\n", suffix = "\n\nafter";
    const source = prefix + original + suffix;
    const {view} = mount(source, prefix.length + offset, undefined, {preview: false});
    expect(key(view, "Backspace")).toBe(true);
    expect(view.state.doc.toString()).toBe(prefix + "正文" + suffix);
    expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(source);
    expect(redo(view)).toBe(true);expect(view.state.doc.toString()).toBe(prefix + "正文" + suffix);
  });

  it.each(["**", "*", "~~", "`"])("the combined Live/mobile keymaps delete adjacent visible text before %s without tearing its pair", delimiter => {
    const source = `A ${delimiter}正文${delimiter} Z`;
    const {view} = mount(source, 2 + delimiter.length);
    expect(key(view, "Backspace")).toBe(true);
    expect(view.state.doc.toString()).toBe(`A${delimiter}正文${delimiter} Z`);
    undo(view);expect(view.state.doc.toString()).toBe(source);
    redo(view);expect(view.state.doc.toString()).toBe(`A${delimiter}正文${delimiter} Z`);
  });

  it.each(["readonly", "composing"] as const)("refuses mobile formatting and boundary deletion while %s", gate => {
    const source = "**正文**";
    const {view} = mount(source, 2, 2, {readonly: gate === "readonly", preview: false});
    if (gate === "composing") Object.defineProperty(view, "composing", {configurable: true, get: () => true});
    key(view, "Backspace");key(view, "b", true);key(view, "i", true);
    expect(view.state.doc.toString()).toBe(source);
    expect(undo(view)).toBe(false);
  });

  it.each(["![图片](Attachments/ABC.png)", "| A |\n| --- |\n| B |", "---"])("deletes %s as one mobile atomic object and restores surrounding source", object => {
    const prefix = "before\n\n", suffix = "\n\nafter";
    const source = prefix + object + suffix;
    const {view} = mount(source, prefix.length + object.length);
    expect(deleteCharBackward(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(prefix + suffix);
    expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(source);
    expect(redo(view)).toBe(true);expect(view.state.doc.toString()).toBe(prefix + suffix);
  });

  it("keeps code-fence contents editable instead of making their Markdown-looking text atomic", () => {
    const source = "```md\n**literal**\n```";
    const {view} = mount(source, source.indexOf("literal") + 3, undefined, {preview: false});
    deleteCharBackward(view);
    expect(view.state.doc.toString()).toBe("```md\n**lieral**\n```");
    undo(view);expect(view.state.doc.toString()).toBe(source);
  });

  it.each([390, 1024])("edits a projected table at width %i and cancels without changing the source", width => {
    vi.stubGlobal("innerWidth", width);
    const source = "before\n\n| 名称 |\n| --- |\n| 原内容 |\n\nafter";
    const {view, parent} = mount(source);
    const begin = () => {
      const button = parent.querySelector<HTMLButtonElement>('[aria-label="Edit table cell: 原内容"]');
      expect(button).not.toBeNull();button!.click();
      return parent.querySelector<HTMLInputElement>(width < 640 ? '[aria-label="Cell value"]' : '[aria-label="Table cell: 原内容"]')!;
    };
    const first = begin();first.value = "discarded";
    first.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    expect(view.state.doc.toString()).toBe(source);
    const second = begin();second.value = "新内容";
    second.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    expect(view.state.doc.toString()).toBe(source.replace("原内容", "新内容"));
    undo(view);expect(view.state.doc.toString()).toBe(source);
  });

  it("opens a mobile table's source through its real Edit Source control without changing source or history", () => {
    const source = "before\n\n| A |\n| --- |\n| B |\n\nafter";
    const {view, parent} = mount(source);
    const table = parent.querySelector(".cm-live-table");expect(table).not.toBeNull();
    const sourceButton = [...table!.querySelectorAll("button")].find(button => button.textContent === "Edit Source");
    expect(sourceButton).toBeDefined();sourceButton!.click();
    expect(view.state.selection.main.head).toBe(source.indexOf("| A |"));
    expect(parent.querySelector(".cm-live-table")).toBeNull();
    expect(parent.querySelector(".cm-live-table-line")?.textContent).toContain("| A |");
    expect(view.state.doc.toString()).toBe(source);expect(undo(view)).toBe(false);
  });

  it("changes the visible task checkbox without altering unknown surrounding syntax", () => {
    const source = "- [ ] 任务\n\nunknown: <custom>";
    const {view, parent} = mount(source, 8);
    const box = parent.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box).not.toBeNull();box!.click();
    expect(view.state.doc.toString()).toBe("- [x] 任务\n\nunknown: <custom>");
    undo(view);expect(view.state.doc.toString()).toBe(source);
  });
});

describe("mobile viewport lifecycle", () => {
  it("coalesces viewport and editor resize, then cancels its pending frame and detaches on destroy", () => {
    const raf = frames();
    const add = vi.spyOn(viewport, "addEventListener"), remove = vi.spyOn(viewport, "removeEventListener");
    const {view} = mount("one", 3, 3, {preview: false});
    const observer = ResizeObserverProbe.instances.find(item => item.targets.has(view.dom));
    expect(observer).toBeDefined();expect(add).toHaveBeenCalledWith("resize", expect.any(Function));
    const measure = vi.spyOn(view, "requestMeasure"), dispatch = vi.spyOn(view, "dispatch");
    viewport.dispatchEvent(new Event("resize"));const first = raf.last();
    observer!.notify(view.dom);const second = raf.last();
    expect(raf.pending.has(first)).toBe(false);expect(raf.pending.has(second)).toBe(true);
    expect(measure).not.toHaveBeenCalled();raf.run(second);expect(measure).toHaveBeenCalled();expect(dispatch).toHaveBeenCalledOnce();
    viewport.dispatchEvent(new Event("resize"));const last = raf.last();
    destroy(view);
    expect(observer!.targets.size).toBe(0);expect(raf.pending.has(last)).toBe(false);
    expect(remove).toHaveBeenCalledWith("resize", add.mock.calls.find(call => call[0] === "resize")![1]);
    const remaining = raf.last();viewport.dispatchEvent(new Event("resize"));observer!.notify(view.dom);
    expect(raf.last()).toBe(remaining);
  });

  it("requests layout while composing without dispatching a caret-scroll transaction", () => {
    const raf = frames();const {view} = mount("输入", 2, 2, {preview: false});
    Object.defineProperty(view, "composing", {configurable: true, get: () => true});
    const dispatch = vi.spyOn(view, "dispatch"), measure = vi.spyOn(view, "requestMeasure");
    viewport.dispatchEvent(new Event("resize"));raf.run(raf.last());
    expect(measure).toHaveBeenCalledOnce();expect(dispatch).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("输入");
  });

  it("keeps independent mobile editors attached when their sibling is destroyed", () => {
    const raf = frames();const first = mount("first", 5, 5, {preview: false}).view;
    const second = mount("second", 6, 6, {preview: false}).view;
    const measureFirst = vi.spyOn(first, "requestMeasure"), measureSecond = vi.spyOn(second, "requestMeasure");
    destroy(first);viewport.dispatchEvent(new Event("resize"));raf.run(raf.last());
    expect(measureFirst).not.toHaveBeenCalled();expect(measureSecond).toHaveBeenCalled();
    expect(second.state.doc.toString()).toBe("second");
    destroy(second);
    expect(ResizeObserverProbe.instances.every(observer => observer.targets.size === 0)).toBe(true);
  });
});
