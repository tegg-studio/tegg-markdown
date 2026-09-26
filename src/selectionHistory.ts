import {EditorSelection, StateEffect, Transaction, type StateCommand} from '@codemirror/state';
import {invertedEffects, undo as cmUndo, redo as cmRedo} from '@codemirror/commands';

// A deleted selection cannot be recovered by mapping a collapsed cursor back
// through its insertion. Record the exact selection as an invertible effect.
export const restoreSelection = StateEffect.define<EditorSelection>({map: (selection, changes) => selection.map(changes)});
export const selectionHistory = invertedEffects.of(tr => tr.effects.some(e => e.is(restoreSelection))
  ? [restoreSelection.of(tr.startState.selection)] : []);

function withSelection(command: StateCommand): StateCommand {
  return target => command({state: target.state, dispatch: tr => {
    const selection = tr.effects.find(e => e.is(restoreSelection))?.value as EditorSelection | undefined;
    target.dispatch(tr);
    // History transactions bypass filters. Correct their projected selection
    // synchronously, without adding a second undo step or changing document data.
    if (selection && !tr.state.selection.eq(selection)) {
      target.dispatch(tr.state.update({selection, annotations: Transaction.addToHistory.of(false)}));
    }
  }});
}
export const undo = withSelection(cmUndo);
export const redo = withSelection(cmRedo);
