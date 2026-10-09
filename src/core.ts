export {bindObjectViewerHost} from './objectViewerHost';
export type {ObjectViewerHost,DecodedImageAnimation,ImageAnimationResult,ImageMetadataResult} from './objectViewerHost';
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
export type {CellDraftAuxiliaryActions,CellDraftAuxiliaryRequest,CellDraftAuxiliaryMount,CellDraftAuxiliaryHost} from "./cellDraftAuxiliary";
/** Bind locale to a custom Host editor root; destroy the binding with that surface. */
export {bindUI} from "./uiContext";

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
export type {EditingUIHost,ActiveEditingDraft} from "./editingUI";

export {attachConflictUI} from "./conflictUI";
export type {ConflictUI,ConflictUIHost,ConflictUIContext} from "./conflictUI";
export {editingBudgets,editingPerformancePolicy} from "./editingBudget";
export {detectNewlinePolicy} from "./newlinePolicy";
export type {NewlinePolicy} from "./newlinePolicy";
export {applySourcePatches,validateSourcePatches,SourcePatchError} from "./sourcePatch";
export type {SourcePatch,SourceRange} from "./sourcePatch";
export {dispatchSourcePatches} from "./editorPatches";
export * from "./controlledExtensions";

export {focusedTableCell,focusedTableToolbarState,tableWidgetOwnsFocus,tableWidgetIsComposing,executeFocusedTableCommand,commitTableDrafts} from "./tableWidget";
export {focusCodeAtSelection} from "./codeEditing";
export {blockContext} from "./blockContext";
export {planStructuralInsert,planHeadingTransform} from "./structuralCommands";

export {clearPendingInlineStyle} from "./pendingInlineStyle";

export * from "./htmlTableEditing";
export {attachHtmlTableEditing,commitHtmlTableDrafts,htmlTableWidgetOwnsFocus,htmlTableWidgetIsComposing,executeHtmlTableCommand} from "./htmlTableWidget";
export {commitMetadataPanel} from "./metadata";

export {ContentDisplaySession} from "./contentDisplaySession";

export {prepareEditingLeave} from "./editingLeave";
export {displaySessionMapping,displaySessionFor} from "./editorHost";

export {bindContentScroll} from './contentScroll';
export type {ContentObjectRange} from './contentScroll';

export {htmlDirectEditingIsComposing,htmlDirectEditingOwnsFocus,executeHtmlDirectCommand,captureActiveHtmlDirectInput} from './htmlDirectEditing';
export {focusedHtmlTableState,htmlTableWidgetIsEditing} from './htmlTableWidget';
export * from './htmlTableClipboard';

export {focusedHtmlDirectState} from './htmlDirectEditing';
export {focusedFootnoteEditor,footnoteSourceRangeFor,executeFocusedFootnoteCommand,footnoteEditingIsComposing} from './footnoteEditing';

export {routeFootnoteCommand,prepareFootnoteChildren} from './footnoteEditing';

export {editingLeaveIsComposing,editingLeaveAwaitingChoice} from "./editingPreflight";

export * from "./clipboardTransport";
export * from "./contentClipboard";

export * from "./markdownTableClipboard";
export {routeTableCommand} from "./tableWidget";

export {semanticObjectBoundaries,snapSemanticSelection,snapSemanticSelectionState,semanticSelectAll,semanticSelectionExtension,planSemanticSelectionDeletion,planInlineSelectionDeletion,deleteSemanticSelection,selectSemanticBoundary,leaveSemanticObjectSelection,mergeSemanticParagraphBoundary,moveSemanticWord,deleteSemanticWord} from './objectBoundary';

/** Mark actual Host-generated controls so rendered Copy excludes their UI text. */
export {registerRenderedClipboardOpaque} from './renderedSourceClipboard';

/** Locate only actual source owners registered by the Reader renderer. */
export {locateRenderedSourceRange} from "./markdown";

export {inspectDocument,queryInspection,inspectionLocation,expandInspectionLocation} from "./documentInspection";
export type {DocumentInspection,InspectionEntry,InspectionKind,InspectionLocation,InspectionFold} from "./documentInspection";

export {validateTechnicalDraft} from "./technicalSyntax";
export type {TechnicalValidationOutcome,TechnicalValidator,TechnicalDraftKind} from "./technicalSyntax";

/** Actual SDK-generated image actions, for presentation measurement only. */
export {renderedImageViewControls} from "./renderInteraction";
