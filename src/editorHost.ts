import type {RenderEngines} from "./renderEngines";
import type {MarkdownProfile} from "./syntaxProfiles";
import {Facet} from "@codemirror/state";
import type {EditorView} from "@codemirror/view";
export type ResourceContext = {
  documentPath: string;
  profile?: MarkdownProfile;
  engines?: RenderEngines;
  resolveImage?: (src: string, documentPath: string) => string;
};
export const resourceContext = Facet.define<ResourceContext, ResourceContext>({
  combine: values => values[0] ?? {documentPath: ""}
});
export function imageForView(view: EditorView, src: string): string {
  const context = view.state.facet(resourceContext);
  return context.resolveImage?.(src, context.documentPath) ?? "";
}
