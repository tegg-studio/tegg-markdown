import {scriptFormatting} from "./scriptFormatting";
import {markdownParser} from "./markdownParser";
import {ensureSyntaxTree, syntaxTree} from '@codemirror/language';
import type {EditorState, Text} from '@codemirror/state';
import {inlineHtmlFormatting} from './inlineHtml';
import {analyzeSource} from './sourceAnalysis';

export const selectionFormats = ['bold', 'italic', 'underline', 'strike', 'highlight', 'subscript', 'superscript'] as const;
type Format = typeof selectionFormats[number];
type Pair = {from: number; start: number; end: number; to: number; format: Format};
const nodes: Record<string, Format> = {StrongEmphasis: 'bold', Emphasis: 'italic', Strikethrough: 'strike'};
const htmlFormats: Record<string, Format> = {strong: 'bold', em: 'italic', s: 'strike', del: 'strike', u: 'underline', mark: 'highlight', sub: 'subscript', sup: 'superscript'};
const htmlWrappers: Record<Format, [string, string]> = {bold: ['<strong>', '</strong>'], italic: ['<em>', '</em>'], strike: ['<del>', '</del>'], underline: ['<u>', '</u>'], highlight: ['<mark>', '</mark>'], subscript: ['<sub>', '</sub>'], superscript: ['<sup>', '</sup>']};
const wrappers: Record<Format, [string, string]> = {bold: ['**', '**'], italic: ['*', '*'], underline: ['<u>', '</u>'], strike: ['~~', '~~'], highlight: ['==', '=='], subscript: ['<sub>', '</sub>'], superscript: ['<sup>', '</sup>']};

function analyzeFormatting(state: EditorState) {
  const source = state.doc.toString(), pairs: Pair[] = [];
  const opaque: {from: number; to: number; block: boolean}[] = [];
  const structural: {from: number; to: number}[] = [];
  const blocks: {from: number; to: number}[] = [];
  const atoms: {from: number; to: number}[] = [];
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  tree.iterate({enter(node) {
    if (['InlineCode', 'FencedCode', 'CodeBlock', 'HTMLBlock', 'Table'].includes(node.name)) {
      opaque.push({from: node.from, to: node.to, block: node.name !== "InlineCode"}); return false;
    }
    if (node.name === "Paragraph" || /^(ATX|Setext)Heading[1-6]$/.test(node.name)) blocks.push({from: node.from, to: node.to});
    if (["Escape", "Entity"].includes(node.name)) atoms.push({from: node.from, to: node.to});
    if (["HeaderMark", "QuoteMark", "ListMark", "LinkMark", "URL", "LinkTitle", "HTMLTag"].includes(node.name)) structural.push({from: node.from, to: node.to});
    const format = nodes[node.name], first = node.node.firstChild, last = node.node.lastChild;
    if (format && first && last) pairs.push({from: node.from, start: first.to, end: last.from, to: node.to, format});
  }});
  const analysis = analyzeSource(state.doc);
  for (const wiki of analysis.wikiLinks) opaque.push({from: wiki.from, to: wiki.to, block: true});
  if (analysis.frontmatter.to > 0) opaque.push({from: 0, to: analysis.frontmatter.to, block: true});
  for (const pair of [...inlineHtmlFormatting(state).pairs, ...scriptFormatting(state)]) pairs.push({from: pair.from, start: pair.contentFrom, end: pair.contentTo, to: pair.to, format: htmlFormats[pair.tag]});
  for (const pair of analysis.highlights) if (pair.from >= analysis.frontmatter.to && !opaque.some(range => pair.from >= range.from && pair.from < range.to || pair.to - 1 >= range.from && pair.to - 1 < range.to) && !structural.some(range => pair.from >= range.from && pair.from < range.to || pair.to - 1 >= range.from && pair.to - 1 < range.to)) {
    pairs.push({from: pair.from, start: pair.contentFrom, end: pair.contentTo, to: pair.to, format: 'highlight'});
  }
  const hiddenBits = new Uint8Array(source.length), styleBits = new Uint8Array(source.length), structuralBits = new Uint8Array(source.length);
  for (const pair of pairs) {
    hiddenBits.fill(1, pair.from, pair.start); hiddenBits.fill(1, pair.end, pair.to);
    const bit = 1 << selectionFormats.indexOf(pair.format);
    for (let p = pair.start; p < pair.end; p++) styleBits[p] |= bit;
  }
  for (const range of structural) structuralBits.fill(1, range.from, range.to);
  const hidden = (p: number) => hiddenBits[p] === 1;
  const formats = (p: number) => selectionFormats.filter((_, i) => styleBits[p] & (1 << i));
  return {source, pairs, hidden, formats, opaque, structural, atoms, blocks, structuralBits};
}
const documentModels = new WeakMap<Text, {tree: ReturnType<typeof syntaxTree>; data: ReturnType<typeof analyzeFormatting>}>();
export function selectionFormatting(state: EditorState) {
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  let cached = documentModels.get(state.doc);
  if (!cached || cached.tree !== tree) {
    cached = {tree, data: analyzeFormatting(state)};
    documentModels.set(state.doc, cached);
  }
  const data = cached.data;
  const {source, hidden, formats, structuralBits} = data;
  const {from, to} = state.selection.main;
  const visible: number[] = [];
  for (let p = from; p < to; p++) if (!hidden(p) && !structuralBits[p] && !/\s/.test(source[p])) visible.push(p);
  const counts = Object.fromEntries(selectionFormats.map(format => [format, 0])) as Record<Format, number>;
  for (const p of visible) for (const format of formats(p)) counts[format]++;
  const status = (format: Format): 'off' | 'mixed' | 'on' => {
    const count = counts[format];
    return count === 0 ? 'off' : count === visible.length ? 'on' : 'mixed';
  };
  return {...data, status, visible};
}

