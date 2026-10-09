/** Lightweight entry: no default heavyweight engines or editor runtime. */
export {TeggMarkdownReader} from "./sdkReader";
export type {ReaderInput, ReaderHost, SelectionReference} from "./reader";
export type {RenderEngines} from "./renderEngines";
export type {ReadonlyRenderer, ReadonlyRenderers, RenderNode, RenderContext, RendererInstance} from "./renderExtensions";
export type {ResourcePolicy} from "./resources";
export type {Locale, UIMessages, UIOptions} from "./uiContext";
export {defaultMessages} from "./uiContext";
export {markdownProfiles} from "./syntaxProfiles";
export type {MarkdownProfile} from "./syntaxProfiles";

export {bindObjectViewerHost} from './objectViewerHost';
export type {ObjectViewerHost,DecodedImageAnimation,ImageAnimationResult,ImageMetadataResult} from './objectViewerHost';

/** Mark actual Host-generated controls so rendered Copy excludes their UI text. */
export {registerRenderedClipboardOpaque} from './renderedSourceClipboard';

/** Locate only actual source owners registered by the Reader renderer. */
export {locateRenderedSourceRange} from "./markdown";
