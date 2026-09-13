import {ensureSyntaxTree, syntaxTree} from '@codemirror/language';
import type {EditorState} from '@codemirror/state';
import {markdownParser} from './markdownParser';
import {selectionFormatting, selectionFormats} from './selectionFormatting';
import {analyzeSource} from './sourceAnalysis';
import type {SourcePatch} from './sourcePatch';

type Format = typeof selectionFormats[number];
type CodeRange = {from: number; to: number; start: number; end: number};
type Unit = {from: number; to: number; raw: string; text: string; code: boolean; marks: Format[]; selected: boolean};
export type CodeFormattingResult = {patches: SourcePatch[]; selection: {anchor: number; head: number}};
const htmlFormats: Record<string, Format> = {strong: 'bold', em: 'italic', del: 'strike', s: 'strike', u: 'underline', mark: 'highlight', sub: 'subscript', sup: 'superscript'};
const markdownWrappers: Record<Format, [string, string]> = {bold: ['**', '**'], italic: ['*', '*'], underline: ['<u>', '</u>'], strike: ['~~', '~~'], highlight: ['==', '=='], subscript: ['<sub>', '</sub>'], superscript: ['<sup>', '</sup>']};
const htmlWrappers: Record<Format, [string, string]> = {bold: ['<strong>', '</strong>'], italic: ['<em>', '</em>'], underline: ['<u>', '</u>'], strike: ['<del>', '</del>'], highlight: ['<mark>', '</mark>'], subscript: ['<sub>', '</sub>'], superscript: ['<sup>', '</sup>']};

function codeRanges(state: EditorState) {
  const result: CodeRange[] = [];
  (ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state)).iterate({enter(node) {
    if (['FencedCode', 'CodeBlock', 'HTMLBlock'].includes(node.name)) return false;
    if (node.name !== 'InlineCode') return;
    const first = node.node.firstChild, last = node.node.lastChild;
    if (!first || !last || first === last) return false;
    let start = first.to, end = last.from;
    const content = state.sliceDoc(start, end);
    // CommonMark removes exactly one padding space from each end, except for
    // an all-space code span. The padding is syntax, not selected text.
    if (content.startsWith(' ') && content.endsWith(' ') && /[^ ]/.test(content)) { start++; end--; }
    result.push({from: node.from, to: node.to, start, end});
    return false;
  }});
  return result;
}

/** Code is a literal-text mode; its state is independent of the five prose marks. */
export function codeSelectionState(state: EditorState): 'off' | 'mixed' | 'on' {
  const ranges = codeRanges(state), selection = state.selection.main;
  if (selection.empty) return ranges.some(range => selection.from >= range.start && selection.from <= range.end) ? 'on' : 'off';
  const data = selectionFormatting(state);
  let plain = false, code = false;
  for (let p = selection.from; p < selection.to; p++) {
    const range = ranges.find(range => p >= range.from && p < range.to);
    if (range && (p < range.start || p >= range.end)) continue;
    if (data.hidden(p) || data.structuralBits[p]) continue;
    if (range) code = true; else if (!/\s/.test(data.source[p])) plain = true;
    if (code && plain) return 'mixed';
  }
  return code ? 'on' : 'off';
}

