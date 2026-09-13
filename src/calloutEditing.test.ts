import { describe, expect, it } from "vitest";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { history, undo, undoDepth } from "@codemirror/commands";
import { calloutContext, calloutRanges, setCalloutType } from "./calloutEditing";
import { editorToolbarState } from "./editorToolbar";

function editor(doc: string, anchor = 0, head = anchor) {
  const view = {
    state: EditorState.create({doc, selection: {anchor, head}, extensions: [markdown(), history()]}),
    dispatch(transaction: TransactionSpec | Transaction) {
      this.state = transaction instanceof Transaction ? transaction.state : this.state.update(transaction).state;
    }, focus() {},
  };
  return view as unknown as EditorView;
}
describe("Callout source-preserving commands", () => {
  it("converts only a type, maps the caret, preserves fold/title/body, and undoes once", () => {
    const source = "> [!TIP]- **Custom**\n> [link](https://example.com)\n> - body";
    const view = editor(source, source.length);
    setCalloutType(view, "important");
    expect(view.state.doc.toString()).toBe(source.replace("TIP", "important"));
    expect(view.state.selection.main.anchor).toBe(source.length + 6);
    expect(undoDepth(view.state)).toBe(1);
    undo({state: view.state, dispatch: transaction => view.dispatch(transaction)});
    expect(view.state.doc.toString()).toBe(source);
    expect(view.state.selection.main.anchor).toBe(source.length);
  });
  it("does not rewrite an alias or create history when selecting its current type", () => {
    const view = editor("> [!summary] Title\n> body", 20);
    setCalloutType(view, "abstract");
    expect(view.state.doc.toString()).toContain("[!summary]");
    expect(undoDepth(view.state)).toBe(0);
    expect(editorToolbarState(view.state).callout).toBe("abstract");
  });
  it("selects the innermost callout and preserves all surrounding quote markers", () => {
    const source = "> [!note] Outer\n>\n> > [!tip] Inner\n> > body";
    const view = editor(source, source.length);
    expect(calloutRanges(view.state)).toHaveLength(2);
    setCalloutType(view, "warning");
    expect(view.state.doc.toString()).toBe(source.replace("[!tip]", "[!warning]"));
  });
  it("disables selections spanning separate or nested callouts", () => {
    for (const source of ["> [!note]\n> a\n\n> [!tip]\n> b", "> [!note]\n> a\n> > [!tip]\n> > b"]) {
      const view = editor(source, 0, source.length);
      expect(calloutContext(view.state).enabled).toBe(false);
      setCalloutType(view, "danger");
      expect(view.state.doc.toString()).toBe(source);
    }
  });
  it("does not treat code as callouts or wrap a selection inside a code fence", () => {
    const source = "```md\n> [!note]\n> body\n```";
    const view = editor(source, 15);
    expect(calloutRanges(view.state)).toEqual([]);
    expect(calloutContext(view.state).enabled).toBe(false);
    setCalloutType(view, "tip");
    expect(view.state.doc.toString()).toBe(source);
  });
  it("wraps whole selected lines, excludes the next line, and separates prose", () => {
    const view = editor("before\none\ntwo\nafter", 8, 15);
    setCalloutType(view, "example");
    expect(view.state.doc.toString()).toBe("before\n\n> [!example]\n> one\n> two\n\nafter");
  });
  it("inserts an empty body and puts the caret there, without placeholder content", () => {
    const view = editor("");
    setCalloutType(view, "todo");
    expect(view.state.doc.toString()).toBe("> [!todo]\n> ");
    expect(view.state.selection.main.anchor).toBe(view.state.doc.length);
  });
  it("keeps unknown types unselected and rejects unregistered command inputs", () => {
    const view = editor("> [!custom-type] Title\n> body", 26);
    expect(editorToolbarState(view.state).callout).toBe("custom-type");
    setCalloutType(view, '<script>');
    expect(view.state.doc.toString()).toContain("[!custom-type]");
    setCalloutType(view, "note");
    expect(view.state.doc.toString()).toContain("[!note]");
  });
});
