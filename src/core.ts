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