/** Normalize intersecting inline blocks, then patch only their changed delimiters. */
export function formatSelection(state: EditorState, format: Format) {
  const data = selectionFormatting(state), selected = state.selection.main;
  let from = selected.from, to = selected.to;
  if (from === to) return null;
  if (!data.visible.length) return {patch: {from, to, insert: data.source.slice(from, to), expected: data.source.slice(from, to)}, selection: {anchor: selected.anchor, head: selected.head}};
  // Never rewrite code contents or a partly selected code span.
  if (data.opaque.some(range => range.from < to && range.to > from && (range.block || from > range.from || to < range.to))) {
    return {patch: {from, to, insert: data.source.slice(from, to), expected: data.source.slice(from, to)}, selection: {anchor: selected.anchor, head: selected.head}};
  }
  let selectedFrom = selected.from, selectedTo = selected.to;
  for (const atom of data.atoms) if (atom.from < selectedTo && atom.to > selectedFrom) {
    selectedFrom = Math.min(selectedFrom, atom.from); selectedTo = Math.max(selectedTo, atom.to);
  }
  from = selectedFrom; to = selectedTo;
  for (const block of data.blocks) if (block.from < to && block.to > from) {
    from = Math.min(from, block.from); to = Math.max(to, block.to);
  }
  const relevant = new Set<Pair>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const pair of data.pairs) if (pair.from < to && pair.to > from && !relevant.has(pair)) {
      relevant.add(pair); from = Math.min(from, pair.from); to = Math.max(to, pair.to); changed = true;
    }
  }
  const apply = data.status(format) !== 'on';
  const units: {text: string; pos: number; marks: Format[]}[] = [];
  const atomAt = new Map([...data.opaque, ...data.atoms].map(atom => [atom.from, atom]));
  for (let p = from; p < to; p++) {
    if (data.hidden(p)) continue;
    let marks = data.formats(p);
    if (p >= selectedFrom && p < selectedTo) marks = selectionFormats.filter(mark => mark === format ? apply : marks.includes(mark) && !(apply && (format === "subscript" && mark === "superscript" || format === "superscript" && mark === "subscript")));
    if (data.source[p] === '\n' || data.structuralBits[p]) marks = [];
    const atom = atomAt.get(p);
    units.push({text: data.source.slice(p, atom?.to ?? p + 1), pos: p, marks});
    if (atom) p = atom.to - 1;
  }
  // Markdown delimiters cannot enclose leading or trailing whitespace.
  for (const mark of selectionFormats) {
    let i = 0;
    while (i < units.length) {
      if (!units[i].marks.includes(mark)) { i++; continue; }
      const start = i;
      while (i < units.length && units[i].marks.includes(mark)) i++;
      let a = start, b = i;
      while (a < b && /^\s+$/.test(units[a].text)) { units[a].marks = units[a].marks.filter(m => m !== mark); a++; }
      while (b > a && /^\s+$/.test(units[b - 1].text)) { b--; units[b].marks = units[b].marks.filter(m => m !== mark); }
    }
  }
  const encode = (delimiters: Record<Format, [string, string]>) => {
    let insert = '', stack: Format[] = [];
    const positions: number[] = [];
    let selectionFrom: number | undefined, selectionTo: number | undefined;
    for (const unit of units) {
      // Retain surviving outer formats instead of repeatedly closing/reopening them.
      const desired = [...stack.filter(mark => unit.marks.includes(mark)), ...unit.marks.filter(mark => !stack.includes(mark))];
      let common = 0;
      while (common < stack.length && stack[common] === desired[common]) common++;
      for (let i = stack.length - 1; i >= common; i--) insert += delimiters[stack[i]][1];
      for (let i = common; i < desired.length; i++) insert += delimiters[desired[i]][0];
      stack = desired;
      if (unit.pos >= selectedFrom && unit.pos < selectedTo) {
        selectionFrom ??= from + insert.length;
        selectionTo = from + insert.length + unit.text.length;
      }
      positions.push(insert.length);
      insert += unit.text;
    }
    for (let i = stack.length - 1; i >= 0; i--) insert += delimiters[stack[i]][1];
    const a = selectionFrom ?? from, b = selectionTo ?? a;
    // Keep visible source units in place. Only delimiters change, so history can
    // map the selection through repeated Undo/Redo without selecting the whole block.
    const patches: {from: number; to: number; insert: string; expected: string}[] = [];
    let oldEnd = from, newEnd = 0;
    const gap = (oldTo: number, newTo: number) => {
      const expected = data.source.slice(oldEnd, oldTo), replacement = insert.slice(newEnd, newTo);
      if (expected !== replacement) patches.push({from: oldEnd, to: oldTo, insert: replacement, expected});
    };
    for (let i = 0; i < units.length; i++) {
      gap(units[i].pos, positions[i]);
      oldEnd = units[i].pos + units[i].text.length; newEnd = positions[i] + units[i].text.length;
    }
    gap(to, insert.length);
    return {patch: {from, to, insert, expected: data.source.slice(from, to)}, patches, selection: selected.anchor > selected.head ? {anchor: b, head: a} : {anchor: a, head: b}};
  };
  // Compare Reader semantics too: CommonMark delimiter rules can differ from Lezer.
  const signature = (raw: string, inherited: Format[] = []) => {
    const result: string[] = [], active = [...inherited];
    const add = (text: string) => { for (const ch of text) if (!/\s/.test(ch)) result.push(ch + ':' + [...new Set(active)].sort().join(',')); };
    const visit = (tokens: ReturnType<typeof markdownParser.parse>) => {
      for (const token of tokens) {
        if (token.children) { visit(token.children); continue; }
        const tag = htmlFormats[token.tag];
        if (tag && token.nesting === 1) active.push(tag);
        else if (tag && token.nesting === -1) { const i = active.lastIndexOf(tag); if (i >= 0) active.splice(i, 1); }
        else if (token.type === 'html_inline') {
          const match = token.content.match(/^<(\/)?(strong|em|del|s|u|mark|sub|sup)>$/i);
          if (match) {
            const format = match[2].toLowerCase() === 's' ? 'strike' : htmlFormats[match[2].toLowerCase()];
            if (!match[1]) active.push(format);
            else { const i = active.lastIndexOf(format); if (i >= 0) active.splice(i, 1); }
          }
        } else if (token.type === 'text' || token.type === 'code_inline') add(token.content);
      }
    };
    visit(markdownParser.parse(raw, {}));
    return result;
  };
  const expectedReader = units.flatMap(unit => data.structuralBits[unit.pos] ? [] : unit.text.length === 1 ? (/\s/.test(unit.text) ? [] : [unit.text + ':' + [...unit.marks].sort().join(',')]) : signature(unit.text, unit.marks)).join('\0');
  const expected = units.flatMap(unit => Array.from({length: unit.text.length}, (_, i) => ({text: unit.text[i], marks: unit.marks})))
    .map(unit => unit.text + ':' + [...unit.marks].sort().join(',')).join('\0');
  const valid = (result: ReturnType<typeof encode>) => {
    const next = state.update({changes: result.patch, selection: result.selection}).state;
    const parsed = selectionFormatting(next);
    const end = from + result.patch.insert.length;
    const actual: string[] = [];
    for (let p = from; p < end; p++) {
      if (parsed.hidden(p)) continue;
      const marks = parsed.source[p] === '\n' || parsed.structuralBits[p] ? [] : parsed.formats(p);
      actual.push(parsed.source[p] + ':' + marks.sort().join(','));
    }
    return actual.join('\0') === expected && signature(result.patch.insert).join('\0') === expectedReader;
  };
  const markdown = encode(wrappers);
  if (valid(markdown)) return markdown;
  // Crossed runs can require adjacent delimiters whose Markdown meaning differs.
  // Balanced simple HTML is an unambiguous fallback, still editable as inline text.
  const html = encode(htmlWrappers);
  if (valid(html)) return html;
  return {patch: {from: selected.from, to: selected.to, insert: state.sliceDoc(selected.from, selected.to), expected: state.sliceDoc(selected.from, selected.to)}, selection: {anchor: selected.anchor, head: selected.head}};
}
