import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, type Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { parseCalloutHeader, resolveCallout, calloutTypes } from "./callouts";
import { dispatchSourcePatches } from "./editorPatches";
import { analyzeSource } from "./sourceAnalysis";

export type CalloutRange = NonNullable<ReturnType<typeof parseCalloutHeader>> & {
  from: number; to: number; headerFrom: number; headerTo: number; typeFrom: number; typeTo: number;
};
const cache = new WeakMap<EditorState, CalloutRange[]>();
const documentKeys = new WeakMap<Text, number>();
let nextDocumentKey = 0;
export function calloutContextKey(state: EditorState) {
  if (!documentKeys.has(state.doc)) documentKeys.set(state.doc, ++nextDocumentKey);
  return `${documentKeys.get(state.doc)}:${state.selection.ranges.map(r => `${r.anchor},${r.head}`).join(";")}`;
}

export function calloutRanges(state: EditorState): CalloutRange[] {
  const cached = cache.get(state);
  if (cached) return cached;
  const result: CalloutRange[] = [];
  // Most notes contain no callouts. Do not force a complete Markdown parse of
  // a large document just to calculate the toolbar's Callout state.
  if (!analyzeSource(state.doc).source.includes("[!")) {
    cache.set(state, result);
    return result;
  }
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  tree.iterate({ enter(node) {
    if (node.name !== "Blockquote") return;
    const first = node.node.firstChild?.nextSibling;
    if (first?.name !== "Paragraph") return;
    const line = state.doc.lineAt(first.from);
    const header = parseCalloutHeader(state.sliceDoc(first.from, line.to));
    if (!header) return;
    result.push({ ...header, from: node.from, to: node.to, headerFrom: first.from, headerTo: line.to,
      typeFrom: first.from + 2, typeTo: first.from + 2 + header.rawType.length });
  }});
  cache.set(state, result);
  return result;
}

export function calloutContext(state: EditorState) {
  const selection = state.selection.main;
  const ranges = calloutRanges(state);
  const containing = ranges.filter(r => selection.from >= r.from && selection.to <= r.to)
    .sort((a, b) => (a.to - a.from) - (b.to - b.from));
  const target = containing[0] ?? null;
  const overlaps = ranges.filter(r => selection.empty
    ? selection.from >= r.from && selection.from <= r.to
    : selection.from < r.to && selection.to > r.from);
  let enabled = state.selection.ranges.length === 1;
  // A large, not-yet-parsed document must not accidentally wrap a code block.
  const selectionTree = ensureSyntaxTree(state, Math.min(state.doc.length, selection.to + 1), 50);
  if (!selectionTree) return {target, enabled: false};
  if (target) {
    // A selection crossing a nested boundary is not a batch-conversion command.
    enabled &&= !overlaps.some(r => r !== target && r.from > target.from);
  } else {
    enabled &&= overlaps.length === 0;
    selectionTree.iterate({
      from: selection.from, to: selection.to,
      enter(node) {
        if (["FencedCode", "CodeBlock", "Blockquote"].includes(node.name)) enabled = false;
      },
    });
  }
  return { target, enabled };
}

export function setCalloutType(editor: EditorView, requested: string) {
  const definition = calloutTypes.find(type => type.id === requested);
  if (!definition) return;
  const { target, enabled } = calloutContext(editor.state);
  if (!enabled) return;
  if (target) {
    if (resolveCallout(target.type).id === requested && calloutTypes.some(t => t.id === target.type || t.aliases.includes(target.type))) return;
    // Change exactly the identifier, preserving title, rich body, quote depth and fold marker.
    dispatchSourcePatches(editor, [{from: target.typeFrom, to: target.typeTo,
      insert: requested, expected: target.rawType}], {isolateHistory: true, scrollIntoView: true});
  } else {
    const selection = editor.state.selection.main;
    const first = editor.state.doc.lineAt(selection.from);
    const last = editor.state.doc.lineAt(selection.empty ? selection.to : selection.to - 1);
    const source = editor.state.sliceDoc(first.from, last.to);
    const body = source.split("\n").map(line => `> ${line}`).join("\n");
    const leading = first.number > 1 && editor.state.doc.line(first.number - 1).text.trim() ? "\n" : "";
    const trailing = last.number < editor.state.doc.lines && editor.state.doc.line(last.number + 1).text.trim() ? "\n" : "";
    const prefix = `${leading}> [!${requested}]\n`;
    dispatchSourcePatches(editor, [{from: first.from, to: last.to,
      insert: `${prefix}${body}${trailing}`, expected: source}], {
      selection: {anchor: first.from + prefix.length + 2}, isolateHistory: true, scrollIntoView: true,
    });
  }
  editor.focus();
}
