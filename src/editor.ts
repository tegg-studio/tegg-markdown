import {detectNewlinePolicy} from "./newlinePolicy";
import {editingPerformancePolicy} from "./editingBudget";
import {createDocumentConflict,planDocumentReconciliation,type DocumentConflict,type ConflictDecision,type DocumentVersion,type ReconciliationPlan} from "./documentDiff";
import type {RecoveryJournal,RecoveryReason} from "./recoveryJournal";
import {EditingController} from "./editingController";
import {getSupportedCommands,getCommandStatus,type CommandStatus} from "./commandRegistry";
import {disposeInteractions} from "./renderInteraction";
import {bindEngines} from "./renderEngines";
import {bindUI, type UIOptions, setUIText, setUILabel} from "./uiContext";
import {allowedImageURL} from "./resources";
import {resolveProfile, type MarkdownProfile} from "./syntaxProfiles";
import {calloutTypes, resolveCallout} from "./callouts";
import {calloutRanges} from "./calloutEditing";
import {dispatchSourcePatches} from "./editorPatches";
import {Compartment, EditorState} from "@codemirror/state";
import {EditorView, keymap} from "@codemirror/view";
import {markdown} from "@codemirror/lang-markdown";
import {GFM} from "@lezer/markdown";
import {indentWithTab, undo, redo, undoDepth, redoDepth} from "@codemirror/commands";
import {editorSetup} from "./editorSetup";
import {livePreview} from "./livePreview";
import {resourceContext} from "./editorHost";
import {executeEditorCommand, editorToolbarState, type EditorToolbarState} from "./editorToolbar";
import {HeadingIndex, type OutlineHeading} from "./headingIndex";
import {resolveHeadingLink} from "./linkNavigation";
import {editCurrentLink} from "./liveLinks";
import {appearanceScale, appearanceWidth} from "./typography";
import {TechnicalMarkdownReader, type ReaderHost, type SelectionReference} from "./reader";
import {createAttribution, type AttributionPlacement} from "./attribution";
import {observeTypography} from "./typography";
import {technicalMarkdownProfile} from "./syntaxContract";

export type EditorMode = "reader" | "live" | "source";
export type EditorDocument = {
  documentId: string; revision: string; source: string; profile?: MarkdownProfile;
  documentPath?: string; contentState?: "streaming" | "settled";
};
export type DraftChange = {
  documentId: string; baseRevision: string; source: string;
  generation: string; sequence: number;
};
export type OutlineSnapshot = {documentId: string; generation: string; sequence: number; headings: OutlineHeading[]};
export type EditorUIState = EditorToolbarState & {mode: EditorMode; dirty: boolean; toolbarEnabled: boolean; canUndo: boolean; canRedo: boolean; profile: MarkdownProfile; commands: readonly string[]};
export type EditorAppearance = {fontScale?: number; contentWidth?: number; toolbarInset?: number;
  background?: string; text?: string; muted?: string; border?: string; accent?: string; accentSoft?: string};
export type CalloutMenuRequest = {current: string; x: number; y: number; viewportWidth: number};
export {getSupportedCommands,getCommandStatus} from "./commandRegistry";
export type {CommandStatus} from "./commandRegistry";
export type SaveState = "saved"|"dirty"|"saving"|"error"|"conflict";
export type UpdateResult = "applied" | "unchanged" | "conflict" | "composing";
export type EditorHost = ReaderHost & {
  attribution?: AttributionPlacement;
  onStateChange?(state: EditorUIState): void;
  onOutlineChange?(outline: OutlineSnapshot): void;
  /** Native Hosts may supply a menu. A stale response cannot change a newer draft. */
  selectCalloutType?(request: CalloutMenuRequest): Promise<string | null>;
  onChange?(change: DraftChange): void;
  recoveryJournal?: RecoveryJournal;
  onSaveStateChange?(state:SaveState):void;
  onConflict?(incoming: EditorDocument, local: DraftChange): void;
  onError?(error: unknown): void;
  copyText?(text: string): void | Promise<void>;
};

