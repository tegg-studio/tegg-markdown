import {ensureSyntaxTree, syntaxTree} from "@codemirror/language";
import type {EditorState} from "@codemirror/state";
import type {SyntaxNode} from "@lezer/common";

/** A source-derived command target. Offsets are CodeMirror UTF-16 positions. */
export type BlockContext = {
  lineFrom: number;
  lineTo: number;
  contentFrom: number;
  containerPrefix: string;
  continuationPrefix: string;
  containers: readonly ("quote" | "list" | "callout")[];
  listItemFrom: number | null;
  protectedBlock: boolean;
};

export function blockContext(state: EditorState, position: number): BlockContext {
  const line = state.doc.lineAt(Math.max(0, Math.min(position, state.doc.length)));
  const tree = ensureSyntaxTree(state, line.to, 100) ?? syntaxTree(state);
  const nodes: SyntaxNode[] = [];
  for (let node: SyntaxNode | null = tree.resolveInner(Math.min(position, line.to), -1); node; node = node.parent) nodes.push(node);
  const protectedBlock = nodes.some(node => ["FencedCode", "CodeBlock", "HTMLBlock", "Table"].includes(node.name));
  const containers: ("quote" | "list" | "callout")[] = [];
  let prefix = "", continuation = "", offset = 0;
  const raw = line.text;
  // Quote markers are source spelling. List ownership comes from the parser so
  // continuation paragraphs retain their parent item even without a list mark.
  while (offset < raw.length) {
    const quote = raw.slice(offset).match(/^( {0,3}>[ \t]?)/);
    if (quote) {
      prefix += quote[1]; continuation += quote[1]; offset += quote[1].length;
      containers.push("quote");
      continue;
    }
    break;
  }
  const item = nodes.find(node => node.name === "ListItem");
  const mark = item?.getChild("ListMark");
  if (mark) {
    const markerLine = state.doc.lineAt(mark.from);
    let column = mark.to - markerLine.from;
    while (/[ \t]/.test(state.sliceDoc(markerLine.from + column, markerLine.from + column + 1)) && markerLine.from + column < markerLine.to) column++;
    containers.push("list");
    const explicit = raw.slice(offset).match(/^( {0,3}(?:[-+*]|\d+[.)])[ \t]+)/);
    if (explicit) {
      prefix += explicit[1]; offset += explicit[1].length;
      const task = raw.slice(offset).match(/^\[[ xX]\][ \t]+/);
      if (task) {prefix += task[0]; offset += task[0].length;}
    } else {
      const indentation = Math.min(Math.max(0, column - offset), raw.slice(offset).match(/^[ \t]*/)?.[0].length ?? 0);
      prefix += raw.slice(offset, offset + indentation); offset += indentation;
    }
    continuation += " ".repeat(Math.max(0, column - continuation.length));
  } else {
    const explicit = raw.slice(offset).match(/^( {0,3}(?:[-+*]|\d+[.)])[ \t]+)/);
    if (explicit) {
      prefix += explicit[1]; offset += explicit[1].length;
      continuation += " ".repeat(explicit[1].length);
      containers.push("list");
      const task = raw.slice(offset).match(/^\[[ xX]\][ \t]+/);
      if (task) {prefix += task[0]; offset += task[0].length;}
    }
  }
  while (offset < raw.length) {
    const nestedQuote = raw.slice(offset).match(/^( {0,3}>[ \t]?)/);
    if (!nestedQuote) break;
    prefix += nestedQuote[1]; continuation += nestedQuote[1]; offset += nestedQuote[1].length;
    containers.push("quote");
  }
  if (containers.includes("quote") && /^\[![A-Za-z]+\]/.test(raw.slice(offset))) containers.push("callout");
  return {lineFrom: line.from, lineTo: line.to, contentFrom: line.from + offset,
    containerPrefix: prefix, continuationPrefix: continuation, containers, listItemFrom: item?.from ?? null, protectedBlock};
}
