// @vitest-environment jsdom
import {afterEach, describe, expect, it} from "vitest";
import {EditorState, type Transaction, type TransactionSpec} from "@codemirror/state";
import type {EditorView} from "@codemirror/view";
import {markdown} from "@codemirror/lang-markdown";
import {GFM} from "@lezer/markdown";
import {history, redo, undo} from "@codemirror/commands";
import {TeggMarkdownEditor} from "./editor";
import {executeEditorCommand} from "./editorToolbar";
import {blockContext} from "./blockContext";
import {planStructuralInsert, planMoveBlock, planWrapQuote} from "./structuralCommands";
import {consumePendingInlineStyle, pendingInlineStyle, pendingInlineStyles} from "./pendingInlineStyle";

function view(source: string, anchor: number, head = anchor) {
  const result = {
    state: EditorState.create({doc: source, selection: {anchor, head}, extensions: [markdown({extensions: GFM}), history()]}),
    dispatch(transaction: Transaction | TransactionSpec) {
      this.state = transaction instanceof Object && "state" in transaction ? transaction.state : this.state.update(transaction as TransactionSpec).state;
    }, focus() {},
  };
  return result as unknown as EditorView;
}
const source = (editor: EditorView) => editor.state.doc.toString();

describe("semantic block commands", () => {
  it.each([
    ["before after\n\n- next", "before ", "before \n\n```text\n\n```\n\nafter\n\n- next"],
    ["- before after\n- next", "before ", "- before \n  \n  ```text\n  \n  ```\n  \n  after\n- next"],
    ["> before after\n> next", "before ", "> before \n>\n> ```text\n> \n> ```\n>\n> after\n> next"],
    ["> [!NOTE]\n> before after\n> next", "before ", "> [!NOTE]\n> before \n>\n> ```text\n> \n> ```\n>\n> after\n> next"],
  ])("keeps enclosing structure and following text for %s", (initial, prefix, expected) => {
    const at = initial.indexOf(prefix) + prefix.length;
    const editor = view(initial, at);
    executeEditorCommand(editor, "codeBlock", "live");
    expect(source(editor)).toBe(expected);
    expect(blockContext(editor.state, editor.state.selection.main.anchor).protectedBlock).toBe(true);
    expect(undo({state: editor.state, dispatch: transaction => editor.dispatch(transaction)})).toBe(true);
    expect(source(editor)).toBe(initial);
    expect(redo({state: editor.state, dispatch: transaction => editor.dispatch(transaction)})).toBe(true);
    expect(source(editor)).toBe(expected);
  });

  it.each(["- text", "> text", "> [!NOTE]\n> text", "- > text"])("turns content into a heading inside %s", initial => {
    const at = initial.lastIndexOf("text") + 2;
    const editor = view(initial, at);
    executeEditorCommand(editor, "heading2", "live");
    expect(source(editor)).toBe(initial.replace("text", "## text"));
    executeEditorCommand(editor, "heading0", "live");
    expect(source(editor)).toBe(initial);
  });

  it("does not write paragraph or container markers into fenced code", () => {
    const initial = "before\n\n```md\ntext\n```\n\nafter";
    const at = initial.indexOf("text") + 2;
    const editor = view(initial, at);
    for (const command of ["heading2", "table", "quote", "bold"]) executeEditorCommand(editor, command, "live");
    expect(source(editor)).toBe(initial);
  });

  it("plans selection and empty-line insertion without changing outer source", () => {
    const initial = "sentinel\n\n- before selected after\n\nend";
    const from = initial.indexOf("selected"), to = from + "selected".length;
    const editor = view(initial, from, to);
    const plan = planStructuralInsert(editor.state, {from, to}, "```text\nselected\n```", "code")!;
    expect(plan.patches).toHaveLength(1);
    editor.dispatch({changes: plan.patches, selection: plan.selection});
    expect(source(editor)).toContain("- before \n  \n  ```text\n  selected\n  ```\n  \n   after");
    expect(source(editor).startsWith("sentinel\n\n")).toBe(true);
    expect(source(editor).endsWith("\n\nend")).toBe(true);
    const empty = view("- \n- next", 2);
    executeEditorCommand(empty, "table", "live");
    expect(source(empty)).toMatch(/^- \| Column 1 \| Column 2 \|\n  \| --- \| --- \|/);
  });
  it("moves an entire list item with nested children in one patch", () => {
    const initial = "before\n\n- first\n  - child\n- second\n\nafter";
    const editor = view(initial, initial.indexOf("first"));
    const plan = planMoveBlock(editor.state, editor.state.selection.main.anchor, "down")!;
    expect(plan.patches).toHaveLength(1);
    editor.dispatch({changes: plan.patches, selection: plan.selection});
    expect(source(editor)).toBe("before\n\n- second\n- first\n  - child\n\nafter");
  });
  it("wraps a logical list item as a quote without losing its marker", () => {
    const initial = "intro\n\n- first\n  - child\n- second";
    const editor = view(initial, initial.indexOf("first"));
    const plan = planWrapQuote(editor.state, editor.state.selection.main.anchor)!;
    editor.dispatch({changes: plan.patches, selection: plan.selection});
    expect(source(editor)).toBe("intro\n\n> - first\n>   - child\n> - second");
  });
  it.each([
    ["- first\n\n  continued text\n- next", "continued ", "  ", "- next"],
    ["> - first\n>\n>   continued text\n> - next", "continued ", ">   ", "> - next"],
    ["- [ ] task text\n- next", "task ", "  ", "- next"],
    ["> - [ ] task text\n> - next", "task ", ">   ", "> - next"],
  ])("uses actual item content indentation inside %s", (initial, cursorPrefix, continuation, sibling) => {
    const at = initial.indexOf(cursorPrefix) + cursorPrefix.length;
    const editor = view(initial, at);
    expect(blockContext(editor.state, at).continuationPrefix).toBe(continuation);
    executeEditorCommand(editor, "codeBlock", "live");
    expect(source(editor)).toContain(continuation + "```text\n" + continuation + "\n" + continuation + "```");
    expect(source(editor)).toContain(sibling);
    expect(undo({state: editor.state, dispatch: transaction => editor.dispatch(transaction)})).toBe(true);
    expect(source(editor)).toBe(initial);
  });
  it("inserts a table into a list continuation without leaving the item", () => {
    const initial = "- first\n\n  continued text\n- next";
    const editor = view(initial, initial.indexOf("continued ") + "continued ".length);
    executeEditorCommand(editor, "table", "live");
    expect(source(editor)).toContain("  | Column 1 | Column 2 |\n  | --- | --- |\n  |  |  |");
    expect(source(editor)).toContain("\n- next");
    expect(undo({state: editor.state, dispatch: transaction => editor.dispatch(transaction)})).toBe(true);
    expect(source(editor)).toBe(initial);
  });
  it("accepts a multiline selection spanning one list item's first and continuation paragraphs", () => {
    const initial = "- before selected\n\n  more after\n- next";
    const from = initial.indexOf("selected"), to = initial.indexOf("more") + 4;
    const editor = view(initial, from, to);
    expect(blockContext(editor.state, from).listItemFrom).toBe(blockContext(editor.state, to).listItemFrom);
    executeEditorCommand(editor, "codeBlock", "live");
    expect(source(editor)).toContain("- before \n  \n  ```text\n");
    expect(source(editor)).toContain("\n   after\n- next");
    expect(undo({state: editor.state, dispatch: transaction => editor.dispatch(transaction)})).toBe(true);
    expect(source(editor)).toBe(initial);
  });
  it("keeps an empty task marker and closes a code block before its sibling", () => {
    const editor = view("- [ ] \n- next", 6);
    executeEditorCommand(editor, "codeBlock", "live");
    expect(source(editor)).toBe("- [ ]\n  ```text\n  \n  ```\n- next");
  });
  it("handles line start and EOF without changing adjacent bytes", () => {
    const start = view("text\n\nend", 0);
    executeEditorCommand(start, "codeBlock", "live");
    expect(source(start)).toBe("```text\n\n```\n\ntext\n\nend");
    const end = view("text", 4);
    executeEditorCommand(end, "codeBlock", "live");
    expect(source(end)).toBe("text\n\n```text\n\n```");
  });
});

