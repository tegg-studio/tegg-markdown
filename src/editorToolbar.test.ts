import { describe, expect, it } from "vitest";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { history, undo } from "@codemirror/commands";
import { editorToolbarState, executeEditorCommand } from "./editorToolbar";

function editor(doc: string, anchor: number, head = anchor) {
  const view = {
    state: EditorState.create({doc, selection: {anchor, head}, extensions: [markdown({extensions: GFM}), history()]}),
    dispatch(transaction: TransactionSpec | Transaction) {
      this.state = transaction instanceof Transaction ? transaction.state : this.state.update(transaction).state;
    },
    focus() {},
  };
  return view as unknown as EditorView;
}

describe("native formatting toolbar contract", () => {
  it("reports the caret's nested inline styles without confusing code content", () => {
    expect(editorToolbarState(editor("**bold *both***", 10).state)).toMatchObject({bold: true, italic: true, code: false});
    expect(editorToolbarState(editor("`**literal**`", 5).state)).toMatchObject({bold: false, italic: false, code: true});
  });
  it("toggles bold off at a caret and preserves content and caret", () => {
    const view = editor("before **bold** after", 11);
    executeEditorCommand(view, "bold");
    expect(view.state.doc.toString()).toBe("before bold after");
    expect(view.state.selection.main.anchor).toBe(9);
  });
  it("toggles a formatted selection without nested markers", () => {
    const view = editor("hello", 0, 5);
    executeEditorCommand(view, "bold");
    expect(editorToolbarState(view.state).bold).toBe(true);
    executeEditorCommand(view, "bold");
    expect(view.state.doc.toString()).toBe("hello");
    expect(view.state.selection.main.to).toBe(5);
  });
  it("removes a whole wrapper or just the selected format within nested marks", () => {
    const whole = editor("**hello**", 0, 9);
    executeEditorCommand(whole, "bold");
    expect(whole.state.doc.toString()).toBe("hello");
    const nested = editor("**bold *both***", 10);
    executeEditorCommand(nested, "italic");
    expect(nested.state.doc.toString()).toBe("**bold both**");
  });
  it("reports mixed headings and excludes an unselected following line", () => {
    expect(editorToolbarState(editor("# one\n## two", 0, 12).state).heading).toBeNull();
    expect(editorToolbarState(editor("# one\n## two", 0, 6).state).heading).toBe(1);
  });
  it("reads heading levels from syntax, including Setext and empty headings", () => {
    expect(editorToolbarState(editor("Title\n=====", 3).state).heading).toBe(1);
    expect(editorToolbarState(editor("Title\n-----", 3).state).heading).toBe(2);
    expect(editorToolbarState(editor("###", 3).state).heading).toBe(3);
    expect(editorToolbarState(editor("```md\n## code\n```", 10).state).heading).toBe(0);
  });
  it("normalizes headings and returns to body", () => {
    const view = editor("### title", 4);
    executeEditorCommand(view, "heading2");
    expect(view.state.doc.toString()).toBe("## title");
    executeEditorCommand(view, "heading0");
    expect(view.state.doc.toString()).toBe("title");
  });
  it("changes heading syntax while preserving the text selection", () => {
    const view = editor("#### title", 6, 9);
    executeEditorCommand(view, "heading2");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("itl");
    expect(view.state.doc.toString()).toBe("## title");
  });
  it("converts Setext and closed ATX headings without leaving visible markers", () => {
    const setext = editor("Title\n=====", 2);
    executeEditorCommand(setext, "heading3");
    expect(setext.state.doc.toString()).toBe("### Title");
    const closed = editor("## Title ##", 5);
    executeEditorCommand(closed, "heading0");
    expect(closed.state.doc.toString()).toBe("Title");
    const empty = editor("###", 3);
    executeEditorCommand(empty, "heading2");
    expect(empty.state.doc.toString()).toBe("## ");
    const code = editor("```md\n## code\n```", 10);
    executeEditorCommand(code, "heading1");
    expect(code.state.doc.toString()).toBe("```md\n## code\n```");
  });
  it("toggles task formatting without deleting text or a following line", () => {
    const view = editor("one\ntwo", 0, 4);
    executeEditorCommand(view, "task");
    expect(view.state.doc.toString()).toBe("- [ ] one\ntwo");
    expect(editorToolbarState(view.state).task).toBe(true);
    executeEditorCommand(view, "task");
    expect(view.state.doc.toString()).toBe("one\ntwo");
  });
  it("preserves the entire paragraph around a Callout selection", () => {
    const view = editor("before selected after", 7, 15);
    executeEditorCommand(view, "callout");
    expect(view.state.doc.toString()).toBe("> [!note]\n> before selected after");
  });
  it("separates inserted blocks from adjacent prose", () => {
    const view = editor("left right", 5);
    executeEditorCommand(view, "table");
    expect(view.state.doc.toString()).toContain("left \n\n| Column 1");
    expect(view.state.doc.toString()).toMatch(/\n\nright$/);
  });
  it("undoes formatting separately from preceding typing", () => {
    const view = editor("word", 0, 4);
    view.dispatch({changes: {from: 4, insert: "!"}, userEvent: "input.type"});
    executeEditorCommand(view, "bold");
    undo({state: view.state, dispatch: transaction => { view.dispatch(transaction); }});
    expect(view.state.doc.toString()).toBe("word!");
  });
});

