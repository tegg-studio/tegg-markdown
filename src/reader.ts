import {observeSurfaceAppearance} from "./appearance";
import {renderDiagram} from "./renderKit";
import {disposeInteractions} from "./renderInteraction";
import { renderMarkdown, type ReaderContentState, type ReaderEvent, type RenderMarkdownOptions } from "./markdown";
import { appearanceScale, appearanceWidth, observeTypography } from "./typography";
import { technicalMarkdownProfile } from "./syntaxContract";

export type ReaderInput = {
  documentId?: string;
  source: string;
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

export type ReaderHost = {
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
  private stopObserving: () => void;
  private stopTheme: () => void;
  constructor(private readonly root: HTMLElement, private readonly host: ReaderHost = {}) {
    root.classList.add("tegg-reader");
    this.stopObserving = observeTypography(root);
    const update = () => {
      for (const canvas of root.querySelectorAll<HTMLElement>('.diagram-canvas[data-engine="mermaid"]:not(.md-object-content *)')) {
        const source = canvas.closest(".diagram")?.querySelector(".diagram-source code")?.textContent;
        if (source != null) void renderDiagram({kind:"diagram",engine:"mermaid",source},canvas);
      }
    };
    this.stopTheme = observeSurfaceAppearance(root, update);
  }
  destroy() { this.stopObserving(); this.stopTheme(); disposeInteractions(this.root); this.root.replaceChildren(); }

  async render(input: ReaderInput) {
    const normalized = normalizeReaderInput(input);
    if (normalized.profileVersion !== technicalMarkdownProfile.version) {
      throw new Error(`Unsupported Markdown profile: ${normalized.profileVersion}`);
    }
    this.root.style.setProperty("--reader-font-scale", String(normalized.fontScale));
    this.root.style.setProperty("--reader-content-width", `${normalized.contentWidth}px`);
    this.root.dataset.contentState = normalized.contentState;
    await renderMarkdown(normalized.source, this.root, {
      enhancedInteractions: this.host.enhancedInteractions,
      documentPath: normalized.documentPath,
      resolveImage: (src, path) => this.host.resolveImage?.(src, path) ?? src,
      contentState: normalized.contentState,
      scheduleDiagram: this.host.scheduleDiagram,
      onOpenLink: (href) => this.host.openLink?.(href, normalized.documentPath),
      onEvent: (event) => this.host.onEvent?.({ ...event, documentPath: normalized.documentPath }),
    });
  }
}
