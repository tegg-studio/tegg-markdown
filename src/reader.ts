import {bindEngines, type RenderEngines} from "./renderEngines";
import {bindUI, type UIOptions} from "./uiContext";
import {mountRenderers, disposeRenderers, type ReadonlyRenderers} from "./renderExtensions";
import {allowedImageURL, type ResourcePolicy} from "./resources";
import {resolveProfile, type MarkdownProfile} from "./syntaxProfiles";
import {disposeMetadataPanel} from "./metadata";
import {observeSurfaceAppearance} from "./appearance";
import {renderDiagram} from "./renderKit";
import {disposeInteractions} from "./renderInteraction";
import { renderMarkdown, type ReaderContentState, type ReaderEvent, type RenderMarkdownOptions } from "./markdown";
import { appearanceScale, appearanceWidth, observeTypography } from "./typography";
import { technicalMarkdownProfile } from "./syntaxContract";

export type ReaderInput = {
  documentId?: string;
  source: string;
  profile?: MarkdownProfile;
  revision?: string;
  profileVersion?: string;
  documentPath?: string;
  contentState?: ReaderContentState;
  fontScale?: number;
  contentWidth?: number;
};

export type NormalizedReaderInput = {
  documentId: string;
  source: string;
  revision: string;
  profileVersion: string;
  documentPath: string;
  contentState: ReaderContentState;
  fontScale: number;
  contentWidth: number;
};

export type SelectionReference = {documentId: string; revision: string; text: string; generation?: string; sequence?: number; range?: {from: number; to: number}};
export type ReaderHost = UIOptions & {
  copyText?(text: string): void | Promise<void>;
  onSelection?(selection: SelectionReference): void;
  scrollBehavior?: "preserve" | "follow" | "host";
  engines?: RenderEngines;
  layout?: "internal" | "host";
  chrome?: "default" | "headless";
  scrollContainer?: HTMLElement;
  renderers?: ReadonlyRenderers;
  onError?(error: unknown): void;
  resourcePolicy?: ResourcePolicy;
  resolveResource?(src: string, context: {documentId: string; documentPath: string; signal: AbortSignal}): Promise<string | null>;
  enhancedInteractions?: boolean;
  scheduleDiagram?: RenderMarkdownOptions["scheduleDiagram"];
  /** Native hosts may resolve sandboxed files; browser hosts keep normal URLs. */
  resolveImage?(src: string, documentPath: string): string;
  openLink?(href: string, documentPath?: string): void;
  onEvent?(event: ReaderEvent & { documentPath?: string }): void;
};

export function normalizeReaderInput(input: ReaderInput): NormalizedReaderInput {
  return {
    documentId: input.documentId ?? "",
    source: input.source ?? "",
    revision: input.revision ?? "",
    profileVersion: input.profileVersion ?? technicalMarkdownProfile.version,
    documentPath: input.documentPath ?? "",
    contentState: input.contentState ?? "settled",
    fontScale: appearanceScale(input.fontScale),
    contentWidth: appearanceWidth(input.contentWidth),
  };
}