export class TeggMarkdownEditor {
  private readonly frame = document.createElement("div");
  private readonly editorRoot = document.createElement("div");
  private readonly readerRoot = document.createElement("div");
  private readonly budgetNotice = document.createElement("p");
  private readonly preview = new Compartment();
  private readonly editable = new Compartment();
  private readonly reader: TechnicalMarkdownReader;
  private readonly stopTypography: () => void;
  readonly editing: EditingController;
  private issuedSnapshots = new Map<number,{baseRevision:string;source:string}>();
  private viewValue: EditorView;
  private document: EditorDocument;
  private modeValue: EditorMode;
  private generation = crypto.randomUUID();
  private sequence = 0;
  private acknowledgedSequence = 0;
  private savedSource: string;
  private saveStateValue:SaveState="saved";
  private conflictValue:DocumentConflict|null=null;
  private stopEngines: () => void;
  private ui: ReturnType<typeof bindUI>;
  private destroyed = false;
  private composing = false;
  private accessible = false;
  private appearance: EditorAppearance = {};
  private headings = new HeadingIndex();
  private outlineTimer?: ReturnType<typeof setTimeout>;
  private stateQueued = false;
  private lastState = "";
  private renderReady: Promise<void> = Promise.resolve();
  private modeEpoch = 0;
  private calloutMenu?: HTMLSelectElement;
  private compositionTimer?: ReturnType<typeof setTimeout>;

