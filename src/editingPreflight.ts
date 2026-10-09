import type {EditorView} from '@codemirror/view';

/** Independent field drafts, including projected child views, join one leave boundary. */
type LeaveParticipant = {view:EditorView; composing:()=>boolean; awaitingChoice:()=>boolean; prepare:()=>boolean; cancelPending:()=>void};
const participants = new Set<LeaveParticipant>();
function scoped(view:EditorView) {return [...participants].filter(item=>item.view===view||view.dom.contains(item.view.dom));}
export function registerEditingLeave(participant:LeaveParticipant) {participants.add(participant);return ()=>participants.delete(participant);}
export function editingLeaveIsComposing(view:EditorView) {return scoped(view).some(item=>item.composing());}
export function editingLeaveAwaitingChoice(view:EditorView) {return scoped(view).some(item=>item.awaitingChoice());}
export function cancelIndependentEditingLeave(view:EditorView) {scoped(view).forEach(item=>item.cancelPending());}
export function prepareIndependentEditingLeave(view:EditorView) {
  const items=scoped(view);
  if(items.some(item=>item.composing())) {items.forEach(item=>item.cancelPending());return false;}
  for(const item of items) if(!item.prepare())return false;
  return true;
}
