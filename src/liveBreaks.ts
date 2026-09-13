import {syntaxTree, ensureSyntaxTree} from "@codemirror/language";
import type {SyntaxNode} from "@lezer/common";
import {EditorView, WidgetType} from "@codemirror/view";

export const simpleBreakTag = /^<br[ \t]*\/?[ \t]*>$/i;

// A newly inserted break has no following text yet, so Markdown does not emit HardBreak.
export function trailingLiveBreak(source: string, node: SyntaxNode) {
  if (node.name !== "Paragraph" || source[node.to] !== "\n") return null;
  const suffix = source.slice(node.from, node.to).match(/\\+$/)?.[0];
  return suffix && suffix.length % 2 === 1 ? {from: node.to - 1, to: node.to + 1} : null;
}
export class InlineBreakWidget extends WidgetType {
  eq() { return true; }
  get lineBreaks() { return 1; }
  toDOM() { return document.createElement("br"); }
  ignoreEvent() { return false; }
}

export function deleteLiveBreak(view: EditorView, backwards: boolean) {
  if (view.composing || view.state.selection.ranges.length !== 1 || !view.state.selection.main.empty) return false;
  const head = view.state.selection.main.head;
  const source = view.state.doc.toString();
  let match: {from: number; to: number} | undefined;
  (ensureSyntaxTree(view.state, head + 1, 50) ?? syntaxTree(view.state)).iterate({
    enter(node) {
      if (["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock", "Table"].includes(node.name)) return false;
      const trailing = trailingLiveBreak(source, node.node);
      if (trailing && ((backwards && head === trailing.to) || (!backwards && head === trailing.from))) match = trailing;
      if (node.name !== "HardBreak" && !(node.name === "HTMLTag" && simpleBreakTag.test(source.slice(node.from, node.to)))) return;
      let to = node.to;
      if (node.name === "HardBreak" && source[to] === "\n") to++;
      if ((backwards && head === to) || (!backwards && head === node.from)) match = {from: node.from, to};
    },
  });
  if (!match) return false;
  view.dispatch({changes: {...match, insert: ""}, selection: {anchor: match.from}, userEvent: "delete"});
  return true;
}

export function insertLiveBreak(view: EditorView) {
  if (view.composing || view.state.selection.ranges.length !== 1) return false;
  const {from, to} = view.state.selection.main;
  const tree = ensureSyntaxTree(view.state, to, 50) ?? syntaxTree(view.state);
  let paragraph = false;
  for (let node = tree.resolveInner(from, from === view.state.doc.lineAt(from).from ? 1 : -1); node; node = node.parent!) {
    if (["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock", "Table", "ListItem", "Blockquote"].includes(node.name)) return false;
    if (node.name === "Paragraph" && to <= node.to) paragraph = true;
  }
  if (!paragraph) return false;
  view.dispatch({changes: {from, to, insert: "\\\n"}, selection: {anchor: from + 2}, userEvent: "input"});
  return true;
}
