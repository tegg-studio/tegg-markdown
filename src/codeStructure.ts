import {EditorState, EditorSelection, ChangeSet} from "@codemirror/state";
import {syntaxTree, ensureSyntaxTree} from "@codemirror/language";
import {isolateHistory} from "@codemirror/commands";
import type {EditorView} from "@codemirror/view";
import type {SyntaxNode} from "@lezer/common";
import {restoreSelection} from "./selectionHistory";
import {readCode, unwrapCodeContainer, fenceCode} from "./codeEditing";

/** Only blocks whose structural prefixes can be separated losslessly are widgets. */
export function codeSource(state: EditorState, node: SyntaxNode) {
  const line = state.doc.lineAt(node.from);
  const before = state.sliceDoc(line.from, node.from);
  if (!/^[ \t>]*$/.test(before)) return null;
  const prefix = node.name === "CodeBlock" ? before.endsWith("    ") ? before.slice(0, -4) : null : before;
  if (prefix === null) return null;
  const raw = state.sliceDoc(line.from, node.to);
  if (prefix && !raw.split("\n").every(row => /^ +$/.test(prefix) || row.startsWith(prefix) || !row.trim() || row === prefix.trimEnd())) return null;
  return {from: line.from, to: node.to, prefix, raw, plain: unwrapCodeContainer(raw, prefix)};
}

// Source mode does not install this filter. Only external whitespace deletion
// qualifies (including empty quote-line prefixes): replacing code, deleting
// a block, typing and undo remain literal.
export const preserveCodeStructure = EditorState.transactionFilter.of(tr => {
  if (!tr.docChanged || tr.startState.readOnly || !tr.isUserEvent("delete")) return tr;
  const deletions: {from: number; to: number}[] = [];
  let whitespaceOnly = true;
  tr.changes.iterChanges((from, to, _a, _b, insert) => {
    if (insert.length || !/^[ \t\r\n>]*$/.test(tr.startState.sliceDoc(from, to))) whitespaceOnly = false;
    deletions.push({from, to});
  });
  if (!whitespaceOnly || !deletions.length) return tr;
  const tree = ensureSyntaxTree(tr.startState, tr.startState.doc.length, 50) ?? syntaxTree(tr.startState);
  let touchingBlock = false;
  const removedQuoteLines = new Set<number>();
  const patches: {from: number; to: number; insert: string}[] = [];
  tree.iterate({enter(ref) {
    if (!["CodeBlock", "FencedCode"].includes(ref.name)) return;
    const block = codeSource(tr.startState, ref.node);
    if (!block || deletions.some(d => d.from < block.to && d.to > block.from)) return false;
    const from = tr.changes.mapPos(block.from, 1), to = tr.changes.mapPos(block.to, -1);
    // Ignore distant edits; only the gap directly touching a block is relevant.
    const adjacent = deletions.some(d => d.to <= block.from && /^[ \t\n>]*$/.test(tr.startState.sliceDoc(d.to, block.from)) || d.from >= block.to && /^[ \t\n>]*$/.test(tr.startState.sliceDoc(block.to, d.from)));
    if (!adjacent) return false;
    touchingBlock = true;
    // Deleting the newline before an empty quote row must not leave its >
    // attached to the preceding paragraph as visible text.
    for (const deletion of deletions) {
      const row = tr.startState.doc.lineAt(deletion.to);
      if (row.from > deletion.from && row.to < block.from && row.text.includes(">") &&
          /^[ \t>]+$/.test(row.text) && !removedQuoteLines.has(row.from)) {
        const start = tr.changes.mapPos(row.from, 1), end = tr.changes.mapPos(row.to, -1);
        if (end > start) patches.push({from: start, to: end, insert: ""});
        removedQuoteLines.add(row.from);
      }
    }
    const before = tr.newDoc.sliceString(tr.newDoc.lineAt(from).from, from);
    const after = tr.newDoc.sliceString(to, tr.newDoc.lineAt(to).to);
    let next = block.raw;
    if (ref.name === "CodeBlock") {
      // Indented code cannot interrupt a paragraph. Convert only when deleting
      // its separator, rather than silently changing documents on load.
      const prior = tr.newDoc.lineAt(from);
      const previous = prior.number > 1 ? tr.newDoc.line(prior.number - 1).text : "";
      if (before.trim() || previous.replace(/^[ \t>]*$/, "").trim()) {
        next = fenceCode(readCode(block.plain).body).split("\n").map(row => block.prefix + row).join("\n");
      }
    }
    if (before.length) next = "\n" + next;
    if (after.length) next += "\n";
    if (next !== block.raw) patches.push({from, to, insert: next});
    return false;
  }});
  if (!touchingBlock) return tr;
  // Keep the cursor outside the rewritten block. Both changes are one undo unit.
  const follow = ChangeSet.of(patches, tr.newDoc.length);
  const selection = tr.newSelection.map(follow, -1);
  return [tr, {changes: patches, selection, sequential: true,
    effects: restoreSelection.of(selection), annotations: isolateHistory.of("full")}];
});

/** A code widget is selected as a whole before deleting it from outside. */
export function selectCodeBoundary(view: EditorView, backwards: boolean) {
  const {state} = view;
  if (state.readOnly || view.composing || !state.selection.main.empty || state.selection.ranges.length !== 1) return false;
  const head = state.selection.main.head;
  let range: {from: number; to: number} | undefined;
  (ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state)).iterate({enter(ref) {
    if (!["CodeBlock", "FencedCode"].includes(ref.name)) return;
    const block = codeSource(state, ref.node);
    if (block && (backwards ? head === block.to : head === block.from)) range = block;
    return false;
  }});
  if (!range) return false;
  view.dispatch({selection: EditorSelection.range(range.from, range.to)});
  return true;
}