describe("Strikethrough and highlight toolbar actions", () => {
  it.each([['<u>Text</u>', 'underline'], ['~~Text~~', 'strike'], ['==Text==', 'highlight'], ['<mark>Text</mark>', 'highlight']])("reports and removes %s", (source, command) => {
    const view = editor(source, source.indexOf('Text') + 1);
    expect(editorToolbarState(view.state)[command as 'strike' | 'highlight' | 'underline']).toBe(true);
    executeEditorCommand(view, command);
    expect(view.state.doc.toString()).toBe('Text');
    expect(editorToolbarState(view.state)[command as 'strike' | 'highlight' | 'underline']).toBe(false);
    expect(undo({state: view.state, dispatch: transaction => view.dispatch(transaction)})).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });
  it.each(['strike', 'highlight', 'underline'])("toggles selected text with %s without nesting wrappers", command => {
    const view = editor('Text', 0, 4);
    executeEditorCommand(view, command);
    expect(editorToolbarState(view.state)[command as 'strike' | 'highlight' | 'underline']).toBe(true);
    executeEditorCommand(view, command);
    expect(view.state.doc.toString()).toBe('Text');
  });
  it("removes only highlight around nested bold", () => {
    const view = editor('<mark>**Text**</mark>', 9);
    executeEditorCommand(view, 'highlight');
    expect(view.state.doc.toString()).toBe('**Text**');
    expect(editorToolbarState(view.state).bold).toBe(true);
  });
  it("does not report highlight for literal syntax in code", () => {
    expect(editorToolbarState(editor('`==Text==`', 5).state).highlight).toBe(false);
    expect(editorToolbarState(editor('```md\n==Text==\n```', 10).state).highlight).toBe(false);
  });
});

describe("Underline boundaries", () => {
  it("preserves nested emphasis when removing underline", () => {
    const view = editor('<u>**Text**</u>', 6);
    executeEditorCommand(view, 'underline');
    expect(view.state.doc.toString()).toBe('**Text**');
    expect(editorToolbarState(view.state).bold).toBe(true);
  });
  it("ignores literal tags and unsupported attributes", () => {
    for (const source of ['`<u>Text</u>`', '<u class="x">Text</u>', '<u>Text']) {
      expect(editorToolbarState(editor(source, source.indexOf('Text') + 1).state).underline).toBe(false);
    }
  });
});

