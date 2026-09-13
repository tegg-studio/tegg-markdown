import {calloutTypes, resolveCallout} from "./callouts";
import {calloutRanges} from "./calloutEditing";
import {dispatchSourcePatches} from "./editorPatches";
import {Compartment, EditorState} from "@codemirror/state";
import {EditorView, keymap} from "@codemirror/view";
import {markdown} from "@codemirror/lang-markdown";
import {GFM} from "@lezer/markdown";
import {indentWithTab, undo, redo} from "@codemirror/commands";
import {editorSetup} from "./editorSetup";
import {livePreview} from "./livePreview";
import {resourceContext} from "./editorHost";
import {executeEditorCommand} from "./editorToolbar";
import {TechnicalMarkdownReader, type ReaderHost} from "./reader";
import {createAttribution, type AttributionPlacement} from "./attribution";
import {observeTypography} from "./typography";
import {technicalMarkdownProfile} from "./syntaxContract";

export type EditorMode = "reader" | "live" | "source";
export type EditorDocument = {
  documentId: string; revision: string; source: string;
  documentPath?: string; contentState?: "streaming" | "settled";
};
export type DraftChange = {
  documentId: string; baseRevision: string; source: string;
  generation: string; sequence: number;
};
export type UpdateResult = "applied" | "unchanged" | "conflict" | "composing";
export type EditorHost = ReaderHost & {
  attribution?: AttributionPlacement;
  onChange?(change: DraftChange): void;
  onConflict?(incoming: EditorDocument, local: DraftChange): void;
  onError?(error: unknown): void;
  copyText?(text: string): void | Promise<void>;
};

export class TeggMarkdownEditor {
  private readonly frame = document.createElement("div");
  private readonly editorRoot = document.createElement("div");
  private readonly readerRoot = document.createElement("div");
  private readonly preview = new Compartment();
  private readonly editable = new Compartment();
  private readonly reader: TechnicalMarkdownReader;
  private readonly stopTypography: () => void;
  private viewValue: EditorView;
  private document: EditorDocument;
  private modeValue: EditorMode;
  private generation = crypto.randomUUID();
  private sequence = 0;
  private acknowledgedSequence = 0;
  private savedSource: string;
  private destroyed = false;
  private composing = false;
  private calloutMenu?: HTMLSelectElement;
  private compositionTimer?: ReturnType<typeof setTimeout>;

