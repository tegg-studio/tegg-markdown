import {EditorSelection} from "@codemirror/state";
import {restoreSelection} from "./selectionHistory";
import type { EditorView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { validateSourcePatches, type SourcePatch } from "./sourcePatch";

type PatchDispatchOptions = {
  selection?: { anchor: number; head?: number };
  scrollIntoView?: boolean;
  isolateHistory?: boolean;
  preserveSelection?: boolean;
  userEvent?: string;
};

/** Keeps CodeMirror as the draft owner while all UI actions use SourcePatch. */
export function dispatchSourcePatches(
  view: EditorView,
  patches: readonly SourcePatch[],
  options: PatchDispatchOptions = {},
) {
  if (view.composing || view.state.readOnly) return;
  const source = view.state.doc.toString();
  const ordered = validateSourcePatches(source, patches);
  view.dispatch({
    changes: ordered.map(({ from, to, insert }) => ({ from, to, insert })),
    selection: options.selection,
    userEvent: options.userEvent,
    effects: options.preserveSelection && options.selection ? restoreSelection.of(EditorSelection.single(options.selection.anchor, options.selection.head)) : undefined,
    scrollIntoView: options.scrollIntoView,
    annotations: options.isolateHistory ? isolateHistory.of("full") : undefined,
  });
}
