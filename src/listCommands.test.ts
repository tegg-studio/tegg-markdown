import {describe, it, expect} from 'vitest';
import {EditorState, Transaction, type TransactionSpec} from '@codemirror/state';
import type {EditorView} from '@codemirror/view';
import {markdown} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {history} from '@codemirror/commands';
import {selectionHistory, undo, redo} from './selectionHistory';
import {editListBoundary, deleteListSelection, indentList, deleteListContinuation} from './listCommands';
import {insertLiveBreak, deleteLiveBreak} from './liveBreaks';
function editor(doc: string, anchor = doc.length, head = anchor) {
  let state = EditorState.create({doc, selection: {anchor, head}, extensions: [markdown({extensions: GFM}), history(), selectionHistory]});
  return {get state() {return state;}, dispatch(t: Transaction | TransactionSpec) {state = t instanceof Transaction ? t.state : state.update(t).state;}, focus() {}} as EditorView;
}
const snapshot = (v: EditorView) => ({doc: v.state.doc.toString(), selection: v.state.selection.toJSON()});
function cycle(v: EditorView, action: () => boolean) {
  const before = snapshot(v);
  expect(action()).toBe(true);
  const after = snapshot(v);
  expect(undo(v)).toBe(true); expect(snapshot(v)).toEqual(before);
  expect(redo(v)).toBe(true); expect(snapshot(v)).toEqual(after);
  for(let round=0;round<2;round++) {expect(undo(v)).toBe(true); expect(snapshot(v)).toEqual(before); expect(redo(v)).toBe(true); expect(snapshot(v)).toEqual(after);}
  return after.doc;
}
describe('semantic list boundary operations', () => {
  for (const prefix of ['- ', '* ', '100. ', '- [x] ', '> - ', '> 100. ']) {
    it(`splits ${prefix} and retains children on the tail`, () => {
      const source = prefix + 'abcd\n' + (prefix.startsWith('>') ? '> ' : '') + '      - child';
      const v = editor(source, prefix.length + 2);
      const result = cycle(v, () => editListBoundary(v, true));
      expect(result).toContain('ab\n'); expect(result).toContain('cd\n'); expect(result).toContain('- child');
      if (prefix.includes('[x]')) expect(result).toContain('- [ ] cd');
    });
  }
  it('outdents nested empty items once on every Enter then exits the root', () => {
    const v = editor('- parent\n  - child\n    - ');
    expect(cycle(v, () => editListBoundary(v, true))).toBe('- parent\n  - child\n  - ');
    expect(cycle(v, () => editListBoundary(v, true))).toBe('- parent\n  - child\n- ');
    expect(cycle(v, () => editListBoundary(v, true))).toBe('- parent\n  - child\n');
  });
  it('Backspace moves a whole nested subtree then converts root into a paragraph', () => {
    const v = editor('- first\n  - second\n    - child', 12);
    expect(cycle(v, () => editListBoundary(v, false))).toBe('- first\n- second\n  - child');
    expect(cycle(v, () => editListBoundary(v, false))).toBe('- first\n\nsecond\n- child');
  });
  it('cross-item deletion retains initial type and moves surviving descendants', () => {
    const source = '- start\n\n  100. ending\n       - child';
    const v = editor(source, 4, source.indexOf('ending') + 3);
    expect(cycle(v, () => deleteListSelection(v))).toBe('- sting\n  - child');
  });
  it('cross-item deletion cannot leave a partial hidden marker', () => {
    const v = editor('- one\n- two', 3, 7);
    expect(cycle(v, () => deleteListSelection(v))).toBe('- otwo');
  });
  for (const prefix of ['- ', '100. ', '- [x] ', '> - ']) {
    it(`repeats a complete edit chain and undo/redo for ${prefix}`, () => {
      const v = editor(prefix + 'first\n' + prefix + 'second');
      const initial = snapshot(v), states = [initial];
      const actions = [() => editListBoundary(v,true), () => indentList(v), () => editListBoundary(v,true), () => editListBoundary(v,true)];
      for (let round=0; round<3; round++) {
        for (const action of actions) {expect(action()).toBe(true); states.push(snapshot(v));}
        for (let i=states.length-2; i>=0; i--) {expect(undo(v)).toBe(true); expect(snapshot(v)).toEqual(states[i]);}
        for (let i=1; i<states.length; i++) {expect(redo(v)).toBe(true); expect(snapshot(v)).toEqual(states[i]);}
        for (let i=states.length-2; i>=0; i--) expect(undo(v)).toBe(true);
        expect(snapshot(v)).toEqual(initial); states.splice(1);
      }
    });
    it(`hard break merges without losing text for ${prefix}`, () => {
      const v=editor(prefix+'abcd',prefix.length+2);
      cycle(v,()=>insertLiveBreak(v));
      expect(cycle(v,()=>deleteLiveBreak(v,true))).toBe(prefix+'abcd');
    });
  }
});

it('growing ordered prefix moves children to the new content column', () => {
  const v=editor('999. abcd\n     - child',7);
  expect(cycle(v,()=>editListBoundary(v,true))).toBe('999. ab\n1000. cd\n      - child');
});
it('quoted root exit does not duplicate quote markers', () => {
  const v=editor('> - first\n> - second',14);
  expect(cycle(v,()=>editListBoundary(v,false))).toBe('> - first\n> \n> second');
});
it('soft continuation merges at its visible start', () => {
  const v=editor('- ab\n  cd',7);
  expect(cycle(v,()=>deleteListContinuation(v))).toBe('- abcd');
});

it('Enter on a continuation creates a sibling, not another continuation', () => {
  const v=editor('- first\n  second',13);
  expect(cycle(v,()=>editListBoundary(v,true))).toBe('- first\n  sec\n- ond');
});

it('does not generate invalid ten-digit ordered source markers', () => {
  const v=editor('999999999. item');
  expect(cycle(v,()=>editListBoundary(v,true))).toBe('999999999. item\n999999999. ');
});
