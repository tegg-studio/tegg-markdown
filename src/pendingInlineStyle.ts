import {StateEffect, StateField, type EditorState} from "@codemirror/state";
import {EditorView} from "@codemirror/view";
import {dispatchSourcePatches} from "./editorPatches";

type Marker = {command: string; before: string; after: string};
export type FormatSpan = {from: number; start: number; end: number; to: number};
type Suppressed = Marker & FormatSpan;
type Pending = {markers: readonly Marker[]; suppressed: readonly Suppressed[]; position: number; composing: boolean};
const setPending = StateEffect.define<Pending | null>();
const field = StateField.define<Pending | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setPending)) return effect.value;
    if (!value) return null;
    if (transaction.docChanged && !value.composing) return null;
    if (transaction.selection && transaction.state.selection.main.anchor !== value.position && !value.composing) return null;
    return value;
  },
});

const extension = [field,
  EditorView.inputHandler.of((view, from, to, text) => consumePendingInlineStyle(view, from, to, text)),
  EditorView.domEventHandlers({
    compositionstart: (_event, view) => {const current = pendingValue(view.state); if (current) view.dispatch({effects: setPending.of({...current, composing: true})}); return false;},
    compositionend: (_event, view) => {
      queueMicrotask(() => {
        const current = pendingValue(view.state);
        if (!current?.composing) return;
        const end = view.state.selection.main.anchor;
        if (end <= current.position || view.state.doc.lineAt(end).from !== view.state.doc.lineAt(current.position).from) {clearPendingInlineStyle(view); return;}
        const text = view.state.sliceDoc(current.position, end);
        if (!text.trim() && !current.suppressed.length) {
          // Firefox sends even a plain space through composition. Keep armed
          // styles for the next real character, as the normal input handler does.
          view.dispatch({effects: setPending.of(current.markers.length ? {...current, position: end, composing: false} : null)});
          return;
        }
        wrap(view, current, current.position, end, text, text, false);
        // The wrapping transaction sees composing=true, so the field keeps its
        // value through that document change. End the typing intent explicitly.
        clearPendingInlineStyle(view);
      });
      return false;
    },
  }),
];

function pendingValue(state: EditorState): Pending | null {return state.field(field, false) ?? null;}
export function pendingInlineStyles(state: EditorState): readonly string[] {return pendingValue(state)?.markers.map(marker => marker.command) ?? [];}
export function suppressedInlineStyles(state: EditorState): readonly string[] {return pendingValue(state)?.suppressed.map(marker => marker.command) ?? [];}
export function pendingInlineStyle(view: EditorView): string | null {return pendingInlineStyles(view.state).at(-1) ?? null;}
export function clearPendingInlineStyle(view: EditorView) {if (pendingValue(view.state)) view.dispatch({effects: setPending.of(null)});}

/** Toggle a style in editor state without writing placeholder source. */
export function togglePendingInlineStyle(view: EditorView, command: string, before: string, after: string, existing?: FormatSpan): boolean {
  if (view.state.field(field, false) === undefined) view.dispatch({effects: StateEffect.appendConfig.of(extension)});
  const current = pendingValue(view.state);
  const markers = current?.markers.filter(marker => marker.command !== command) ?? [];
  const suppressed = current?.suppressed.filter(marker => marker.command !== command) ?? [];
  const alreadyOn = markers.length !== (current?.markers.length ?? 0);
  const alreadyOff = suppressed.length !== (current?.suppressed.length ?? 0);
  const enabled = !existing && !alreadyOn;
  if (existing && !alreadyOff) suppressed.push({command, before: view.state.sliceDoc(existing.from, existing.start),
    after: view.state.sliceDoc(existing.end, existing.to), ...existing});
  else if (enabled) markers.push({command, before, after});
  view.dispatch({effects: setPending.of(markers.length || suppressed.length ? {markers, suppressed, position: view.state.selection.main.anchor, composing: false} : null)});
  return enabled;
}

function wrap(view: EditorView, current: Pending, from: number, to: number, expected: string, content: string, isolateHistory: boolean) {
  const interior = current.suppressed.filter(item => current.position > item.start && current.position < item.end)
    .sort((a, b) => (a.end - a.start) - (b.end - b.start));
  const boundary = current.suppressed.find(item => current.position === item.start || current.position === item.end);
  const closes = interior.map(item => item.after).join("");
  const opens = [...interior].reverse().map(item => item.before).join("");
  const before = current.markers.map(marker => marker.before).join("");
  const after = [...current.markers].reverse().map(marker => marker.after).join("");
  const insertAt = boundary && !interior.length ? current.position === boundary.start ? boundary.from : boundary.to + (to - from) : from;
  const insert = closes + before + content + after + opens;
  const relocating = insertAt !== from;
  const patches = relocating ? [
    {from, to, expected, insert: ""},
    {from: insertAt, to: insertAt, expected: "", insert},
  ] : [{from, to, expected, insert}];
  const finalStart = insertAt > to ? insertAt - (to - from) : insertAt;
  dispatchSourcePatches(view, patches, {
    selection: {anchor: finalStart + closes.length + before.length + content.length}, scrollIntoView: true, isolateHistory,
    userEvent: "input.type",
  });
}

/** Used by CodeMirror's input handler and non-DOM input adapters. */
export function consumePendingInlineStyle(view: EditorView, from: number, to: number, text: string): boolean {
  const current = pendingValue(view.state);
  if (!current || current.composing || view.composing || from !== current.position || to !== from || !text) return false;
  if (/^\s+$/.test(text) && !current.suppressed.length) {
    view.dispatch({changes: {from, to, insert: text}, selection: {anchor: from + text.length},
      effects: setPending.of({...current, position: from + text.length}), userEvent: "input.type"});
    return true;
  }
  wrap(view, current, from, to, "", text, true);
  return true;
}
