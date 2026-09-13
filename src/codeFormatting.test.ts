import {describe, expect, it} from 'vitest';
import {EditorState, Transaction, type TransactionSpec} from '@codemirror/state';
import {markdown} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {history, isolateHistory, undo, redo} from '@codemirror/commands';
import {formatCodeSelection, codeSelectionState} from './codeFormatting';
import {markdownParser} from './markdownParser';
import {applySourcePatches} from './sourcePatch';
import type {EditorView} from '@codemirror/view';
import {executeEditorCommand, editorToolbarState} from './editorToolbar';

function editor(doc: string, anchor = 0, head = doc.length) {
  return {
    state: EditorState.create({doc, selection: {anchor, head}, extensions: [markdown({extensions: GFM}), history()]}),
    focus() {},
    dispatch(transaction: TransactionSpec | Transaction) {
      this.state = transaction instanceof Transaction ? transaction.state : this.state.update(transaction).state;
    },
  };
}
function toggle(view: ReturnType<typeof editor>) {
  const result = formatCodeSelection(view.state);
  if (result) {
    const expected = applySourcePatches(view.state.doc.toString(), result.patches);
    view.dispatch({changes: result.patches, selection: result.selection, annotations: isolateHistory.of('full')});
    view.dispatch({selection: result.selection});
    expect(view.state.doc.toString()).toBe(expected);
  }
  return result;
}
function codeContents(source: string) {
  return markdownParser.parseInline(source, {}).flatMap(token => token.children ?? []).filter(token => token.type === 'code_inline').map(token => token.content);
}

