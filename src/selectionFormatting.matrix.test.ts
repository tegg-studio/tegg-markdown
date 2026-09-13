// @vitest-environment jsdom
import {describe, expect, it} from 'vitest';
import {EditorState, Transaction, type TransactionSpec} from '@codemirror/state';
import type {EditorView} from '@codemirror/view';
import {markdown} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {history, redo, undo} from '@codemirror/commands';
import {editorToolbarState, executeEditorCommand} from './editorToolbar';
import {markdownParser} from './markdownParser';

const formats = ['bold', 'italic', 'underline', 'strike', 'highlight'] as const;
type Format = typeof formats[number];
type Range = readonly [number, number];
const text = '甲乙丙丁';
const ranges: readonly {name: string; range: Range}[] = [
  {name: 'prefix', range: [0, 2]},
  {name: 'overlap', range: [1, 3]},
  {name: 'suffix', range: [2, 4]},
  {name: 'interior character', range: [1, 2]},
  {name: 'last character', range: [3, 4]},
  {name: 'whole text', range: [0, 4]},
];
const tagFormats: Record<string, Format> = {
  STRONG: 'bold', B: 'bold', EM: 'italic', I: 'italic', U: 'underline',
  S: 'strike', DEL: 'strike', MARK: 'highlight',
};

function editor(source = text) {
  const view = {
    state: EditorState.create({doc: source, extensions: [markdown({extensions: GFM}), history()]}),
    dispatch(transaction: TransactionSpec | Transaction) {
      this.state = transaction instanceof Transaction ? transaction.state : this.state.update(transaction).state;
    },
    focus() {},
  };
  return view as unknown as EditorView;
}

function select(view: EditorView, range: Range, backwards = false) {
  const source = view.state.doc.toString();
  const from = source.indexOf(text[range[0]]), to = source.indexOf(text[range[1] - 1]) + 1;
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  view.dispatch({selection: backwards ? {anchor: to, head: from} : {anchor: from, head: to}});
}

/** Check actual rendered text and element ancestry, independently of toolbar analysis. */
function rendered(source: string) {
  const container = document.createElement('div');
  container.innerHTML = markdownParser.render(source);
  const result: {text: string; formats: Format[]}[] = [];
  function visit(node: Node, active: Format[]) {
    if (node.nodeType === Node.TEXT_NODE) {
      for (const character of node.textContent ?? '') {
        if (!/\s/.test(character)) result.push({text: character, formats: [...active].sort()});
      }
      return;
    }
    const format = node instanceof Element ? tagFormats[node.tagName] : undefined;
    const next = format && !active.includes(format) ? [...active, format] : active;
    node.childNodes.forEach(child => visit(child, next));
  }
  visit(container, []);
  return result;
}

type Model = Set<Format>[];
function initialModel(): Model { return [...text].map(() => new Set<Format>()); }
function toggleModel(model: Model, format: Format, [from, to]: Range) {
  const remove = model.slice(from, to).every(marks => marks.has(format));
  for (let i = from; i < to; i++) {
    if (remove) model[i].delete(format);
    else model[i].add(format);
  }
}
function expectModel(view: EditorView, model: Model, context: string) {
  expect(rendered(view.state.doc.toString()), `${context}; source: ${view.state.doc}`).toEqual(
    [...text].map((character, index) => ({text: character, formats: [...model[index]].sort()})),
  );
}
function expectStatus(view: EditorView, model: Model, [from, to]: Range) {
  const toolbar = editorToolbarState(view.state);
  for (const format of formats) {
    const count = model.slice(from, to).filter(marks => marks.has(format)).length;
    expect(toolbar[format], `${format} toolbar state`).toBe(count === to - from);
    expect(toolbar.mixed.includes(format), `${format} mixed state`).toBe(count > 0 && count < to - from);
  }
}
function apply(view: EditorView, model: Model, format: Format, range: Range, backwards = false) {
  select(view, range, backwards);
  expectStatus(view, model, range);
  const before = view.state.doc.toString();
  toggleModel(model, format, range);
  executeEditorCommand(view, format);
  expectModel(view, model, `${format} on ${range.join('..')}`);
  expectStatus(view, model, range);
  const selection = view.state.selection.main;
  expect(view.state.sliceDoc(selection.from, selection.to).match(/[甲乙丙丁]/g)?.join('')).toBe(text.slice(...range));
  expect(selection.anchor > selection.head).toBe(backwards);
  const after = view.state.doc.toString();
  // Repeated cycles catch mapping drift, not just the first undo restoration.
  for (let cycle = 0; cycle < 3; cycle++) {
    expect(undo({state: view.state, dispatch: transaction => view.dispatch(transaction)})).toBe(true);
    expect(view.state.doc.toString()).toBe(before);
    let restored = view.state.selection.main;
    expect(view.state.sliceDoc(restored.from, restored.to).match(/[甲乙丙丁]/g)?.join('')).toBe(text.slice(...range));
    expect(restored.anchor > restored.head).toBe(backwards);
    expect(redo({state: view.state, dispatch: transaction => view.dispatch(transaction)})).toBe(true);
    expect(view.state.doc.toString()).toBe(after);
    expectStatus(view, model, range);
    restored = view.state.selection.main;
    expect(view.state.sliceDoc(restored.from, restored.to).match(/[甲乙丙丁]/g)?.join('')).toBe(text.slice(...range));
    expect(restored.anchor > restored.head).toBe(backwards);
  }
}

