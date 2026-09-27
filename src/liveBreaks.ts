import {isolateHistory} from "@codemirror/commands";
import {syntaxTree, ensureSyntaxTree} from "@codemirror/language";
import type {SyntaxNode} from "@lezer/common";
import {countColumn} from "@codemirror/state";
import {EditorView, WidgetType} from "@codemirror/view";

export const simpleBreakTag = /^<br[ \t]*\/?[ \t]*>$/i;

// A newly inserted break has no following text yet, so Markdown does not emit HardBreak.
export function trailingLiveBreak(source: string, node: SyntaxNode) {
  if (!["Paragraph", "Task"].includes(node.name) || source[node.to] !== "\n") return null;
  const suffix = source.slice(node.from, node.to).match(/\\+$/)?.[0];
  return suffix && suffix.length % 2 === 1 ? {from: node.to - 1, to: node.to + 1} : null;
}
export class InlineBreakWidget extends WidgetType {
  eq() { return true; }
  get lineBreaks() { return 1; }
  toDOM() { return document.createElement("br"); }
  ignoreEvent() { return false; }
}

// Preserve the list/quote container, but never repeat a task checkbox.
function listContinuationPrefix(view: EditorView, node: SyntaxNode | null): string {
  const original = node;
  while (node && node.name !== "ListItem") node = node.parent;
  const mark = node?.getChild("ListMark");
  if (mark) {
    const first = view.state.doc.lineAt(mark.from);
    const before = view.state.sliceDoc(first.from, mark.from);
    const tail = view.state.sliceDoc(mark.to, first.to).match(/^[ \t]+/)?.[0] ?? " ";
    const width = countColumn(before + view.state.sliceDoc(mark.from, mark.to) + tail, 4) - countColumn(before, 4);
    return before + " ".repeat(width);
  }
  if (!original) return "";
  const first = view.state.doc.lineAt(original.from);
  return view.state.sliceDoc(first.from, original.from).match(/^[ \t]*(?:>[ \t]?)+/)?.[0] ?? "";
}

export function deleteLiveBreak(view: EditorView, backwards: boolean) {
  if (view.state.readOnly || view.composing || view.state.selection.ranges.length !== 1 || !view.state.selection.main.empty) return false;
  const head = view.state.selection.main.head;
  const source = view.state.doc.toString();
  let match: {from: number; to: number} | undefined;
  (ensureSyntaxTree(view.state, head + 1, 50) ?? syntaxTree(view.state)).iterate({
    enter(node) {
      if (["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock", "Table"].includes(node.name)) return false;
      const trailing = trailingLiveBreak(source, node.node);
      if (trailing) {
        const prefix = listContinuationPrefix(view, node.node);
        const to = trailing.to + (prefix && source.startsWith(prefix, trailing.to) ? prefix.length : 0);
        if ((backwards && head === to) || (!backwards && head === trailing.from)) match = {from: trailing.from, to};
      }
      if (node.name !== "HardBreak" && !(node.name === "HTMLTag" && simpleBreakTag.test(source.slice(node.from, node.to)))) return;
      let to = node.to;
      if (node.name === "HardBreak" && source[to] === "\n") to++;
      if (node.name === "HardBreak") {
        const prefix = listContinuationPrefix(view, node.node);
        if (prefix && source.startsWith(prefix, to)) to += prefix.length;
      }
      if ((backwards && head === to) || (!backwards && head === node.from)) match = {from: node.from, to};
    },
  });
  if (!match) return false;
  view.dispatch({changes: {...match, insert: ""}, selection: {anchor: match.from}, annotations: isolateHistory.of("full"), userEvent: "delete"});
  return true;
}

export function insertLiveBreak(view: EditorView) {
  if (view.state.readOnly || view.composing || view.state.selection.ranges.length !== 1) return false;
  const {from, to} = view.state.selection.main;
  const tree = ensureSyntaxTree(view.state, to, 50) ?? syntaxTree(view.state);
  let paragraph = false;
  let item: SyntaxNode | null = null;
  for (let node = tree.resolveInner(from, from === view.state.doc.lineAt(from).from ? 1 : -1); node; node = node.parent!) {
    if (["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock", "Table"].includes(node.name)) return false;
    if (node.name === "ListItem" && !item) item = node;
    if (["Paragraph", "Task"].includes(node.name) && to <= node.to) paragraph = true;
  }
  if (!paragraph) return false;
  const prefix = listContinuationPrefix(view, item ?? tree.resolveInner(from, from === view.state.doc.lineAt(from).from ? 1 : -1));
  const insert = "\\\n" + prefix;
  view.dispatch({changes: {from, to, insert}, selection: {anchor: from + insert.length}, annotations: isolateHistory.of("full"), userEvent: "input"});
  return true;
}