  constructor(root: HTMLElement, input: EditorDocument, private readonly host: EditorHost = {}, mode: EditorMode = "live") {
    this.validate(input);
    this.document = {...input}; this.savedSource = input.source;
    this.modeValue = input.contentState === "streaming" ? "reader" : mode;
    this.frame.className = "tegg-sdk-frame tegg-surface";
    this.frame.dataset.layout = host.layout ?? "internal"; this.frame.dataset.chrome = host.chrome ?? "default";
    this.editorRoot.className = "tegg-sdk-content tegg-sdk-editor tegg-surface";
    this.readerRoot.className = "tegg-sdk-content";
    this.budgetNotice.className="tegg-editor-budget";this.budgetNotice.hidden=true;this.budgetNotice.setAttribute("role","status");setUIText(this.budgetNotice,"Large document: source preview is shown to keep the interface responsive.");
    this.frame.append(this.budgetNotice,this.readerRoot, this.editorRoot);
    const attribution = createAttribution(host.attribution); if (attribution) this.frame.append(attribution);
    root.append(this.frame);
    this.ui = bindUI(this.frame, host);
    this.stopEngines = bindEngines(this.frame, host.engines);
    this.stopTypography = observeTypography(this.editorRoot);
    this.readerRoot.tabIndex = -1;
    setUILabel(this.readerRoot, "Markdown Reader");
    this.reader = new TechnicalMarkdownReader(this.readerRoot, new Proxy(host,{get: (target,key) => key === "openLink" ? (href: string) => this.handleLink(href) : Reflect.get(target,key)}));
    this.viewValue = new EditorView({parent: this.editorRoot, state: this.createState(input)});
    this.editing=new EditingController(this.viewValue,{identity:()=>({documentId:this.document.documentId,generation:this.generation,sequence:this.sequence,profile:this.document.profile,mode:this.modeValue,readOnly:this.document.contentState==="streaming"})});
    this.frame.addEventListener("tegg-open-link", this.openLink);
    this.frame.addEventListener("tegg-copy-text", this.copyText);
    this.frame.addEventListener("tegg-callout-menu", this.openCalloutMenu);
    this.frame.addEventListener("focusin", this.queueState);
    this.frame.addEventListener("focusout", this.queueState);
    this.setAppearance({}); this.applyMode(); this.queueState(); this.queueOutline();
  }
  private validate(input: EditorDocument) {
    resolveProfile(input?.profile);
    if (!input || typeof input.documentId !== "string" || typeof input.revision !== "string" || typeof input.source !== "string")
      throw new TypeError("documentId, revision and source must be strings");
    if (input.documentPath !== undefined && typeof input.documentPath !== "string") throw new TypeError("documentPath must be a string");
    if (input.contentState !== undefined && !["streaming","settled"].includes(input.contentState)) throw new TypeError("Invalid contentState");
  }
  private assertAlive() { if (this.destroyed) throw new Error("Editor has been destroyed"); }
  private report(error: unknown) { this.host.onError?.(error); }
  private openLink = (event: Event) => {
    event.preventDefault(); event.stopPropagation();
    this.handleLink((event as CustomEvent<string>).detail);
  };
  private handleLink(href: string) {
    if (href.startsWith("#")) {
      let fragment = href.slice(1); try {fragment = decodeURIComponent(fragment);} catch { /* use literal */ }
      void this.navigateFragment(fragment).then(found => {if (!found && !this.destroyed) this.host.openLink?.(href, this.document.documentPath ?? "");}).catch(error => this.report(error));
    } else this.host.openLink?.(href, this.document.documentPath ?? "");
  }
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
    const generation = this.generation;
    if (this.host.selectCalloutType) {
      Promise.resolve().then(() => this.host.selectCalloutType!({current:range.type, x:detail.x, y:detail.y, viewportWidth:window.innerWidth})).then(type => {
        if (this.destroyed || this.generation !== generation || this.modeValue !== "live" || this.composing || this.viewValue.composing || source !== this.viewValue.state.doc) return;
        if (type && calloutTypes.some(item => item.id === type))
          dispatchSourcePatches(this.viewValue, [{from:range.typeFrom,to:range.typeTo,insert:type,expected:range.rawType}], {isolateHistory:true});
        this.viewValue.focus();
      }).catch(error => this.report(error));
      return;
    }
    const menu = document.createElement("select"); this.calloutMenu = menu;
    menu.className = "tegg-sdk-callout-menu"; menu.size = 8;
    setUILabel(menu, "Callout type");
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
  private mixedNewlines(source:string){return detectNewlinePolicy(source).readOnly;}
  private createState(input: EditorDocument): EditorState {
    return EditorState.create({doc: input.source, extensions: [
      editorSetup, markdown({extensions: GFM}), EditorView.lineWrapping,
      EditorState.lineSeparator.of(input.source.includes("\r\n") ? "\r\n" : "\n"),
      keymap.of([indentWithTab]),
      resourceContext.of({documentPath: input.documentPath ?? "", profile: input.profile, engines: this.host.engines, resolveImage: (src, path) => allowedImageURL(this.host.resolveImage?.(src, path) ?? src, this.host.resourcePolicy) ?? ""}),
      EditorView.contentAttributes.of({"aria-label":"Markdown Editor"}),
      this.preview.of(this.modeValue === "live" && !this.accessible && !editingPerformancePolicy(input.source).sourcePreview ? livePreview : []),
      this.editable.of([EditorView.editable.of(input.contentState !== "streaming" && !this.mixedNewlines(input.source)), EditorState.readOnly.of(input.contentState === "streaming" || this.mixedNewlines(input.source))]),
      EditorView.domEventHandlers({
        compositionstart: () => { this.composing = true; this.queueState(); },
        compositionend: () => {
          clearTimeout(this.compositionTimer);
          this.compositionTimer = setTimeout(() => {this.composing = false; this.queueState();}, 30);
        }
      }),
      EditorView.updateListener.of(update => {
        if (update.docChanged || update.selectionSet || update.focusChanged) this.queueState();
        if (update.selectionSet) {try {this.host.onSelection?.(this.selection());} catch(error) {this.report(error);}}
        if (!update.docChanged) return;
        const beforeBudget=editingPerformancePolicy(this.document.source).sourcePreview;
        this.document.source = update.state.sliceDoc();
        if(beforeBudget!==(editingPerformancePolicy(this.document.source).sourcePreview))queueMicrotask(()=>{if(!this.destroyed)this.applyMode();});
        this.sequence++; this.queueOutline();
        this.setSaveState(this.conflictValue?"conflict":this.dirty?"dirty":"saved");
        if(this.dirty)this.checkpointRecovery(this.conflictValue?"conflict":"dirty");
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
    this.issuedSnapshots.set(this.sequence,{baseRevision:this.document.revision,source:this.source});
    if(this.issuedSnapshots.size>32)this.issuedSnapshots.delete(this.issuedSnapshots.keys().next().value!);
    return {documentId:this.document.documentId, baseRevision:this.document.revision,
      source:this.source, generation:this.generation, sequence:this.sequence};
  }
  /** Reject dirty external replacements. Explicit user conflict resolution may use replaceDocument. */
  update(input: EditorDocument): UpdateResult {
    this.assertAlive(); this.validate(input);
    if (this.composing || this.viewValue.composing) return "composing";
    if ((["documentId", "revision", "source", "documentPath", "contentState", "profile"] as const).every(key => input[key] === this.document[key])) return "unchanged";
    if (this.dirty) {
      if(input.documentId===this.document.documentId){this.conflictValue=createDocumentConflict({base:{documentId:this.document.documentId,revision:this.document.revision,source:this.savedSource},local:this.snapshot(),incoming:input});this.setSaveState("conflict");this.checkpointRecovery("conflict");}
      this.host.onConflict?.({...input}, this.snapshot()); return "conflict";
    }
    return this.replaceDocument(input);
  }
  /** Explicitly discards the draft and resets undo; Host must resolve conflicts before calling. */
  replaceDocument(input: EditorDocument): UpdateResult {
    this.assertAlive(); this.validate(input);
    if (this.composing || this.viewValue.composing) return "composing";
    this.document = {...input}; this.savedSource = input.source;this.conflictValue=null;this.setSaveState("saved");
    this.headings = new HeadingIndex();
    this.generation = crypto.randomUUID(); this.sequence = 0; this.acknowledgedSequence = 0;
    if (input.contentState === "streaming") this.modeValue = "reader";
    this.issuedSnapshots.clear();
    this.viewValue.setState(this.createState(input));
    this.editing.reset();
    this.applyMode(); this.queueState(); this.queueOutline(); return "applied";
  }
  /** Acknowledge the exact saved snapshot. A later local edit remains dirty. */
  acknowledgeSaved(saved: DraftChange, newRevision: string): boolean {
    this.assertAlive();
    if (typeof newRevision !== "string") throw new TypeError("newRevision must be a string");
    if(this.conflictValue)return false;
    const issued=this.issuedSnapshots.get(saved.sequence);
    if(!issued||issued.source!==saved.source||issued.baseRevision!==saved.baseRevision)return false;
    if (saved.documentId !== this.document.documentId || saved.generation !== this.generation ||
        saved.baseRevision !== this.document.revision || saved.sequence < this.acknowledgedSequence ||
        saved.sequence > this.sequence) return false;
    this.savedSource = saved.source; this.document.revision = newRevision;
    this.acknowledgedSequence = saved.sequence; this.issuedSnapshots.clear(); this.setSaveState(this.dirty?"dirty":"saved");this.queueState();
    if(this.dirty)this.checkpointRecovery("dirty");
    return true;
  }
  get saveState():SaveState{return this.saveStateValue;}
  get conflict():DocumentConflict|null{return this.conflictValue;}
  private setSaveState(state:SaveState){if(this.saveStateValue===state)return;this.saveStateValue=state;queueMicrotask(()=>{if(!this.destroyed){try{this.host.onSaveStateChange?.(state);}catch(error){this.report(error);}}});}
  /** Begin a Host save attempt. Disk I/O and CAS remain the Host's responsibility. */
  beginSave():DraftChange {this.assertAlive();if(this.conflictValue)throw new Error("Resolve the incoming revision before saving over the original.");this.setSaveState("saving");return this.snapshot();}
  markSaveFailed(error?:unknown){this.assertAlive();this.setSaveState(this.conflictValue?"conflict":"error");this.checkpointRecovery(this.conflictValue?"conflict":"save-failed");if(error)this.report(error);}
  checkpointRecovery(reason:RecoveryReason="dirty"){
    if(!this.host.recoveryJournal||this.destroyed)return;
    const source=this.source,crlf=source.includes("\r\n"),bare=/([^\r]|^)\n/.test(source);
    try{this.host.recoveryJournal.schedule({documentId:this.document.documentId,documentPath:this.document.documentPath,generation:this.generation,sequence:this.sequence,baseRevision:this.document.revision,baseSource:this.savedSource,draftSource:source,encoding:"utf-8",bom:source.startsWith("\ufeff"),newline:crlf?(bare?"mixed":"crlf"):"lf",reason});}catch(error){this.report(error);}
  }
  /** Host must re-read its persisted revision immediately before invoking this operation. */
  reconcile(conflict:DocumentConflict,decisions:Readonly<Record<string,ConflictDecision>>,incoming:DocumentVersion):ReconciliationPlan {
    this.assertAlive();
    if(this.composing||this.viewValue.composing||this.viewValue.state.readOnly)return {status:"rejected",reason:"editing-disabled",patches:[],nextBaseline:null};
    const plan=planDocumentReconciliation(conflict,decisions,{local:this.snapshot(),incoming});
    if(plan.status==="rejected")return plan;
    if(plan.source.replace(/\r\n/g,"\n").replace(/\n/g,this.viewValue.state.lineBreak)!==plan.source)return {status:"rejected",reason:"incompatible-newlines",patches:[],nextBaseline:null};
    const old=this.source,toCM=(offset:number)=>old.slice(0,offset).replace(/\r\n/g,"\n").length;
    if(plan.patches.length)dispatchSourcePatches(this.viewValue,plan.patches.map(patch=>({from:toCM(patch.from),to:toCM(patch.to),expected:old.slice(patch.from,patch.to).replace(/\r\n/g,"\n"),insert:patch.insert.replace(/\r\n/g,"\n")})),{isolateHistory:true});
    if(this.source!==plan.source)throw new Error("Reconciliation could not preserve the source newline contract");
    if(plan.status==="ready"){
      this.savedSource=incoming.source;this.document.revision=incoming.revision;this.conflictValue=null;this.issuedSnapshots.clear();this.editing.reset();this.setSaveState(this.dirty?"dirty":"saved");
    }else{this.conflictValue=createDocumentConflict({base:conflict.base,local:this.snapshot(),incoming});this.setSaveState("conflict");}
    this.checkpointRecovery(plan.status==="ready"?"dirty":"conflict");this.queueState();return plan;
  }
  setMode(mode: EditorMode): boolean {
    this.assertAlive();
    if (!["reader","live","source"].includes(mode)) throw new TypeError("Invalid mode");
    if (this.composing || this.viewValue.composing || (this.document.contentState === "streaming" && mode !== "reader")) return false;
    if (mode === this.modeValue) return true;
    const previous = this.scrollElement;
    const ratio = previous.scrollTop / Math.max(1, previous.scrollHeight - previous.clientHeight);
    this.modeValue = mode; this.applyMode(); this.queueState();
    const epoch = this.modeEpoch;
    void this.ready().then(() => requestAnimationFrame(() => {
      if (this.destroyed || epoch !== this.modeEpoch) return;
      const next = this.scrollElement; next.scrollTop = ratio * Math.max(0, next.scrollHeight - next.clientHeight);
    }));
    return true;
  }
  private applyMode() {
    disposeInteractions(this.frame);
    this.modeEpoch++;
    this.budgetNotice.hidden=this.modeValue!=="live"||!editingPerformancePolicy(this.source).sourcePreview;
    this.calloutMenu?.remove(); this.calloutMenu=undefined;
    this.editorRoot.dataset.mode = this.modeValue;
    this.readerRoot.hidden = this.modeValue !== "reader"; this.editorRoot.hidden = this.modeValue === "reader";
    this.viewValue.dispatch({effects:this.preview.reconfigure(this.modeValue === "live" && !this.accessible && !editingPerformancePolicy(this.source).sourcePreview ? livePreview : [])});
    if (this.modeValue === "reader") this.renderReady = this.reader.render({
      ...this.document, fontScale:this.appearance.fontScale, contentWidth:this.appearance.contentWidth,
      profileVersion:technicalMarkdownProfile.version
    }).catch(error => this.report(error));
  }
  command(command: string): boolean {
    this.assertAlive();
    if (!this.commandStatus(command).enabled) return false;
    this.viewValue.focus();
    if (command === "undo") return undo(this.viewValue);
    if (command === "redo") return redo(this.viewValue);
    if (command === "link" && this.modeValue === "live" && editCurrentLink(this.viewValue)) return true;
    executeEditorCommand(this.viewValue, command); return true;
  }
  commandStatus(command: string): CommandStatus {
    this.assertAlive();
    return getCommandStatus(command, this.state);
  }
  /** Current Host toolbar state; independent widget inputs keep their own editing focus. */
  get state(): EditorUIState {
    this.assertAlive();
    const active = document.activeElement;
    const independent = this.frame.contains(active) && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement);
    const enabled = !this.viewValue.state.readOnly && this.modeValue !== "reader" && this.document.contentState !== "streaming" && !this.composing && !this.viewValue.composing && !independent;
    return {...editorToolbarState(this.viewValue.state), profile:this.document.profile ?? "tegg", commands:getSupportedCommands(this.document.profile), mode:this.modeValue, dirty:this.dirty, toolbarEnabled:enabled,
      canUndo:enabled && undoDepth(this.viewValue.state) > 0, canRedo:enabled && redoDepth(this.viewValue.state) > 0};
  }
  private queueState = () => {
    // Hosts without a toolbar subscriber can read state explicitly when needed.
    if (!this.host.onStateChange || this.stateQueued || this.destroyed) return;
    this.stateQueued = true;
    queueMicrotask(() => {
      this.stateQueued = false; if (this.destroyed) return;
      const state = this.state; const signature = JSON.stringify(state);
      if (signature === this.lastState) return;
      this.lastState = signature;
      try {this.host.onStateChange?.(state);} catch (error) {this.report(error);}
    });
  };
  selection(): SelectionReference {
    this.assertAlive(); const selection = this.viewValue.state.selection.main;
    const from = this.viewValue.state.sliceDoc(0,selection.from).length;
    const to = this.viewValue.state.sliceDoc(0,selection.to).length;
    return {documentId:this.document.documentId,revision:this.document.revision,generation:this.generation,sequence:this.sequence,text:this.source.slice(from,to),range:{from,to}};
  }
  outline(): OutlineSnapshot {
    this.assertAlive();
    return {documentId:this.document.documentId, generation:this.generation, sequence:this.sequence,
      headings:this.headings.update(this.source, this.document.profile).map(item => ({...item}))};
  }
  private queueOutline() {
    if (!this.host.onOutlineChange) return;
    clearTimeout(this.outlineTimer);
    this.outlineTimer = setTimeout(() => {
      if (this.destroyed) return;
      try {this.host.onOutlineChange?.(this.outline());} catch (error) {this.report(error);}
    }, 150);
  }
  get scrollElement(): HTMLElement {this.assertAlive(); return this.modeValue === "reader" ? this.readerRoot : this.viewValue.scrollDOM;}
  /** Wait for the current Reader render before inspecting or navigating its DOM. */
  async ready(): Promise<void> {await this.renderReady;}
  async navigateHeading(id: string, snapshot: OutlineSnapshot = this.outline()): Promise<boolean> {
    this.assertAlive();
    if (snapshot.documentId !== this.document.documentId || snapshot.generation !== this.generation || snapshot.sequence !== this.sequence) return false;
    const target = this.headings.update(this.source, this.document.profile).find(item => item.id === id);
    return target ? this.navigateTarget(target) : false;
  }
  async navigateFragment(fragment: string): Promise<boolean> {
    this.assertAlive(); const target = resolveHeadingLink(this.source, fragment, this.document.profile);
    return target ? this.navigateTarget(target) : false;
  }
  private async navigateTarget(target: {from:number; anchor:string}): Promise<boolean> {
    if (this.composing || this.viewValue.composing) return false;
    const identity = this.generation, sequence = this.sequence, modeEpoch = this.modeEpoch;
    await this.ready();
    if (this.destroyed || identity !== this.generation || sequence !== this.sequence || modeEpoch !== this.modeEpoch || this.composing || this.viewValue.composing) return false;
    this.modeEpoch++;
    this.budgetNotice.hidden=this.modeValue!=="live"||!editingPerformancePolicy(this.source).sourcePreview; // Explicit navigation wins over deferred mode-scroll restoration.
    const inset = this.appearance.toolbarInset ?? 0;
    if (this.modeValue === "reader") {
      const element = Array.from(this.readerRoot.querySelectorAll<HTMLElement>("[data-outline-anchor]")).find(item => item.dataset.outlineAnchor === target.anchor);
      if (!element) return false;
      for (let parent = element.parentElement; parent && parent !== this.readerRoot; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
      this.readerRoot.scrollTop += element.getBoundingClientRect().top - this.readerRoot.getBoundingClientRect().top - inset;
      element.tabIndex = -1; element.focus({preventScroll:true});
    } else {
      this.viewValue.dispatch({selection:{anchor:target.from}, effects:EditorView.scrollIntoView(target.from,{y:"start",yMargin:inset + 16})}); this.viewValue.focus();
    }
    return true;
  }
  setUI(options: UIOptions) {this.assertAlive(); this.ui.update(options); this.reader.setUI(options);}
  setAppearance(appearance: EditorAppearance): void {
    this.assertAlive(); this.appearance = {...this.appearance,...appearance};
    this.appearance.fontScale = appearanceScale(this.appearance.fontScale);
    this.appearance.contentWidth = appearanceWidth(this.appearance.contentWidth);
    this.appearance.toolbarInset = Math.max(0, Number.isFinite(this.appearance.toolbarInset) ? this.appearance.toolbarInset! : 0);
    for (const root of [this.frame,this.readerRoot,this.editorRoot]) {
      root.style.setProperty("--reader-font-scale", String(this.appearance.fontScale));
      root.style.setProperty("--reader-content-width", `${this.appearance.contentWidth}px`);
      root.style.setProperty("--toolbar-inset", `${this.appearance.toolbarInset}px`);
      for (const [key,variable] of Object.entries({background:"background",text:"text",muted:"muted",border:"border",accent:"accent",accentSoft:"accent-soft"})) {
        const value = this.appearance[key as keyof EditorAppearance];
        if (typeof value === "string") root.style.setProperty(`--${variable}`, value);
      }
    }
    this.viewValue.requestMeasure();
  }
  /** Source-visible editing for assistive technology; document and undo are unchanged. */
  setAccessibility(enabled: boolean): boolean {
    this.assertAlive(); if (this.composing || this.viewValue.composing) return false;
    this.accessible = enabled; this.frame.dataset.screenReader = String(enabled);
    this.viewValue.dispatch({effects:this.preview.reconfigure(this.modeValue === "live" && !enabled && !editingPerformancePolicy(this.source).sourcePreview ? livePreview : [])});
    return true;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; disposeInteractions(this.frame); clearTimeout(this.compositionTimer); clearTimeout(this.outlineTimer);
    this.frame.removeEventListener("focusin", this.queueState); this.frame.removeEventListener("focusout", this.queueState);
    this.frame.removeEventListener("tegg-open-link", this.openLink);
    this.frame.removeEventListener("tegg-copy-text", this.copyText);
    this.frame.removeEventListener("tegg-callout-menu", this.openCalloutMenu);
    this.ui.destroy(); this.stopEngines(); this.editing.destroy(); this.issuedSnapshots.clear(); this.viewValue.destroy(); this.reader.destroy(); this.stopTypography(); this.frame.remove();
  }
}