describe('mixed formatting semantic matrix', () => {
  it('merges adjacent highlighted text without leaving visible delimiter runs', () => {
    const view = editor('甲==乙==丙丁');
    const model = initialModel();
    model[1].add('highlight');
    apply(view, model, 'highlight', [0, 1]);
    apply(view, model, 'highlight', [0, 2]);
  });

  const cases = formats.flatMap(first => formats.flatMap(second =>
    ranges.flatMap(a => ranges.map(b => ({first, second, a: a.name, b: b.name, firstRange: a.range, secondRange: b.range}))),
  ));
  it.each(cases)('$first $a followed by $second $b preserves every character and independent format', ({first, second, firstRange, secondRange}) => {
    const view = editor(), model = initialModel();
    apply(view, model, first, firstRange);
    apply(view, model, second, secondRange, true);
    // Toggle a partial selection again, then normalize/remove each format over the full text.
    apply(view, model, first, [1, 3]);
    apply(view, model, first, [0, 4], true);
    apply(view, model, first, [0, 4]);
    apply(view, model, second, [0, 4], true);
    apply(view, model, second, [0, 4]);
  });

  const combinations = Array.from({length: 32}, (_, bits) => ({
    name: formats.filter((_, index) => bits & (1 << index)).join('+') || 'plain',
    initial: formats.filter((_, index) => bits & (1 << index)),
  }));
  it.each(combinations)('retains all other styles when toggling each format from $name', ({initial}) => {
    const view = editor(), model = initialModel();
    for (const format of initial) apply(view, model, format, [0, 4]);
    for (const format of formats) {
      apply(view, model, format, [1, 3], true);
      apply(view, model, format, [1, 3]);
    }
  });

  it.each(formats)('%s supports isolated Undo and Redo with source and selection restoration', format => {
    const view = editor(), model = initialModel();
    select(view, [0, 2], true);
    const before = view.state.doc.toString();
    apply(view, model, format, [0, 2], true);
    const after = view.state.doc.toString();
    expect(undo({state: view.state, dispatch: transaction => view.dispatch(transaction)})).toBe(true);
    expect(view.state.doc.toString()).toBe(before);
    const reverted = view.state.selection.main;
    expect(view.state.sliceDoc(reverted.from, reverted.to).match(/[甲乙丙丁]/g)?.join('')).toBe('甲乙');
    expect(reverted.anchor).toBeGreaterThan(reverted.head);
    expect(redo({state: view.state, dispatch: transaction => view.dispatch(transaction)})).toBe(true);
    expect(view.state.doc.toString()).toBe(after);
    const selection = view.state.selection.main;
    expect(view.state.sliceDoc(selection.from, selection.to).match(/[甲乙丙丁]/g)?.join('')).toBe('甲乙');
    expect(selection.anchor).toBeGreaterThan(selection.head);
    expectStatus(view, model, [0, 2]);
    expectModel(view, model, `${format} after Redo`);
  });
});

