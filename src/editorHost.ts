import {ContentDisplaySession} from "./contentDisplaySession";
import type {RenderEngines} from "./renderEngines";
import type {MarkdownProfile} from "./syntaxProfiles";
import {Facet,StateField} from "@codemirror/state";
import type {EditorView} from "@codemirror/view";
export type ResourceContext = {
  documentPath: string;
  editingContext?:'table-cell';
  displaySession?:ContentDisplaySession;
  profile?: MarkdownProfile;
  engines?: RenderEngines;
  resolveImage?: (src: string, documentPath: string) => string;
};
/** Reconfiguration can allocate a new facet value without changing its authority. */
export function sameResourceContextAuthority(left:ResourceContext,right:ResourceContext):boolean {
  return left.documentPath===right.documentPath&&(left.profile??'tegg')===(right.profile??'tegg')&&
    left.editingContext===right.editingContext&&left.engines===right.engines&&left.resolveImage===right.resolveImage&&left.displaySession===right.displaySession;
}
export const resourceContext = Facet.define<ResourceContext, ResourceContext>({
  combine: values => values[0] ?? {documentPath: ""}
});
export function imageForView(view: EditorView, src: string): string {
  const context = view.state.facet(resourceContext);
  return context.resolveImage?.(src, context.documentPath) ?? "";
}

const sessions=new WeakMap<EditorView,ContentDisplaySession>();
export function displaySessionFor(view:EditorView):ContentDisplaySession {const declared=view.state.facet(resourceContext).displaySession;if(declared)return declared;let session=sessions.get(view);if(!session){session=new ContentDisplaySession();sessions.set(view,session);}return session;}
export const displaySessionMapping=StateField.define<null>({create:()=>null,update(value,tr){if(tr.docChanged)tr.startState.facet(resourceContext).displaySession?.map(tr.changes);return value;}});
