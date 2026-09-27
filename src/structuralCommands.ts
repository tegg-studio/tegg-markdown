import type {EditorState} from "@codemirror/state";
import {ensureSyntaxTree, syntaxTree} from "@codemirror/language";
import type {SyntaxNode} from "@lezer/common";
import type {SourcePatch, SourceRange} from "./sourcePatch";
import {blockContext} from "./blockContext";

export type StructuralPlan = {
  patches: SourcePatch[];
  selection: {anchor: number; head?: number};
  focus: "body" | "code";
};

function safeFence(markdown: string) {
  const match = markdown.match(/^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\1[ \t]*$/);
  if (!match) return markdown;
  const body = match[3];
  const marker = match[1][0];
  const longest = Math.max(0, ...[...body.matchAll(new RegExp(`${marker === "`" ? "`" : "~"}+`, "g"))].map(item => item[0].length));
  const fence = marker.repeat(Math.max(3, longest + 1, match[1].length));
  return `${fence}${match[2]}\n${body}\n${fence}`;
}

/** Plan a Live Edit block insertion without changing text outside the touched lines. */
export function planStructuralInsert(state: EditorState, range: SourceRange, markdown: string, kind: "code" | "block" = "block"): StructuralPlan | null {
  if (range.from < 0 || range.to < range.from || range.to > state.doc.length) return null;
  const start = blockContext(state, range.from);
  const end = blockContext(state, range.to);
  if (start.protectedBlock || end.protectedBlock) return null;
  const original = state.sliceDoc(start.lineFrom, end.lineTo);
  const before = state.sliceDoc(start.contentFrom, range.from);
  const after = state.sliceDoc(range.to, end.lineTo);
  // An incomplete container marker or crossing into another item has no safe
  // structural interpretation. Keep the draft intact and let the caller report it.
  const sameListItem = start.listItemFrom !== null && start.listItemFrom === end.listItemFrom;
  if (range.from < start.contentFrom || (range.to > start.lineTo && !sameListItem && end.containerPrefix !== start.containerPrefix)) return null;
  const body = safeFence(markdown.replace(/\r\n/g, "\n"));
  const lines = body.split("\n");
  const continuation = start.continuationPrefix;
  const blank = start.containers.includes("list") ? continuation : continuation.trimEnd();
  const output: string[] = [];
  const emptyTask = !before.length && /\[[ xX]\][ \t]+$/.test(start.containerPrefix);
  if (before.length) {
    output.push(state.sliceDoc(start.lineFrom, range.from));
    output.push(blank);
  } else if (emptyTask) {
    output.push(start.containerPrefix.trimEnd());
  }
  const firstPrefix = before.length || emptyTask ? continuation : start.containerPrefix;
  const blockStart = output.join("\n").length + (output.length ? 1 : 0) + firstPrefix.length;
  output.push(firstPrefix + lines[0]);
  for (const line of lines.slice(1)) output.push(continuation + line);
  if (after.length) {
    output.push(blank);
    output.push(continuation + after);
  }
  const insert = output.join("\n");
  const bodyOffset = kind === "code" ? body.indexOf("\n") + 1 : body.length;
  const anchor = start.lineFrom + blockStart + (kind === "code" && bodyOffset > 0
    ? lines[0].length + 1 + continuation.length : bodyOffset);
  return {patches: [{from: start.lineFrom, to: end.lineTo, expected: original, insert}],
    selection: {anchor}, focus: kind === "code" ? "code" : "body"};
}

/** Preserve enclosing list and quote markers when changing a paragraph style. */
export function planHeadingTransform(state: EditorState, range: SourceRange, level: number): StructuralPlan | null {
  if (!Number.isInteger(level) || level < 0 || level > 6) return null;
  const start = state.doc.lineAt(range.from), last = state.doc.lineAt(Math.max(range.from, range.to - 1));
  const patches: SourcePatch[] = [];
  for (let number = start.number; number <= last.number; number++) {
    const line = state.doc.line(number), context = blockContext(state, line.to);
    if (context.protectedBlock) continue;
    const content = state.sliceDoc(context.contentFrom, line.to);
    const heading = content.match(/^#{1,6}(?:[ \t]+|$)/);
    const from = context.contentFrom, to = from + (heading?.[0].length ?? 0);
    const insert = level ? `${"#".repeat(level)} ` : "";
    const expected = state.sliceDoc(from, to);
    if (expected !== insert) patches.push({from, to, expected, insert});
  }
  if (!patches.length) return null;
  const selected = state.selection.main;
  const map = (position: number) => patches.reduce((next, patch) => next + (position > patch.to ? patch.insert.length - (patch.to - patch.from) : position >= patch.from ? patch.insert.length - Math.min(position - patch.from, patch.to - patch.from) : 0), position);
  return {patches, selection: {anchor: map(selected.anchor), head: map(selected.head)}, focus: "body"};
}

/** Move one parsed logical block among siblings, including its nested content. */
export function planMoveBlock(state: EditorState, position: number, direction: "up" | "down"): StructuralPlan | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const nodes: SyntaxNode[] = [];
  for (let node: SyntaxNode | null = tree.resolveInner(Math.max(0, Math.min(position, state.doc.length)), -1); node; node = node.parent) nodes.push(node);
  const item = nodes.find(node => node.name === "ListItem");
  const block = item ?? nodes.find(node => node.parent?.name === "Document" && node.name !== "Document");
  if (!block) return null;
  const sibling = direction === "up" ? block.prevSibling : block.nextSibling;
  if (!sibling || sibling.parent?.name !== block.parent?.name) return null;
  const first = direction === "up" ? sibling : block;
  const second = direction === "up" ? block : sibling;
  const middle = state.sliceDoc(first.to, second.from);
  const expected = state.sliceDoc(first.from, second.to);
  const insert = state.sliceDoc(second.from, second.to) + middle + state.sliceDoc(first.from, first.to);
  const selected = state.selection.main;
  const movedTo = direction === "up" ? first.from : first.from + state.sliceDoc(second.from, second.to).length + middle.length;
  const anchor = movedTo + Math.max(0, Math.min(selected.anchor - block.from, block.to - block.from));
  return {patches: [{from: first.from, to: second.to, expected, insert}], selection: {anchor}, focus: "body"};
}

/** Wrap a complete source block in a quote, preserving its internal list syntax. */
export function planWrapQuote(state: EditorState, position: number): StructuralPlan | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const nodes: SyntaxNode[] = [];
  for (let node: SyntaxNode | null = tree.resolveInner(Math.max(0, Math.min(position, state.doc.length)), -1); node; node = node.parent) nodes.push(node);
  if (nodes.some(node => ["FencedCode", "CodeBlock", "HTMLBlock", "Table", "Blockquote"].includes(node.name))) return null;
  // Quoting one item would split its siblings into separate lists. Wrap the
  // outer list as one logical structure when the target is anywhere inside it.
  const list = nodes.filter(node => node.name === "BulletList" || node.name === "OrderedList").at(-1);
  const block = list ?? nodes.find(node => node.parent?.name === "Document" && node.name !== "Document");
  if (!block) return null;
  const from = state.doc.lineAt(block.from).from, to = state.doc.lineAt(block.to).to;
  const expected = state.sliceDoc(from, to);
  const insert = expected.split("\n").map(line => "> " + line).join("\n");
  return {patches: [{from, to, expected, insert}], selection: {anchor: position + 2}, focus: "body"};
}
