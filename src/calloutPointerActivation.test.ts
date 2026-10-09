// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history, undoDepth} from '@codemirror/commands';
import {calloutTypeButton} from './calloutInteraction';
import {bindUI} from './uiContext';

const stops: (() => void)[] = [];
afterEach(() => { for (const stop of stops.splice(0).reverse()) stop(); });
function mount(mobile = true, readOnly = false) {
  const root = document.body.appendChild(document.createElement('div'));
  const ui = bindUI(root, {mobile, locale: 'en-US'});
  const view = new EditorView({parent: root, state: EditorState.create({doc: '> [!TIP] Text', extensions: [history(), EditorState.readOnly.of(readOnly)]})});
  const button = calloutTypeButton(view, 0, 'tip'); root.append(button);
  button.getBoundingClientRect = () => new DOMRect(0, 0, 44, 44);
  const opened = vi.fn(); view.dom.addEventListener('tegg-callout-menu', opened);
  stops.push(() => {view.destroy(); ui.destroy(); root.remove();});
  return {view, button, opened};
}
function pointer(button: HTMLElement, type: string, x = 12, y = 12, pointerType = 'touch') {
  const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y});
  Object.defineProperties(event, {pointerId: {value: 1}, pointerType: {value: pointerType}});
  button.dispatchEvent(event);
}
it('opens once on a real mobile touch without compatibility click and preserves Source/history', () => {
  const {view, button, opened} = mount();
  pointer(button, 'pointerdown'); pointer(button, 'pointerup');
  expect(opened).toHaveBeenCalledTimes(1);
  button.dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1, clientX: 12, clientY: 12}));
  expect(opened).toHaveBeenCalledTimes(1);
  expect(view.state.doc.toString()).toBe('> [!TIP] Text'); expect(undoDepth(view.state)).toBe(0);
  pointer(button, 'pointerdown'); pointer(button, 'pointerup'); expect(opened).toHaveBeenCalledTimes(2);
});
it.each(['move', 'cancel', 'context', 'outside', 'source-change'])('rejects %s instead of opening from an incomplete gesture', kind => {
  const {view, button, opened} = mount(); pointer(button, 'pointerdown');
  if (kind === 'move') pointer(button, 'pointermove', 30, 30);
  if (kind === 'cancel') pointer(button, 'pointercancel');
  if (kind === 'context') button.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true}));
  if (kind === 'source-change') view.dispatch({changes: {from: 0, insert: 'changed'}});
  pointer(button, 'pointerup', kind === 'outside' ? 60 : 12);
  expect(opened).not.toHaveBeenCalled();
});
it.each([[false, false], [true, true]])('does not synthesize a touch action for mobile=%s readOnly=%s', (mobile, readOnly) => {
  const {button, opened} = mount(mobile, readOnly); pointer(button, 'pointerdown'); pointer(button, 'pointerup'); expect(opened).not.toHaveBeenCalled();
});
it('retains mouse clicks and detail-zero keyboard or assistive activation', () => {
  const {button, opened} = mount();
  pointer(button, 'pointerdown', 12, 12, 'mouse'); pointer(button, 'pointerup', 12, 12, 'mouse'); expect(opened).not.toHaveBeenCalled();
  button.dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1, clientX: 12, clientY: 12})); expect(opened).toHaveBeenCalledTimes(1);
  pointer(button, 'pointerdown'); pointer(button, 'pointerup'); expect(opened).toHaveBeenCalledTimes(2);
  button.dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 0})); expect(opened).toHaveBeenCalledTimes(3);
});