export class TechnicalMarkdownReader {
  private stopEngines: () => void;
  private ui: ReturnType<typeof bindUI>;
  private destroyed = false;
  private activeDocument = "";
  private queued = 0;
  private currentRevision = "";
  private life = new AbortController();
  private selectionChanged = () => {
    const selection = this.root.ownerDocument.getSelection();
    if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode || !this.root.contains(selection.anchorNode) || !this.root.contains(selection.focusNode)) return;
    try {this.host.onSelection?.({documentId:this.activeDocument,revision:this.currentRevision,text:selection.toString()});} catch(error) {this.host.onError?.(error);}
  };
  private renderController?: AbortController;
  private stopObserving: () => void;
  private stopTheme: () => void;
  constructor(private readonly root: HTMLElement, private readonly host: ReaderHost = {}) {
    root.classList.add("tegg-reader");
    root.ownerDocument.addEventListener("selectionchange",this.selectionChanged,{signal:this.life.signal});
    root.addEventListener("tegg-copy-text",event=>{
      if(!this.host.copyText) return; event.preventDefault();event.stopPropagation();
      Promise.resolve().then(()=>this.host.copyText!((event as CustomEvent<string>).detail)).catch(error=>{if(!this.destroyed)this.host.onError?.(error);});
    },{signal:this.life.signal});
    this.ui = bindUI(root, host);
    this.stopEngines = bindEngines(root, host.engines);
    this.stopObserving = observeTypography(root);
    const update = () => {
      for (const canvas of root.querySelectorAll<HTMLElement>('.diagram-canvas[data-engine="mermaid"]:not(.md-object-content *)')) {
        const source = canvas.closest(".diagram")?.querySelector(".diagram-source code")?.textContent;
        if (source != null) void renderDiagram({kind:"diagram",engine:"mermaid",source},canvas);
      }
    };
    this.stopTheme = observeSurfaceAppearance(root, update);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; this.life.abort(); this.queued++; this.renderController?.abort();
    this.stopObserving(); this.stopTheme(); this.stopEngines(); this.ui.destroy(); disposeRenderers(this.root); disposeInteractions(this.root);
    this.root.querySelectorAll<HTMLElement>(".frontmatter").forEach(disposeMetadataPanel);
    this.root.replaceChildren();
  }

  setUI(options: UIOptions) {if (this.destroyed) throw new Error("Reader has been destroyed"); this.ui.update(options);}

  async render(input: ReaderInput) {
    if (this.destroyed) throw new Error("Reader has been destroyed");
    const request = ++this.queued;
    // Coalesce bursts before parsing. Every promise settles; the newest snapshot wins.
    if (input.contentState === "streaming" && this.root.hasChildNodes()) {await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); if (request !== this.queued || this.destroyed) return;}
    const profile = resolveProfile(input.profile);
    const normalized = normalizeReaderInput(input);
    if (normalized.profileVersion !== technicalMarkdownProfile.version) throw new Error(`Unsupported Markdown profile: ${normalized.profileVersion}`);
    if (this.activeDocument !== normalized.documentId) disposeRenderers(this.root);
    this.activeDocument = normalized.documentId; this.currentRevision = normalized.revision;
    const focused = document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement) ? document.activeElement : null;
    const scroll = this.host.scrollContainer ?? this.root;
    const anchor = Array.from(this.root.children).find(node => node.getBoundingClientRect().bottom > scroll.getBoundingClientRect().top);
    const anchorTop = anchor?.getBoundingClientRect().top;
    const scrollTop = scroll.scrollTop;
    const follow = this.host.scrollBehavior === "follow" && scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop <= 2;
    this.renderController?.abort();
    const controller = this.renderController = new AbortController();
    const {signal} = controller;
    const pending: Array<{raw: string; resolved: Promise<string | null>}> = [];
    const resolve = (src: string, path: string) => {
      if (this.host.resolveResource) {
        pending.push({raw: src, resolved: Promise.resolve().then(() => this.host.resolveResource!(src, {documentId: normalized.documentId, documentPath: path, signal})).catch(error => {if(!signal.aborted) this.host.onError?.(error); return null;})});
        return "";
      }
      return allowedImageURL(this.host.resolveImage?.(src, path) ?? src, this.host.resourcePolicy) ?? "";
    };
    if (normalized.profileVersion !== technicalMarkdownProfile.version) {
      throw new Error(`Unsupported Markdown profile: ${normalized.profileVersion}`);
    }
    this.root.style.setProperty("--reader-font-scale", String(normalized.fontScale));
    this.root.style.setProperty("--reader-content-width", `${normalized.contentWidth}px`);
    this.root.dataset.contentState = normalized.contentState;
    await renderMarkdown(normalized.source, this.root, {
      profile, signal, interactionSignal: this.life.signal,
      reuseKey: !this.host.renderers && !this.host.resolveResource ? `${normalized.documentId}:${normalized.documentPath}` : undefined,
      enhancedInteractions: this.host.enhancedInteractions,
      documentPath: normalized.documentPath,
      resolveImage: resolve,
      contentState: normalized.contentState,
      scheduleDiagram: this.host.scheduleDiagram,
      onOpenLink: (href) => {if (!this.destroyed && this.activeDocument === normalized.documentId) this.host.openLink?.(href, normalized.documentPath);},
      onEvent: (event) => {if (!this.destroyed && this.activeDocument === normalized.documentId) this.host.onEvent?.({ ...event, documentPath: normalized.documentPath });},
    });
    if (signal.aborted) return;
    if (follow) scroll.scrollTop = scroll.scrollHeight;
    else if (this.host.scrollBehavior === "host") { /* Host owns position. */ }
    else if (anchor && this.root.contains(anchor) && anchorTop !== undefined) scroll.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
    else if (scrollTop !== 0) scroll.scrollTop = scrollTop;
    if (this.host.renderers) await mountRenderers(this.root, pending.length ? {...this.host.renderers, image: undefined} : this.host.renderers, {documentId: normalized.documentId, revision: normalized.revision, signal}, this.host.onError);
    if (signal.aborted) return;
    if (focused && this.root.contains(focused)) focused.focus({preventScroll: true});
    const updates = pending.map(async (item, index) => {
      const node = this.root.querySelector<HTMLElement>(`[data-tegg-resource-src="${index}"], [data-tegg-resource-poster="${index}"]`);
      const attribute = node?.getAttribute("data-tegg-resource-poster") === String(index) ? "poster" : "src";
      const url = await item.resolved;
      if (signal.aborted || !node || !this.root.contains(node)) return;
      const allowed = url && allowedImageURL(url, this.host.resourcePolicy);
      if (allowed) {node.setAttribute(attribute, allowed); node.dataset.resourceState = "ready";}
      else node.dataset.resourceState = "blocked";
    });
    await new Promise<void>((resolve, reject) => {
      const cancel = () => resolve();
      signal.addEventListener("abort", cancel, {once: true});
      Promise.all(updates).then(() => {signal.removeEventListener("abort", cancel); resolve();}, error => {signal.removeEventListener("abort", cancel); reject(error);});
    });
    // Image extensions receive the authorized resolved URL, not an empty transient DTO.
    if(!signal.aborted && pending.length && this.host.renderers?.image) await mountRenderers(this.root,this.host.renderers,{documentId:normalized.documentId,revision:normalized.revision,signal},this.host.onError);
  }
}