describe('literal inline code selection formatting', () => {
  it.each(['甲 `乙`', '`甲` `乙`', '**甲** `乙`', '<u>甲</u> `乙`'])('unifies %s and removes code on the second click', source => {
    const view = editor(source);
    expect(codeSelectionState(view.state)).toBe(source === '`甲` `乙`' ? 'on' : 'mixed');
    expect(toggle(view)).not.toBeNull();
    if (source === '`甲` `乙`') {
      expect(view.state.doc.toString()).toBe('甲 乙');
      return;
    }
    expect(codeContents(view.state.doc.toString())).toEqual(['甲 乙']);
    expect(codeSelectionState(view.state)).toBe('on');
    expect(toggle(view)).not.toBeNull();
    expect(view.state.doc.toString()).toBe('甲 乙');
  });
  it('handles adjacent plain and existing code without leaking fence characters', () => {
    const view = editor('甲`乙`', 0, 1);
    expect(toggle(view)).not.toBeNull();
    expect(view.state.doc.toString()).toBe('`甲乙`');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('甲');
  });
  it.each([['`甲乙丙`', 2, 3, '`甲`乙`丙`'], ['`甲乙丙`', 1, 2, '甲`乙丙`'], ['`甲乙丙`', 3, 4, '`甲乙`丙']])('removes only selected code from %s at %i', (source, from, to, expected) => {
    const view = editor(source as string, from as number, to as number);
    expect(toggle(view)).not.toBeNull();
    expect(view.state.doc.toString()).toBe(expected);
    expect(codeSelectionState(view.state)).toBe('off');
    expect(toggle(view)).not.toBeNull();
    expect(view.state.doc.toString()).toBe(source);
  });
  it('removes the whole code span at a caret and preserves the caret', () => {
    const view = editor('前 `甲乙` 后', 5, 5);
    expect(toggle(view)).not.toBeNull();
    expect(view.state.doc.toString()).toBe('前 甲乙 后');
    expect(view.state.selection.main.from).toBe(4);
  });
  it.each(['a`b', '`', '``', 'a``b', '`a`', ' a ', '  a  '])('uses safe fences and padding for literal %s', literal => {
    // Escaping protects the initial literal text from Markdown's own parsing.
    const source = literal.replace(/`/g, '\\`');
    const view = editor(source);
    expect(toggle(view)).not.toBeNull();
    expect(codeContents(view.state.doc.toString())).toEqual([literal]);
    expect(codeSelectionState(view.state)).toBe('on');
    expect(toggle(view)).not.toBeNull();
    expect(markdownParser.render(view.state.doc.toString())).not.toContain('<code>');
  });
  it('decodes entities and escapes before converting to code', () => {
    const view = editor('甲&amp;乙 \\*字面\\*');
    expect(toggle(view)).not.toBeNull();
    expect(codeContents(view.state.doc.toString())).toEqual(['甲&乙 *字面*']);
    expect(toggle(view)).not.toBeNull();
    expect(markdownParser.render(view.state.doc.toString())).toBe('<p>甲&amp;乙 *字面*</p>\n');
  });
  it('keeps code literals literal after code is removed', () => {
    const view = editor('`**甲** &amp; [x](url)`');
    expect(toggle(view)).not.toBeNull();
    expect(markdownParser.render(view.state.doc.toString())).toBe('<p>**甲** &amp;amp; [x](url)</p>\n');
  });
  it.each(Array.from({length: 32}, (_, mask) => mask))('converts all five-mark combinations %i into pure literal code', mask => {
    const tags = ['strong', 'em', 'u', 'del', 'mark'].filter((_, i) => mask & 1 << i);
    const source = tags.map(tag => `<${tag}>`).join('') + '甲乙' + [...tags].reverse().map(tag => `</${tag}>`).join('');
    for (const includeMarkers of [false, true]) {
      const from = includeMarkers ? 0 : source.indexOf('甲'), to = includeMarkers ? source.length : source.indexOf('乙') + 1;
      const view = editor(source, from, to);
      expect(toggle(view), `${mask}/${includeMarkers}`).not.toBeNull();
      expect(markdownParser.render(view.state.doc.toString())).toBe('<p><code>甲乙</code></p>\n');
      expect(toggle(view)).not.toBeNull();
      expect(view.state.doc.toString()).toBe('甲乙');
    }
  });
  it.each(['**甲乙丙**', '*甲乙丙*', '<u>甲乙丙</u>', '~~甲乙丙~~', '==甲乙丙=='])('preserves unselected outer formatting in %s', source => {
    const view = editor(source, source.indexOf('乙'), source.indexOf('乙') + 1);
    expect(toggle(view)).not.toBeNull();
    const html = markdownParser.render(view.state.doc.toString());
    expect(html).toContain('<code>乙</code>');
    expect(codeContents(view.state.doc.toString())).toEqual(['乙']);
    expect(toggle(view)).not.toBeNull();
    expect(markdownParser.render(view.state.doc.toString())).toContain('乙');
  });
  it('keeps a reversed visible selection across conversion, undo, and redo', () => {
    const source = '甲 **乙**', view = editor(source, source.length, 0);
    expect(toggle(view)).not.toBeNull();
    const after = view.state.doc.toString(), selection = view.state.selection.main;
    expect(selection.anchor).toBeGreaterThan(selection.head);
    expect(view.state.sliceDoc(selection.from, selection.to)).toBe('甲 乙');
    undo({state: view.state, dispatch: transaction => view.dispatch(transaction)});
    expect(view.state.doc.toString()).toBe(source);
    redo({state: view.state, dispatch: transaction => view.dispatch(transaction)});
    expect(view.state.doc.toString()).toBe(after);
    expect(view.state.selection.main.anchor).toBeGreaterThan(view.state.selection.main.head);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('甲 乙');
  });
  it.each(['甲\n\n乙', '[甲](url)', '| A | B |\n|---|---|\n| C | D |', '[[Note|甲]]', '---\ntitle: 甲\n---\n正文', '<span>甲</span>', '甲<br>乙', '```\n甲\n```'])('does not rewrite protected or complex structures: %s', source => {
    const view = editor(source);
    expect(toggle(view)).toBeNull();
    expect(view.state.doc.toString()).toBe(source);
  });
  it('preserves heading prefixes and the following paragraph', () => {
    const source = '## **甲乙**\n\n后续', view = editor(source, 5, 7);
    expect(toggle(view)).not.toBeNull();
    expect(view.state.doc.toString()).toBe('## `甲乙`\n\n后续');
  });
});


describe('actual toolbar code and prose-style integration', () => {
  it.each(['bold', 'italic', 'underline', 'strike', 'highlight'])('handles %s -> code -> remove -> %s and guarded code contents', command => {
    const view = editor('甲乙'), actual = view as unknown as EditorView;
    executeEditorCommand(actual, command);
    expect(editorToolbarState(view.state)[command as 'bold']).toBe(true);
    executeEditorCommand(actual, 'code');
    expect(markdownParser.render(view.state.doc.toString())).toBe('<p><code>甲乙</code></p>\n');
    expect(editorToolbarState(view.state).inlineFormattingEnabled).toBe(false);
    const literal = view.state.doc.toString();
    executeEditorCommand(actual, command);
    expect(view.state.doc.toString()).toBe(literal);
    view.dispatch({selection: {anchor: view.state.selection.main.from + 1}});
    executeEditorCommand(actual, command);
    expect(view.state.doc.toString()).toBe(literal);
    executeEditorCommand(actual, 'code');
    expect(view.state.doc.toString()).toBe('甲乙');
    view.dispatch({selection: {anchor: 0, head: 2}});
    executeEditorCommand(actual, command);
    expect(editorToolbarState(view.state)[command as 'bold']).toBe(true);
  });
  it('repeats actual command undo and redo without losing the visible reversed selection', () => {
    const source = '甲 **乙**', view = editor(source, source.length, 0), actual = view as unknown as EditorView;
    executeEditorCommand(actual, 'code');
    const code = view.state.doc.toString();
    executeEditorCommand(actual, 'code');
    expect(view.state.doc.toString()).toBe('甲 乙');
    for (let n = 0; n < 3; n++) {
      undo({state: view.state, dispatch: transaction => view.dispatch(transaction)});
      expect(view.state.doc.toString()).toBe(code);
      expect(view.state.selection.main.anchor).toBeGreaterThan(view.state.selection.main.head);
      undo({state: view.state, dispatch: transaction => view.dispatch(transaction)});
      expect(view.state.doc.toString()).toBe(source);
      redo({state: view.state, dispatch: transaction => view.dispatch(transaction)});
      expect(view.state.doc.toString()).toBe(code);
      redo({state: view.state, dispatch: transaction => view.dispatch(transaction)});
      expect(view.state.doc.toString()).toBe('甲 乙');
      expect(view.state.selection.main.anchor).toBeGreaterThan(view.state.selection.main.head);
      expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('甲 乙');
    }
  });
});