  constructor(root: HTMLElement, input: EditorDocument, private readonly host: EditorHost = {}, mode: EditorMode = "live") {
    this.validate(input);
    this.document = {...input}; this.savedSource = input.source;
    this.modeValue = input.contentState === "streaming" ? "reader" : mode;
    this.frame.className = "tegg-sdk-frame tegg-surface";
    this.editorRoot.className = "tegg-sdk-content tegg-sdk-editor tegg-surface";
    this.readerRoot.className = "tegg-sdk-content";
    this.frame.append(this.readerRoot, this.editorRoot);
    const attribution = createAttribution(host.attribution); if (attribution) this.frame.append(attribution);
    root.append(this.frame);
    this.stopTypography = observeTypography(this.editorRoot);
    this.reader = new TechnicalMarkdownReader(this.readerRoot, host);
    this.viewValue = new EditorView({parent: this.editorRoot, state: this.createState(input)});
    this.frame.addEventListener("tegg-open-link", this.openLink);
    this.frame.addEventListener("tegg-copy-text", this.copyText);
    this.frame.addEventListener("tegg-callout-menu", this.openCalloutMenu);
    this.applyMode();
  }
  private validate(input: EditorDocument) {
    if (!input || typeof input.documentId !== "string" || typeof input.revision !== "string" || typeof input.source !== "string")
      throw new TypeError("documentId, revision and source must be strings");
    if (input.documentPath !== undefined && typeof input.documentPath !== "string") throw new TypeError("documentPath must be a string");
    if (input.contentState !== undefined && !["streaming","settled"].includes(input.contentState)) throw new TypeError("Invalid contentState");
  }
  private assertAlive() { if (this.destroyed) throw new Error("Editor has been destroyed"); }
  private report(error: unknown) { this.host.onError?.(error); }
  private openLink = (event: Event) => {
    event.preventDefault(); event.stopPropagation();
    this.host.openLink?.((event as CustomEvent<string>).detail, this.document.documentPath ?? "");
  };
  private copyText = (event: Event) => {
    if (!this.host.copyText) return;
    event.preventDefault(); event.stopPropagation();
    try { Promise.resolve(this.host.copyText((event as CustomEvent<string>).detail)).catch(error => this.report(error)); }
    catch (error) { this.report(error); }
  };
  private openCalloutMenu = (event: Event) => {
    event.stopPropagation();
    if (this.modeValue !== "live" || this.composing || this.viewValue.composing) return;
    const detail = (event as CustomEvent<{from:number;x:number;y:number}>).detail;
    const range = calloutRanges(this.viewValue.state).find(item => item.from === detail.from || item.headerFrom === detail.from);
    if (!range) return;
    this.calloutMenu?.remove();
    const source = this.viewValue.state.doc;
    const menu = document.createElement("select"); this.calloutMenu = menu;
    menu.className = "tegg-sdk-callout-menu"; menu.size = 8;
    menu.setAttribute("aria-label", "Callout type");
    for (const type of calloutTypes) {
      const option = document.createElement("option");option.value=type.id;option.textContent=type.label;menu.append(option);
    }
    menu.value = resolveCallout(range.type).id;
    menu.style.left = Math.max(8, Math.min(detail.x, window.innerWidth - 200)) + "px";
    menu.style.top = Math.max(8, Math.min(detail.y, window.innerHeight - 260)) + "px";
    menu.addEventListener("change", () => {
      if (!this.destroyed && !this.composing && source === this.viewValue.state.doc)
        dispatchSourcePatches(this.viewValue, [{from:range.typeFrom,to:range.typeTo,insert:menu.value,expected:range.rawType}], {isolateHistory:true});
      menu.remove(); this.calloutMenu=undefined; this.viewValue.focus();
    });
    menu.addEventListener("blur", () => {queueMicrotask(() => {if(menu.isConnected)menu.remove(); if(this.calloutMenu===menu)this.calloutMenu=undefined;});});
    menu.addEventListener("keydown", event => {if(event.key==="Escape"){event.preventDefault();menu.remove();this.viewValue.focus();}});
    this.frame.append(menu); menu.focus();
  };
  private createState(input: EditorDocument): EditorState {
    return EditorState.create({doc: input.source, extensions: [
      editorSetup, markdown({extensions: GFM}), EditorView.lineWrapping,
      EditorState.lineSeparator.of(input.source.includes("\r\n") ? "\r\n" : "\n"),
      keymap.of([indentWithTab]),
      resourceContext.of({documentPath: input.documentPath ?? "", resolveImage: this.host.resolveImage}),
      EditorView.contentAttributes.of({"aria-label":"Markdown Editor"}),
      this.preview.of(this.modeValue === "live" ? livePreview : []),
      this.editable.of([EditorView.editable.of(input.contentState !== "streaming"), EditorState.readOnly.of(input.contentState === "streaming")]),
      EditorView.domEventHandlers({
        compositionstart: () => { this.composing = true; },
        compositionend: () => {
          clearTimeout(this.compositionTimer);
          this.compositionTimer = setTimeout(() => {this.composing = false;}, 30);
        }
      }),
      EditorView.updateListener.of(update => {
        if (!update.docChanged) return;
        this.document.source = update.state.sliceDoc();
        this.sequence++;
        const change = this.snapshot();
        queueMicrotask(() => {
          if (this.destroyed || change.generation !== this.generation) return;
          try {this.host.onChange?.(change);} catch (error) {this.report(error);}
        });
      })
    ]});
  }
  /** Advanced CodeMirror integration. Direct edits still emit onChange. */
  get view(): EditorView { this.assertAlive(); return this.viewValue; }
  get source(): string { return this.document.source; }
  get dirty(): boolean { return this.source !== this.savedSource; }
  get mode(): EditorMode { return this.modeValue; }
  snapshot(): DraftChange {
    this.assertAlive();
    return {documentId:this.document.documentId, baseRevision:this.document.revision,
      source:this.source, generation:this.generation, sequence:this.sequence};
  }
  /** Reject dirty external replacements. Explicit user conflict resolution may use replaceDocument. */
  update(input: EditorDocument): UpdateResult {
    this.assertAlive(); this.validate(input);
    if (this.composing || this.viewValue.composing) return "composing";
    if (JSON.stringify(input) === JSON.stringify(this.document)) return "unchanged";
    if (this.dirty) {
      this.host.onConflict?.({...input}, this.snapshot()); return "conflict";
    }
    return this.replaceDocument(input);
  }
  /** Explicitly discards the draft and resets undo; Host must resolve conflicts before calling. */
  replaceDocument(input: EditorDocument): UpdateResult {
    this.assertAlive(); this.validate(input);
    if (this.composing || this.viewValue.composing) return "composing";
    this.document = {...input}; this.savedSource = input.source;
    this.generation = crypto.randomUUID(); this.sequence = 0; this.acknowledgedSequence = 0;
    if (input.contentState === "streaming") this.modeValue = "reader";
    this.viewValue.setState(this.createState(input));
    this.applyMode(); return "applied";
  }
  /** Acknowledge the exact saved snapshot. A later local edit remains dirty. */
  acknowledgeSaved(saved: DraftChange, newRevision: string): boolean {
    this.assertAlive();
    if (typeof newRevision !== "string") throw new TypeError("newRevision must be a string");
    if (saved.documentId !== this.document.documentId || saved.generation !== this.generation ||
        saved.baseRevision !== this.document.revision || saved.sequence < this.acknowledgedSequence ||
        saved.sequence > this.sequence) return false;
    this.savedSource = saved.source; this.document.revision = newRevision;
    this.acknowledgedSequence = saved.sequence;
    return true;
  }
  setMode(mode: EditorMode): boolean {
    this.assertAlive();
    if (!["reader","live","source"].includes(mode)) throw new TypeError("Invalid mode");
    if (this.composing || this.viewValue.composing || (this.document.contentState === "streaming" && mode !== "reader")) return false;
    this.modeValue = mode; this.applyMode(); return true;
  }
  private applyMode() {
    this.calloutMenu?.remove(); this.calloutMenu=undefined;
    this.editorRoot.dataset.mode = this.modeValue;
    this.readerRoot.hidden = this.modeValue !== "reader"; this.editorRoot.hidden = this.modeValue === "reader";
    this.viewValue.dispatch({effects:this.preview.reconfigure(this.modeValue === "live" ? livePreview : [])});
    if (this.modeValue === "reader") void this.reader.render({
      ...this.document, profileVersion:technicalMarkdownProfile.version
    }).catch(error => this.report(error));
  }
  command(command: string): boolean {
    this.assertAlive();
    if (this.modeValue === "reader" || this.composing || this.viewValue.composing || this.document.contentState === "streaming") return false;
    this.viewValue.focus();
    if (command === "undo") return undo(this.viewValue);
    if (command === "redo") return redo(this.viewValue);
    executeEditorCommand(this.viewValue, command); return true;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; clearTimeout(this.compositionTimer);
    this.frame.removeEventListener("tegg-open-link", this.openLink);
    this.frame.removeEventListener("tegg-copy-text", this.copyText);
    this.frame.removeEventListener("tegg-callout-menu", this.openCalloutMenu);
    this.viewValue.destroy(); this.reader.destroy(); this.stopTypography(); this.frame.remove();
  }
}
