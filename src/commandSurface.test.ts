// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {StateEffect} from "@codemirror/state";
import {undoDepth} from "@codemirror/commands";
import {TeggMarkdownEditor} from "./editor";
import {createCommandSurface} from "./commandSurface";
import {attachEditingUI} from "./editingUI";

const editors: TeggMarkdownEditor[] = [];
afterEach(() => {for (const editor of editors.splice(0)) editor.destroy(); document.body.replaceChildren();});
function make(source: string, mode: "live" | "source" = "live", profile: "tegg" | "gfm" = "tegg", locale?: "en-US" | "zh-CN") {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = new TeggMarkdownEditor(root, {documentId: "surface", revision: "r1", source, profile}, {locale}, mode);
  editors.push(editor);
  editor.view.dispatch({effects: StateEffect.appendConfig.of(createCommandSurface(editor.editing))});
  editor.view.focus();
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyB',key:'B',altKey:true,shiftKey:true,bubbles:true,cancelable:true}));
  editor.view.focus();
  return {editor, root};
}
function option(root: HTMLElement, label: string) {
  return [...root.querySelectorAll<HTMLButtonElement>('.tegg-command-option')].find(button =>
    button.querySelector('.tegg-command-option-label')?.textContent === label)!;
}

describe("shared block command surface", () => {
  it("replaces only an empty-line slash query and undoes it in one step", () => {
    const {editor, root} = make("/head");
    editor.view.dispatch({selection: {anchor: 5}});
    expect(option(root, "Heading 2")).toBeDefined();
    option(root, "Heading 2").click();
    expect(editor.source).toBe("## ");
    editor.command("undo"); expect(editor.source).toBe("/head");
  });
  it("Escape dismisses the same slash query without deleting it", () => {
    const {editor, root} = make("/");
    editor.view.dispatch({selection: {anchor: 1}});
    const event = new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true});
    editor.view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.source).toBe("/");
    editor.view.dispatch({selection: {anchor: 1}});
    expect(root.querySelector<HTMLElement>(".tegg-command-menu")?.hidden).toBe(true);
  });
  it("does not reopen a dismissed slash query after clicking back into the same line", () => {
    const {editor, root} = make("/");
    editor.view.dispatch({selection: {anchor: 1}});
    expect(root.querySelector<HTMLElement>(".tegg-command-menu")?.hidden).toBe(false);
    editor.view.contentDOM.dispatchEvent(new MouseEvent("mousedown", {bubbles: true}));
    editor.view.dispatch({selection: {anchor: 1}});
    expect(root.querySelector<HTMLElement>(".tegg-command-menu")?.hidden).toBe(true);
    expect(editor.source).toBe("/");
  });
  it("offers insertion on an empty line and filters unsupported profile commands", () => {
    const {editor, root} = make("", "live", "gfm");
    editor.view.dispatch({selection: {anchor: 0}});
    const plus = root.querySelector<HTMLButtonElement>(".tegg-command-plus")!;
    expect(plus.hidden).toBe(false);
    plus.click();
    expect(option(root, "Graphviz")).toBeUndefined();
    option(root, "Table").click();
    expect(editor.source).toContain("| Column 1 | Column 2 |");
    editor.command("undo"); expect(editor.source).toBe("");
  });
  it("shows the current heading separately from keyboard selection and groups movement", () => {
    const {editor, root} = make("## Current\nNext");
    editor.view.dispatch({selection: {anchor: 5}});
    const trigger = root.querySelector<HTMLButtonElement>(".tegg-command-more")!;
    expect(trigger.querySelector("svg")?.getAttribute("data-icon")).toBe("heading-2");
    expect(trigger.getAttribute("aria-label")).toContain("Heading 2");
    trigger.click();
    expect(option(root, "Heading 2").dataset.current).toBe("true");
    expect(option(root, "Heading 2").getAttribute("aria-current")).toBe("true");
    expect(option(root, "Heading 2").getAttribute("aria-selected")).toBe("true");
    expect([...root.querySelectorAll(".tegg-command-group")].map(node => node.textContent)).toEqual(["Paragraph style", "List style", "Wrap in quote", "Move block"]);
    expect(option(root, "Heading 4")).toBeDefined();
    expect(option(root, "Heading 5")).toBeDefined();
    expect(option(root, "Heading 6")).toBeDefined();
    expect(option(root, "Numbered list")).toBeDefined();
    expect(editor.source).toBe("## Current\nNext");
    expect(editor.view.state.selection.main.anchor).toBe(5);
  });
  it("opens from a focused block trigger without a pointer down and toggles closed without moving the caret", () => {
    const {editor, root} = make("Body");
    editor.view.dispatch({selection: {anchor: 2}});
    const trigger = root.querySelector<HTMLButtonElement>(".tegg-command-more")!;
    trigger.focus(); trigger.click();
    const menu = root.querySelector<HTMLElement>(".tegg-command-menu")!;
    expect(menu.hidden).toBe(false);
    expect(trigger.hidden).toBe(false);
    editor.view.dispatch({selection: {anchor: 2}});
    expect(menu.hidden).toBe(false);
    trigger.click();
    expect(menu.hidden).toBe(true);
    expect(editor.source).toBe("Body");
    expect(editor.view.state.selection.main.anchor).toBe(2);
  });
  it.each([["- item", "Bullet list"], ["> text", "Paragraph"]])(
    "selecting the current %s type closes without adding an undo event", (source, label) => {
      const {editor, root} = make(source);
      editor.view.dispatch({selection: {anchor: source.length}});
      const trigger = root.querySelector<HTMLButtonElement>(".tegg-command-more")!;
      expect(trigger.querySelector("svg.tegg-command-glyph")).not.toBeNull();
      const history = undoDepth(editor.view.state);
      trigger.click();
      const choice = option(root, label);
      expect(choice.getAttribute("aria-current")).toBe("true");
      if (source.startsWith(">")) {
        expect(choice.getAttribute("aria-selected")).toBe("true");
        expect(option(root, "Wrap in quote")).toBeUndefined();
      }
      choice.click();
      expect(editor.source).toBe(source);
      expect(undoDepth(editor.view.state)).toBe(history);
      expect(root.querySelector<HTMLElement>(".tegg-command-menu")?.hidden).toBe(true);
    });
  it("checks paragraph and list styles independently inside mixed containers", () => {
    const source = "- ## title\n- sibling";
    const {editor, root} = make(source);
    editor.view.dispatch({selection: {anchor: source.indexOf("title") + 2}});
    const trigger = root.querySelector<HTMLButtonElement>(".tegg-command-more")!;
    expect(trigger.querySelector("svg")?.getAttribute("data-icon")).toBe("heading-2");
    const before = undoDepth(editor.view.state);
    trigger.click();
    expect(option(root, "Heading 2").getAttribute("aria-current")).toBe("true");
    expect(option(root, "Bullet list").getAttribute("aria-current")).toBe("true");
    expect(option(root, "Paragraph").getAttribute("aria-current")).toBeNull();
    option(root, "Heading 2").click();
    expect(editor.source).toBe(source);
    expect(undoDepth(editor.view.state)).toBe(before);
    trigger.click();
    option(root, "Paragraph").click();
    expect(editor.source).toBe("- title\n- sibling");
    editor.command("undo"); expect(editor.source).toBe(source);
  });
  it("describes wrapping a whole list in a quote and omits that action inside quotes", () => {
    const source = "- one\n- two";
    const {editor, root} = make(source);
    editor.view.dispatch({selection: {anchor: source.indexOf("one") + 1}});
    const trigger = root.querySelector<HTMLButtonElement>(".tegg-command-more")!;
    trigger.click();
    expect(option(root, "Paragraph").getAttribute("aria-current")).toBe("true");
    expect(option(root, "Bullet list").getAttribute("aria-current")).toBe("true");
    option(root, "Wrap list in quote").click();
    expect(editor.source).toBe("> - one\n> - two");
    trigger.click();
    expect(option(root, "Wrap list in quote")).toBeUndefined();
    expect(option(root, "Paragraph").getAttribute("aria-current")).toBe("true");
    expect(option(root, "Bullet list").getAttribute("aria-current")).toBe("true");
    editor.command("undo"); expect(editor.source).toBe(source);
  });
  it("does not offer block actions while editing YAML metadata source", () => {
    const source = "---\ntitle: X\n---\nBody";
    const {editor, root} = make(source);
    editor.view.dispatch({selection: {anchor: source.indexOf("X")}});
    const plus = root.querySelector<HTMLButtonElement>(".tegg-command-plus")!;
    const more = root.querySelector<HTMLButtonElement>(".tegg-command-more")!;
    const menu = root.querySelector<HTMLElement>(".tegg-command-menu")!;
    expect(plus.hidden).toBe(true);
    expect(more.hidden).toBe(true);
    more.click();
    expect(menu.hidden).toBe(true);
    expect(editor.source).toBe(source);
  });
  it("treats a click on the nested type icon as a repeated trigger click", () => {
    const {editor, root} = make("- item");
    editor.view.dispatch({selection: {anchor: 5}});
    const trigger = root.querySelector<HTMLButtonElement>(".tegg-command-more")!;
    const icon = trigger.querySelector<SVGElement>("svg")!;
    const menu = root.querySelector<HTMLElement>(".tegg-command-menu")!;
    icon.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, cancelable: true}));
    icon.dispatchEvent(new MouseEvent("click", {bubbles: true}));
    expect(menu.hidden).toBe(false);
    icon.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, cancelable: true}));
    icon.dispatchEvent(new MouseEvent("click", {bubbles: true}));
    expect(menu.hidden).toBe(true);
    expect(editor.source).toBe("- item");
  });
  it("closes an explicit menu when its source or selection changes before a choice", () => {
    const {editor, root} = make("Body");
    editor.view.dispatch({selection: {anchor: 2}});
    const trigger = root.querySelector<HTMLButtonElement>(".tegg-command-more")!;
    const menu = root.querySelector<HTMLElement>(".tegg-command-menu")!;
    trigger.click();
    editor.view.dispatch({selection: {anchor: 3}});
    expect(menu.hidden).toBe(true);
    trigger.click();
    editor.view.dispatch({changes: {from: 0, insert: "New "}});
    expect(menu.hidden).toBe(true);
    expect(editor.source).toBe("New Body");
  });
  it("supports Arrow and Enter from the focused block trigger without changing the selection first", () => {
    const {editor, root} = make("Body");
    editor.view.dispatch({selection: {anchor: 2}});
    const trigger = root.querySelector<HTMLButtonElement>(".tegg-command-more")!;
    trigger.focus(); trigger.click();
    const selection = editor.view.state.selection;
    const down = new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true});
    trigger.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(option(root, "Heading 1").getAttribute("aria-selected")).toBe("true");
    expect(editor.view.state.selection.eq(selection)).toBe(true);
    trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
    expect(editor.source).toBe("# Body");
    editor.command("undo"); expect(editor.source).toBe("Body");
  });
  it("inserts an ordered list and converts a block to H6 with one undo each", () => {
    const inserted = make("");
    inserted.root.querySelector<HTMLButtonElement>(".tegg-command-plus")!.click();
    option(inserted.root, "Numbered list").click();
    expect(inserted.editor.source).toBe("1. ");
    inserted.editor.command("undo"); expect(inserted.editor.source).toBe("");
    const transformed = make("Body");
    transformed.editor.view.dispatch({selection: {anchor: 2}});
    transformed.root.querySelector<HTMLButtonElement>(".tegg-command-more")!.click();
    option(transformed.root, "Heading 6").click();
    expect(transformed.editor.source).toBe("###### Body");
    transformed.editor.command("undo"); expect(transformed.editor.source).toBe("Body");
  });
  it.each([
    ["/math", "Math block", "x^2", "$$\nx^2\n$$"],
    ["/mermaid", "Mermaid", "flowchart TD\n  A --> B", "```mermaid\nflowchart TD\n  A --> B\n```"],
    ["/graphviz", "Graphviz", "digraph { a -> b }", "```graphviz\ndigraph { a -> b }\n```"],
  ])("reviews %s as a local draft before one reversible insertion", (query, label, body, expected) => {
    const root = document.body.appendChild(document.createElement("div"));
    const editor = new TeggMarkdownEditor(root, {documentId: "draft", revision: "r1", source: query, profile: "tegg"}, {}, "live");
    editors.push(editor);
    const ui = attachEditingUI(editor.editing, root, {toolbar: false});
    try {
      const choose = () => {
        editor.view.focus();
        editor.view.dispatch({selection: {anchor: 0}});
        editor.view.dispatch({selection: {anchor: query.length}});
        option(root, label).click();
      };
      choose();
      expect(editor.source).toBe(query);
      expect(root.querySelector<HTMLElement>(".tegg-editing-panel")?.hidden).toBe(false);
      root.querySelector<HTMLButtonElement>('button[data-label="Cancel"]')!.click();
      expect(editor.source).toBe(query);
      choose();
      const input = root.querySelector<HTMLTextAreaElement>(".tegg-object-body")!;
      input.value = body;
      input.dispatchEvent(new Event("input", {bubbles: true}));
      expect(editor.source).toBe(query);
      root.querySelector<HTMLButtonElement>('button[data-label="Apply"]')!.click();
      expect(editor.source).toBe(expected);
      editor.command("undo");
      expect(editor.source).toBe(query);
    } finally {ui.destroy();}
  });
  it("matches a Chinese slash query against the localized command label", () => {
    const {editor, root} = make("/表格", "live", "tegg", "zh-CN");
    editor.view.dispatch({selection: {anchor: 3}});
    const table = option(root, "表格");
    expect(table).toBeDefined();
    table.click();
    expect(editor.source).toContain("| Column 1 | Column 2 |");
  });
  it("moves the current logical block using the block menu", () => {
    const {editor, root} = make("one\n\ntwo");
    editor.view.dispatch({selection: {anchor: 1}});
    root.querySelector<HTMLButtonElement>(".tegg-command-more")!.click();
    option(root, "Move down").click();
    expect(editor.source).toBe("two\n\none");
    editor.command("undo"); expect(editor.source).toBe("one\n\ntwo");
  });
  it("names the enclosing quote before moving a quoted heading and restores its whole source", () => {
    const source = "before\n\n> ## title\n> description\n\nafter";
    const {editor, root} = make(source);
    editor.view.dispatch({selection: {anchor: source.indexOf("title") + 1}});
    root.querySelector<HTMLButtonElement>(".tegg-command-more")!.click();
    expect(option(root, "Move up")).toBeUndefined();
    option(root, "Move entire quote down").click();
    expect(editor.source).toBe("before\n\nafter\n\n> ## title\n> description");
    editor.command("undo"); expect(editor.source).toBe(source);
    editor.command("redo"); expect(editor.source).toBe("before\n\nafter\n\n> ## title\n> description");
  });
  it("names the nearest list item and moves its nested children without moving the quote", () => {
    const source = "> - ## first\n>   - child\n> - second\n\noutside";
    const {editor, root} = make(source);
    editor.view.dispatch({selection: {anchor: source.indexOf("first") + 1}});
    root.querySelector<HTMLButtonElement>(".tegg-command-more")!.click();
    option(root, "Move list item down").click();
    expect(editor.source).toBe("> - second\n> - ## first\n>   - child\n\noutside");
    editor.command("undo"); expect(editor.source).toBe(source);
  });
  it("localizes the explicit quoted-heading movement scope", () => {
    const source = "> ## title\n> body\n\nnext";
    const {editor, root} = make(source, "live", "tegg", "zh-CN");
    editor.view.dispatch({selection: {anchor: source.indexOf("title") + 1}});
    root.querySelector<HTMLButtonElement>(".tegg-command-more")!.click();
    expect(option(root, "下移整段引用")).toBeDefined();
  });
  it("leaves source mode, IME and code input alone", () => {
    const source = make("/", "source");
    source.editor.view.dispatch({selection: {anchor: 1}});
    expect(source.root.querySelector<HTMLElement>(".tegg-command-menu")?.hidden).toBe(true);
    const code = make("```md\n/\n```", "live");
    code.editor.view.dispatch({selection: {anchor: 7}});
    expect(code.root.querySelector<HTMLElement>(".tegg-command-menu")?.hidden).toBe(true);
    const composing = make("/", "live");
    Object.defineProperty(composing.editor.view, "composing", {configurable: true, get: () => true});
    composing.editor.view.dispatch({selection: {anchor: 1}});
    expect(composing.root.querySelector<HTMLElement>(".tegg-command-menu")?.hidden).toBe(true);
  });
  it("places a menu above a caret near the viewport bottom", () => {
    const {editor, root} = make("/");
    const menu = root.querySelector<HTMLElement>(".tegg-command-menu")!;
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({top: 80, bottom: 90, left: 20, right: 20});
    vi.spyOn(editor.view.dom, "getBoundingClientRect").mockReturnValue({top: 0, bottom: 200, left: 0, right: 240, width: 240, height: 200} as DOMRect);
    vi.spyOn(menu, "getBoundingClientRect").mockReturnValue({top: 0, bottom: 60, left: 0, right: 180, width: 180, height: 60} as DOMRect);
    vi.spyOn(editor.view, "requestMeasure").mockImplementation(request => {if (request) request.write?.(request.read(editor.view), editor.view);});
    const prior = window.innerHeight;
    Object.defineProperty(window, "innerHeight", {configurable: true, value: 100});
    try {
      editor.view.dispatch({selection: {anchor: 1}});
      expect(menu.hidden).toBe(false);
      expect(Number.parseInt(menu.style.top)).toBeLessThan(80);
    } finally {
      Object.defineProperty(window, "innerHeight", {configurable: true, value: prior});
      vi.restoreAllMocks();
    }
  });
  it("keeps a flipped menu below a tall toolbar outside the editor", () => {
    const {editor, root} = make("Body");
    const menu = root.querySelector<HTMLElement>(".tegg-command-menu")!;
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({top: 326, bottom: 342, left: 40, right: 40});
    vi.spyOn(editor.view.dom, "getBoundingClientRect").mockReturnValue({
      top: 200, bottom: 800, left: 0, right: 390, width: 390, height: 600,
    } as DOMRect);
    vi.spyOn(menu, "getBoundingClientRect").mockReturnValue({top: 0, bottom: 280, left: 0, right: 194, width: 194, height: 280} as DOMRect);
    vi.spyOn(editor.view, "requestMeasure").mockImplementation(request => {if (request) request.write?.(request.read(editor.view), editor.view);});
    const prior = {width: window.innerWidth, height: window.innerHeight};
    Object.defineProperties(window, {innerWidth: {configurable: true, value: 390}, innerHeight: {configurable: true, value: 360}});
    try {
      editor.view.dispatch({selection: {anchor: 2}});
      root.querySelector<HTMLButtonElement>(".tegg-command-more")!.click();
      expect(menu.hidden).toBe(false);
      expect(200 + Number.parseFloat(menu.style.top)).toBeGreaterThanOrEqual(204);
      expect(200 + Number.parseFloat(menu.style.top) + Number.parseFloat(menu.style.maxHeight)).toBeLessThanOrEqual(352);
    } finally {
      Object.defineProperties(window, {innerWidth: {configurable: true, value: prior.width}, innerHeight: {configurable: true, value: prior.height}});
      vi.restoreAllMocks();
    }
  });
  it("anchors block actions before the first line without covering text at a narrow edge", () => {
    const source = "first line\nsecond part";
    const {editor, root} = make(source);
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation(position => ({
      left: 118 + position * 5, right: 118 + position * 5,
      top: position < source.indexOf("second") ? 20 : 60,
      bottom: position < source.indexOf("second") ? 30 : 70,
    }));
    vi.spyOn(editor.view.dom, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 120, left: 100, right: 300, width: 200, height: 120,
    } as DOMRect);
    vi.spyOn(editor.view, "requestMeasure").mockImplementation(request => {
      if (request) request.write?.(request.read(editor.view), editor.view);
    });
    try {
      editor.view.dispatch({selection: {anchor: source.indexOf("part") + 2}});
      const more = root.querySelector<HTMLButtonElement>(".tegg-command-more")!;
      expect(more.hidden).toBe(false);
      expect(more.style.left).toBe("4px");
      expect(more.style.top).toBe("11px");
      expect(Number.parseInt(more.style.left) + 28).toBeLessThan(40);
    } finally {vi.restoreAllMocks();}
  });
});
