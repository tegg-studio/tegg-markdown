import "./legacyEngines";
/** Advanced Host integration. Same core as TeggMarkdownEditor; Host owns lifecycle and attribution. */
export {editorSetup} from "./editorSetup";
export {livePreview} from "./livePreview";
export {resourceContext} from "./editorHost";
export {TechnicalMarkdownReader} from "./reader";
export type {ReaderInput, ReaderHost} from "./reader";
export {editorToolbarState, executeEditorCommand} from "./editorToolbar";
export type {EditorToolbarState} from "./editorToolbar";
export {HeadingIndex} from "./headingIndex";
export type {OutlineHeading} from "./headingIndex";
export {resolveHeadingLink} from "./linkNavigation";
export {editCurrentLink} from "./liveLinks";
export {calloutContext, calloutContextKey, calloutRanges, setCalloutType} from "./calloutEditing";
export {isKnownCallout, resolveCallout} from "./callouts";
export {technicalMarkdownProfile} from "./syntaxContract";

export type {MarkdownProfile} from "./syntaxProfiles";
export type {ResourcePolicy} from "./resources";
export type {ReadonlyRenderers, ReadonlyRenderer, RenderNode, RenderContext} from "./renderExtensions";
export type {RenderEngines} from "./renderEngines";
export type {Locale, UIMessages, UIOptions} from "./uiContext";

export * from "./editingController";
export * from "./objectDraft";
export * from "./resourceTasks";
export * from "./clipboard";
export * from "./htmlToMarkdown";
export * from "./tableEditing";
export * from "./documentDiff";
export * from "./recoveryJournal";
export {mobileNaturalExtensions} from "./mobileNatural";
export {attachEditingUI,EditingUI} from "./editingUI";
export type {EditingUIHost} from "./editingUI";

export {attachConflictUI} from "./conflictUI";
export type {ConflictUI,ConflictUIHost,ConflictUIContext} from "./conflictUI";
export {editingBudgets,editingPerformancePolicy} from "./editingBudget";
export {detectNewlinePolicy} from "./newlinePolicy";
export type {NewlinePolicy} from "./newlinePolicy";
export {applySourcePatches,validateSourcePatches,SourcePatchError} from "./sourcePatch";
export type {SourcePatch,SourceRange} from "./sourcePatch";
export {dispatchSourcePatches} from "./editorPatches";
export * from "./controlledExtensions";