describe('Mixed selection formatting', () => {
  it.each([
    ['bold', '**'], ['italic', '*'], ['strike', '~~'], ['highlight', '=='], ['underline', '<u>'],
  ])('unifies mixed %s and then removes it', (command, open) => {
    const close = open === '<u>' ? '</u>' : open;
    const source = `甲${open}乙${close}`;
    const view = editor(source, 0, source.length);
    expect(editorToolbarState(view.state).mixed).toContain(command);
    executeEditorCommand(view, command);
    expect(view.state.doc.toString()).toBe(`${open}甲乙${close}`);
    expect(editorToolbarState(view.state).mixed).not.toContain(command);
    executeEditorCommand(view, command);
    expect(view.state.doc.toString()).toBe('甲乙');
    undo({state: view.state, dispatch: transaction => view.dispatch(transaction)});
    expect(view.state.doc.toString()).toBe(`${open}甲乙${close}`);
  });
  it('removes only the selected part of a bold span', () => {
    const view = editor('**甲乙丙**', 3, 4);
    executeEditorCommand(view, 'bold');
    expect(view.state.doc.toString()).toBe('**甲**乙**丙**');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('乙');
  });
  it('counts separate bold spans as fully bold, ignoring spaces', () => {
    const view = editor('**甲** **乙**', 0, 11);
    expect(editorToolbarState(view.state).bold).toBe(true);
    executeEditorCommand(view, 'bold');
    expect(view.state.doc.toString()).toBe('甲 乙');
  });
  it('preserves italic and underline when unifying bold', () => {
    const source = '甲**乙** *丙* <u>丁</u>';
    const view = editor(source, source.length, 0);
    executeEditorCommand(view, 'bold');
    expect(editorToolbarState(view.state).bold).toBe(true);
    expect(view.state.doc.toString()).toBe('**甲乙 *丙* <u>丁</u>**');
    expect(view.state.selection.main.anchor).toBeGreaterThan(view.state.selection.main.head);
    executeEditorCommand(view, 'bold');
    expect(view.state.doc.toString()).toBe('甲乙 *丙* <u>丁</u>');
  });
  it('preserves formatting outside a selection crossing a bold boundary', () => {
    const view = editor('甲**乙丙**丁', 0, 4);
    executeEditorCommand(view, 'bold');
    expect(view.state.doc.toString()).toBe('**甲乙丙**丁');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('甲乙');
  });
});

it('keeps italic across a partially bold selection', async () => {
  const {markdownParser} = await import('./markdownParser');
  const view = editor('*甲乙丙*', 2, 3);
  executeEditorCommand(view, 'bold');
  expect(markdownParser.render(view.state.doc.toString())).toBe('<p><em>甲<strong>乙</strong>丙</em></p>\n');
});
it('does not wrap block markers when formatting multiple paragraphs', () => {
  const view = editor('甲\n\n乙', 0, 4);
  executeEditorCommand(view, 'bold');
  expect(view.state.doc.toString()).toBe('**甲**\n\n**乙**');
  expect(editorToolbarState(view.state).bold).toBe(true);
});

it('formats link labels without changing destinations', () => {
  const source = '[甲**乙**](https://example.com "Title")';
  const view = editor(source, 0, source.length);
  executeEditorCommand(view, 'bold');
  expect(view.state.doc.toString()).toBe('[**甲乙**](https://example.com "Title")');
  expect(editorToolbarState(view.state).bold).toBe(true);
  executeEditorCommand(view, 'bold');
  expect(view.state.doc.toString()).toBe('[甲乙](https://example.com "Title")');
});
it('preserves heading syntax and code contents', () => {
  const source = '## 甲**乙**';
  const view = editor(source, 0, source.length);
  executeEditorCommand(view, 'bold');
  expect(view.state.doc.toString()).toBe('## **甲乙**');
  const code = editor('甲 `code`', 0, 8);
  executeEditorCommand(code, 'bold');
  expect(code.state.doc.toString()).toBe('**甲 `code`**');
  const partial = editor('`code`', 2, 4);
  executeEditorCommand(partial, 'bold');
  expect(partial.state.doc.toString()).toBe('`code`');
});

it.each(['bold', 'italic', 'underline', 'strike', 'highlight'])('never inserts %s placeholder inside literal code', command => {
  const view = editor('`甲乙`', 2);
  expect(editorToolbarState(view.state).inlineFormattingEnabled).toBe(false);
  executeEditorCommand(view, command);
  expect(view.state.doc.toString()).toBe('`甲乙`');
});

it.each(['bold', 'italic', 'underline', 'strike', 'highlight'])('keeps multiple code spans literal for %s', command => {
  const source = '`甲` `乙`';
  const view = editor(source, 0, source.length);
  expect(editorToolbarState(view.state).inlineFormattingEnabled).toBe(false);
  executeEditorCommand(view, command);
  expect(view.state.doc.toString()).toBe(source);
});