describe('formatting serialization boundaries', () => {
  it.each(formats)('%s preserves punctuation when formatting inside a word', format => {
    for (const [from, to] of [[0, 2], [1, 2], [1, 3]] as Range[]) {
      const view = editor('a.b');
      view.dispatch({selection: {anchor: from, head: to}});
      executeEditorCommand(view, format);
      expect(rendered(view.state.doc.toString()), `source: ${view.state.doc}`).toEqual(
        [...'a.b'].map((character, index) => ({text: character, formats: index >= from && index < to ? [format] : []})),
      );
      expect(editorToolbarState(view.state)[format]).toBe(true);
      executeEditorCommand(view, format);
      expect(rendered(view.state.doc.toString())).toEqual([...'a.b'].map(character => ({text: character, formats: []})));
    }
  });

  it.each(formats)('%s changes only a link label when its destination contains highlight-like syntax', format => {
    const destination = 'https://example.com/a==b==?q===&v=1';
    const source = `[甲乙](${destination} "title ==literal==")`;
    const view = editor(source);
    view.dispatch({selection: {anchor: 0, head: source.length}});
    expect(editorToolbarState(view.state).highlight).toBe(false);
    executeEditorCommand(view, format);
    expect(view.state.doc.toString()).toContain(`](${destination} "title ==literal==")`);
    const container = document.createElement('div');
    container.innerHTML = markdownParser.render(view.state.doc.toString());
    expect(container.querySelector('a')?.getAttribute('href')).toBe(destination);
    expect(rendered(view.state.doc.toString())).toEqual([...'甲乙'].map(character => ({text: character, formats: [format]})));
    executeEditorCommand(view, format);
    expect(rendered(view.state.doc.toString())).toEqual([...'甲乙'].map(character => ({text: character, formats: []})));
  });

  it.each([
    ['bold', 'strong'], ['italic', 'em'], ['underline', 'u'], ['strike', 'del'], ['highlight', 'mark'],
  ] as const)('%s HTML fallback supports partial cancellation and caret state', (format, tag) => {
    const view = editor(`<${tag}>甲乙丙</${tag}>丁`);
    const model = initialModel();
    for (let i = 0; i < 3; i++) model[i].add(format);
    apply(view, model, format, [1, 2]);
    for (const [character, active] of [['甲', true], ['乙', false], ['丙', true], ['丁', false]] as const) {
      const position = view.state.doc.toString().indexOf(character);
      view.dispatch({selection: {anchor: position}});
      expect(editorToolbarState(view.state)[format], `${format} caret on ${character}; ${view.state.doc}`).toBe(active);
    }
    apply(view, model, format, [0, 3]);
  });
});

describe('protected syntax and atomic visible characters', () => {
  const protectedSources = [
    {name: 'YAML metadata', source: '---\ntitle: 甲乙\ntags: [one, two]\n---\n\n正文', label: '甲乙'},
    {name: 'table syntax', source: '| 列一 | 列二 |\n| --- | --- |\n| 甲乙 | 丙丁 |', label: '甲乙'},
    {name: 'wiki link target and label', source: '前 [[folder/目标|甲乙]] 后', label: '甲乙'},
  ];
  it.each(formats.flatMap(format => protectedSources.map(context => ({format, ...context}))))(
    '$format leaves $name intact for partial and whole selections', ({format, source, label}) => {
      for (const [from, to] of [[source.indexOf(label), source.indexOf(label) + label.length], [0, source.length]]) {
        const view = editor(source);
        view.dispatch({selection: {anchor: to, head: from}});
        executeEditorCommand(view, format);
        expect(view.state.doc.toString()).toBe(source);
        expect(view.state.selection.main.anchor).toBe(to);
        expect(view.state.selection.main.head).toBe(from);
      }
    },
  );

  const atoms = [
    {name: 'named entity', token: '&amp;', character: '&'},
    {name: 'numeric entity', token: '&#x1F642;', character: '🙂'},
    {name: 'escaped asterisk', token: '\\*', character: '*'},
    {name: 'escaped bracket', token: '\\[', character: '['},
  ];
  it.each(formats.flatMap(format => atoms.map(atom => ({format, ...atom}))))(
    '$format treats a partially selected $name as one visible character', ({format, token, character}) => {
      const source = `甲${token}乙`, view = editor(source);
      // Deliberately select inside source syntax: serialization must never split the atom.
      view.dispatch({selection: {anchor: 2, head: 3}});
      executeEditorCommand(view, format);
      expect(view.state.doc.toString()).toContain(token);
      expect(rendered(view.state.doc.toString()), `source: ${view.state.doc}`).toEqual([
        {text: '甲', formats: []}, {text: character, formats: [format]}, {text: '乙', formats: []},
      ]);
      executeEditorCommand(view, format);
      expect(view.state.doc.toString()).toContain(token);
      expect(rendered(view.state.doc.toString())).toEqual([
        {text: '甲', formats: []}, {text: character, formats: []}, {text: '乙', formats: []},
      ]);
    },
  );
});