describe("object draft insertion contract", () => {
  const instances: TeggMarkdownEditor[] = [];
  afterEach(() => {for (const editor of instances.splice(0)) editor.destroy(); document.body.replaceChildren();});
  const make = (text: string, mode: "live" | "source" = "live") => {
    const root = document.body.appendChild(document.createElement("div"));
    const editor = new TeggMarkdownEditor(root, {documentId: "test", revision: "r1", source: text}, {}, mode);
    instances.push(editor); return editor;
  };
  it("commits a native code draft at a paragraph split in one undo", () => {
    const original = "before after\n\n- next";
    const editor = make(original), at = "before ".length;
    editor.view.dispatch({selection: {anchor: at}});
    const session = editor.editing.begin("code");
    expect(editor.editing.commit(session.token, "```text\nsample\n```")).toEqual({ok: true, changed: true});
    expect(editor.source).toBe("before \n\n```text\nsample\n```\n\nafter\n\n- next");
    editor.editing.command("undo"); expect(editor.source).toBe(original);
    editor.editing.command("redo"); expect(editor.source).toContain("```text\nsample\n```");
  });
  it("plans a native code draft over selected prose but edits an existing code object literally", () => {
    const original = "before selected after\n\n- next", from = original.indexOf("selected"), to = from + 8;
    const editor = make(original);
    const insertion = editor.editing.begin("code", {from, to});
    expect(editor.editing.commit(insertion.token, "```text\nsample\n```")).toEqual({ok: true, changed: true});
    expect(editor.source).toBe("before \n\n```text\nsample\n```\n\n after\n\n- next");
    editor.editing.command("undo"); expect(editor.source).toBe(original);
    const existing = make("```text\nold\n```\n\nafter");
    const current = existing.editing.begin("code", {from: 0, to: "```text\nold\n```".length});
    expect(existing.editing.commit(current.token, "```js\nnew\n```").ok).toBe(true);
    expect(existing.source).toBe("```js\nnew\n```\n\nafter");
  });
  it("keeps Source mode literal for the same draft", () => {
    const editor = make("before after", "source");
    editor.view.dispatch({selection: {anchor: 7}});
    const session = editor.editing.begin("code");
    expect(editor.editing.commit(session.token, "```text\nsample\n```").ok).toBe(true);
    expect(editor.source).toBe("before ```text\nsample\n```after");
  });
  it("arms inline styling without a placeholder and wraps the next typed text", () => {
    const editor = make("before after");
    editor.view.dispatch({selection: {anchor: 7}});
    expect(editor.editing.command("bold")).toBe(true);
    expect(editor.source).toBe("before after");
    expect(pendingInlineStyle(editor.view)).toBe("bold");
    expect(consumePendingInlineStyle(editor.view, 7, 7, "word")).toBe(true);
    expect(editor.source).toBe("before **word**after");
    editor.editing.command("undo");
    expect(editor.source).toBe("before after");
  });
  it("composes pending styles, reports toolbar state, and cancels each toggle", () => {
    const editor = make("word");
    editor.view.dispatch({selection: {anchor: 4}});
    editor.editing.command("bold"); editor.editing.command("italic");
    expect(editor.source).toBe("word");
    expect(pendingInlineStyles(editor.view.state)).toEqual(["bold", "italic"]);
    expect(editor.state).toMatchObject({bold: true, italic: true});
    editor.editing.command("italic");
    expect(pendingInlineStyles(editor.view.state)).toEqual(["bold"]);
    expect(consumePendingInlineStyle(editor.view, 4, 4, "x")).toBe(true);
    expect(editor.source).toBe("word**x**");
  });
  it("combines bold, italic and underline for the next input, then continues inside the markers", () => {
    const editor = make("tail");
    editor.view.dispatch({selection: {anchor: 0}});
    for (const command of ["bold", "italic", "underline"]) editor.editing.command(command);
    expect(editor.state).toMatchObject({bold: true, italic: true, underline: true});
    expect(consumePendingInlineStyle(editor.view, 0, 0, "中A")).toBe(true);
    expect(editor.source).toBe("***<u>中A</u>***tail");
    const cursor = editor.view.state.selection.main.anchor;
    editor.view.dispatch({changes: {from: cursor, insert: "文B"}, selection: {anchor: cursor + 2}, userEvent: "input.type"});
    expect(editor.source).toBe("***<u>中A文B</u>***tail");
    editor.editing.command("undo");
    expect(editor.source).toBe("***<u>中A</u>***tail");
    editor.editing.command("undo");
    expect(editor.source).toBe("tail");
  });
  it("turns off bold typing at the caret and keeps styled text on both sides", () => {
    const editor = make("**bold** after");
    editor.view.dispatch({selection: {anchor: 3}});
    editor.editing.command("bold");
    expect(editor.source).toBe("**bold** after");
    expect(editor.view.state.selection.main.anchor).toBe(3);
    expect(editor.state.bold).toBe(false);
    expect(consumePendingInlineStyle(editor.view, 3, 3, "X")).toBe(true);
    expect(editor.source).toBe("**b**X**old** after");
    editor.editing.command("undo");
    expect(editor.source).toBe("**bold** after");
    editor.view.dispatch({selection: {anchor: 10}});
    editor.editing.command("italic");
    expect(pendingInlineStyle(editor.view)).toBe("italic");
    editor.view.dispatch({selection: {anchor: 9}});
    expect(pendingInlineStyle(editor.view)).toBeNull();
  });
  it.each([
    ["*abcd*", "italic", "*ab*X*cd*"],
    ["<u>abcd</u>", "underline", "<u>ab</u>X<u>cd</u>"],
  ])("splits %s around a newly unstyled character", (initial, command, expected) => {
    const editor = make(initial), at = initial.indexOf("ab") + 2;
    editor.view.dispatch({selection: {anchor: at}});
    editor.editing.command(command);
    expect(editor.source).toBe(initial);
    expect(editor.view.state.selection.main.anchor).toBe(at);
    expect(consumePendingInlineStyle(editor.view, at, at, "X")).toBe(true);
    expect(editor.source).toBe(expected);
  });
  it("keeps the caret within bold text until an IME commit splits the span", async () => {
    const editor = make("**abcd**"), at = 4;
    editor.view.dispatch({selection: {anchor: at}});
    editor.editing.command("bold");
    expect(editor.source).toBe("**abcd**");
    expect(editor.view.state.selection.main.anchor).toBe(at);
    editor.view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    editor.view.dispatch({changes: {from: at, insert: "中"}, selection: {anchor: at + 1}, userEvent: "input.type.compose"});
    editor.view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
    await Promise.resolve();
    expect(editor.source).toBe("**ab**中**cd**");
    editor.editing.command("undo");
    expect(editor.source).toBe("**abcd**");
  });
  it.each([
    [2, "X**abcd**"], [6, "**abcd**X"],
  ])("places unstyled input at a bold boundary without empty marks (%i)", (at, expected) => {
    const editor = make("**abcd**");
    editor.view.dispatch({selection: {anchor: at}});
    editor.editing.command("bold");
    expect(consumePendingInlineStyle(editor.view, at, at, "X")).toBe(true);
    expect(editor.source).toBe(expected);
  });
  it("relocates committed IME text outside an opening bold marker", async () => {
    const editor = make("**abcd**"), at = 2;
    editor.view.dispatch({selection: {anchor: at}});
    editor.editing.command("bold");
    editor.view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    editor.view.dispatch({changes: {from: at, insert: "中"}, selection: {anchor: at + 1}, userEvent: "input.type.compose"});
    editor.view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
    await Promise.resolve();
    expect(editor.source).toBe("中**abcd**");
    editor.editing.command("undo");
    expect(editor.source).toBe("**abcd**");
  });
  it("keeps pending style through whitespace and wraps a completed composition", async () => {
    const editor = make("after");
    editor.view.dispatch({selection: {anchor: 0}});
    editor.editing.command("bold");
    expect(consumePendingInlineStyle(editor.view, 0, 0, " ")).toBe(true);
    expect(editor.source).toBe(" after");
    expect(pendingInlineStyle(editor.view)).toBe("bold");
    editor.view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    editor.view.dispatch({changes: {from: 1, insert: "中文"}, selection: {anchor: 3}, userEvent: "input.type.compose"});
    editor.view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
    await Promise.resolve();
    expect(editor.source).toBe(" **中文**after");
    expect(pendingInlineStyles(editor.view.state)).toEqual([]);
    editor.view.dispatch({changes: {from: 5, insert: "!"}, selection: {anchor: 6}, userEvent: "input.type"});
    expect(editor.source).toBe(" **中文!**after");
  });
  it("keeps an armed style through composition-only whitespace without an empty wrapper", async () => {
    const editor = make("tail");
    editor.view.dispatch({selection: {anchor: 0}});
    editor.editing.command("bold");
    editor.view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    editor.view.dispatch({changes: {from: 0, insert: " "}, selection: {anchor: 1}, userEvent: "input.type.compose"});
    editor.view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
    await Promise.resolve();
    expect(editor.source).toBe(" tail");
    expect(pendingInlineStyles(editor.view.state)).toEqual(["bold"]);
    expect(consumePendingInlineStyle(editor.view, 1, 1, "word")).toBe(true);
    expect(editor.source).toBe(" **word**tail");
  });
  it("moves composed spaces outside a suppressed bold span before later typing", async () => {
    const editor = make("**Bold** tail");
    editor.view.dispatch({selection: {anchor: 6}});
    editor.editing.command("bold");
    editor.view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    editor.view.dispatch({changes: {from: 6, insert: " "}, selection: {anchor: 7}, userEvent: "input.type.compose"});
    editor.view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
    await Promise.resolve();
    expect(editor.source).toBe("**Bold**  tail");
    expect(pendingInlineStyles(editor.view.state)).toEqual([]);
    const at = editor.view.state.selection.main.anchor;
    editor.view.dispatch({changes: {from: at, insert: "plain"}, selection: {anchor: at + 5}, userEvent: "input.type"});
    expect(editor.source).toBe("**Bold** plain tail");
  });
  it("does not relocate composed input after cancelling or moving the suppressed style", async () => {
    const cancelled = make("**Bold** tail");
    cancelled.view.dispatch({selection: {anchor: 6}});
    cancelled.editing.command("bold");
    cancelled.editing.command("bold");
    cancelled.view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    cancelled.view.dispatch({changes: {from: 6, insert: " "}, selection: {anchor: 7}, userEvent: "input.type.compose"});
    cancelled.view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
    await Promise.resolve();
    expect(cancelled.source).toBe("**Bold ** tail");

    const moved = make("**Bold** tail");
    moved.view.dispatch({selection: {anchor: 6}});
    moved.editing.command("bold");
    moved.view.dispatch({selection: {anchor: 9}});
    moved.view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    moved.view.dispatch({changes: {from: 9, insert: " "}, selection: {anchor: 10}, userEvent: "input.type.compose"});
    moved.view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
    await Promise.resolve();
    expect(moved.source).toBe("**Bold**  tail");
  });
});