function literalText(raw: string) {
  return markdownParser.parseInline(raw, {}).flatMap(token => token.children ?? [])
    .filter(token => token.type === 'text' || token.type === 'code_inline').map(token => token.content).join('');
}
function escapeMarkdown(text: string) {
  return text.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, '\\$&');
}
function codeFence(text: string) {
  const length = Math.max(0, ...Array.from(text.matchAll(/`+/g), match => match[0].length)) + 1;
  const fence = '`'.repeat(length);
  const padding = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && /[^ ]/.test(text)) ? ' ' : '';
  return {before: fence + padding, after: padding + fence};
}

function inlineUnits(state: EditorState, from: number, to: number, ranges: CodeRange[]): Unit[] | null {
  const data = selectionFormatting(state), source = data.source, units: Unit[] = [];
  const unsupported = data.opaque.some(range => range.block && range.from < to && range.to > from);
  if (unsupported || source.slice(from, to).includes('\n')) return null;
  let invalid = false;
  (ensureSyntaxTree(state, to, 50) ?? syntaxTree(state)).iterate({from, to, enter(node) {
    if (['Link', 'Autolink', 'Image', 'LinkReference'].includes(node.name)) { invalid = true; return false; }
    if (node.name === 'InlineCode') return false;
    if (node.name === 'HTMLTag' && !data.hidden(node.from)) invalid = true;
  }});
  if (invalid) return null;
  for (let p = from; p < to;) {
    if (data.hidden(p)) { p++; continue; }
    const range = ranges.find(range => range.from === p);
    if (range) {
      if (range.to > to || source.slice(range.from, range.to).includes('\n')) return null;
      for (let q = range.start; q < range.end;) {
        const text = String.fromCodePoint(source.codePointAt(q)!);
        units.push({from: q, to: q + text.length, raw: text, text, code: true, marks: data.formats(q), selected: false});
        q += text.length;
      }
      p = range.to;
      continue;
    }
    const atom = data.atoms.find(atom => atom.from === p);
    const end = atom?.to ?? p + String.fromCodePoint(source.codePointAt(p)!).length;
    const raw = source.slice(p, end);
    units.push({from: p, to: end, raw, text: atom ? literalText(raw) : raw, code: false, marks: data.formats(p), selected: false});
    p = end;
  }
  return units;
}

function unitSignature(units: Unit[]) {
  return units.flatMap(unit => Array.from(unit.text).filter(ch => unit.code || !/\s/.test(ch))
    .map(ch => JSON.stringify([ch, unit.code, [...unit.marks].sort()]))).join('\n');
}
function readerSignature(source: string) {
  const result: string[] = [], marks: Format[] = [];
  const visit = (tokens: ReturnType<typeof markdownParser.parse>) => {
    for (const token of tokens) {
      if (token.children) { visit(token.children); continue; }
      const format = htmlFormats[token.tag];
      if (format && token.nesting === 1) marks.push(format);
      else if (format && token.nesting === -1) { const i = marks.lastIndexOf(format); if (i >= 0) marks.splice(i, 1); }
      else if (token.type === 'html_inline') {
        const match = token.content.match(/^<(\/)?(strong|em|del|s|u|mark|sub|sup)>$/i);
        if (match) {
          const format = htmlFormats[match[2].toLowerCase()];
          if (!match[1]) marks.push(format);
          else { const i = marks.lastIndexOf(format); if (i >= 0) marks.splice(i, 1); }
        }
      } else if (token.type === 'text' || token.type === 'code_inline') {
        const code = token.type === 'code_inline';
        for (const ch of token.content) if (code || !/\s/.test(ch)) result.push(JSON.stringify([ch, code, [...new Set(marks)].sort()]));
      }
    }
  };
  visit(markdownParser.parse(source, {}));
  return result.join('\n');
}

/** Converts rendered text, never the selected Markdown source, into literal code. */
export function formatCodeSelection(state: EditorState): CodeFormattingResult | null {
  const original = state.selection.main, ranges = codeRanges(state), data = selectionFormatting(state);
  const atCaret = original.empty ? ranges.find(range => original.from >= range.start && original.from <= range.end) : undefined;
  if (original.empty && !atCaret) return null;
  const selectedFrom = atCaret?.start ?? original.from, selectedTo = atCaret?.end ?? original.to;
  const block = data.blocks.find(block => {
    const line = state.doc.lineAt(block.from);
    return line.from <= selectedFrom && line.to >= selectedTo &&
      (selectedFrom >= block.from || /^\s*$/.test(data.source.slice(selectedFrom, block.from))) &&
      (selectedTo <= block.to || /^\s*$/.test(data.source.slice(block.to, selectedTo)));
  });
  if (!block || data.source.slice(selectedFrom, selectedTo).includes('\n')) return null;
  if (analyzeSource(state.doc).frontmatter.to > block.from) return null;
  let from = Math.min(block.from, selectedFrom), to = Math.max(block.to, selectedTo);
  // Preserve heading markers exactly while editing the heading's inline content.
  for (const range of data.structural) {
    if (range.from === from && /^#+$/.test(data.source.slice(range.from, range.to))) {
      from = range.to;
      while (from < to && /[ \t]/.test(data.source[from])) from++;
    }
    if (range.to === to && /^#+$/.test(data.source.slice(range.from, range.to))) to = range.from;
  }
  const units = inlineUnits(state, from, to, ranges);
  if (!units) return null;
  const apply = !atCaret && codeSelectionState(state) !== 'on';
  for (const unit of units) {
    unit.selected = unit.from < selectedTo && unit.to > selectedFrom;
    if (!unit.selected) continue;
    if (apply) { unit.code = true; unit.marks = []; }
    else if (unit.code) { unit.code = false; unit.raw = escapeMarkdown(unit.text); }
  }
  if (!units.some(unit => unit.selected)) return null;
  const expected = unitSignature(units);
  const encode = (wrappers: Record<Format, [string, string]>) => {
    let insert = '', stack: Format[] = [];
    const positions: number[] = [], rendered: string[] = [];
    for (let i = 0; i < units.length;) {
      const unit = units[i];
      const desired = [...stack.filter(mark => unit.marks.includes(mark)), ...unit.marks.filter(mark => !stack.includes(mark))];
      let common = 0;
      while (common < stack.length && stack[common] === desired[common]) common++;
      for (let j = stack.length - 1; j >= common; j--) insert += wrappers[stack[j]][1];
      for (let j = common; j < desired.length; j++) insert += wrappers[desired[j]][0];
      stack = desired;
      let end = i + 1;
      if (unit.code) while (end < units.length && units[end].code && units[end].marks.join(',') === unit.marks.join(',')) end++;
      const fence = unit.code ? codeFence(units.slice(i, end).map(item => item.text).join('')) : {before: '', after: ''};
      insert += fence.before;
      for (; i < end; i++) {
        positions.push(insert.length);
        const text = units[i].code ? units[i].text : units[i].raw;
        rendered.push(text); insert += text;
      }
      insert += fence.after;
    }
    for (let i = stack.length - 1; i >= 0; i--) insert += wrappers[stack[i]][1];
    const selected = units.map((unit, i) => unit.selected ? i : -1).filter(i => i >= 0);
    const start = from + positions[selected[0]], last = selected[selected.length - 1];
    const end = from + positions[last] + rendered[last].length;
    let selection = original.anchor > original.head ? {anchor: end, head: start} : {anchor: start, head: end};
    if (atCaret) {
      const after = units.findIndex(unit => unit.from >= original.head);
      const caret = after >= 0 ? from + positions[after] : from + insert.length;
      selection = {anchor: caret, head: caret};
    }
    const patches: SourcePatch[] = [];
    let oldEnd = from, newEnd = 0;
    const gap = (oldTo: number, newTo: number) => {
      const expected = data.source.slice(oldEnd, oldTo), text = insert.slice(newEnd, newTo);
      if (expected !== text) patches.push({from: oldEnd, to: oldTo, insert: text, expected});
    };
    for (let i = 0; i < units.length; i++) {
      if (data.source.slice(units[i].from, units[i].to) !== rendered[i]) continue;
      gap(units[i].from, positions[i]);
      oldEnd = units[i].to; newEnd = positions[i] + rendered[i].length;
    }
    gap(to, insert.length);
    return {insert, patches, selection};
  };
  for (const wrappers of [markdownWrappers, htmlWrappers]) {
    const result = encode(wrappers);
    if (readerSignature(result.insert) !== expected) continue;
    const next = state.update({changes: {from, to, insert: result.insert}, selection: result.selection}).state;
    const nextUnits = inlineUnits(next, from, from + result.insert.length, codeRanges(next));
    if (nextUnits && unitSignature(nextUnits) === expected) return {patches: result.patches, selection: result.selection};
  }
  return null;
}
