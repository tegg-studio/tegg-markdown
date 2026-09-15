import {createDocumentConflict, planDocumentReconciliation, type ConflictDecision, type ConflictDraft,
  type DocumentConflict, type DocumentVersion} from "./documentDiff";
import type {SourcePatch} from "./sourcePatch";

export type ConflictUIContext = {base: DocumentVersion; local: ConflictDraft; incoming: DocumentVersion};
type Awaitable<T> = T | Promise<T>;
export type ConflictUIHost = {
  getContext(): Awaitable<ConflictUIContext | null>;
  /** Atomically compare expectedLocal and apply one undoable patch batch. */
  applyPatches(patches: readonly SourcePatch[], expectedLocal: ConflictDraft): Awaitable<ConflictDraft | null>;
  /** Recheck real storage, preserve incoming recovery, adopt only its baseline. Never acknowledge a save. */
  adoptIncomingBaseline(incoming: DocumentVersion, expectedLocal: ConflictDraft): Awaitable<boolean>;
  /** Preserve the current draft durably before explicitly replacing it with the rechecked incoming version. */
  acceptExternal(incoming: DocumentVersion, expectedLocal: ConflictDraft): Awaitable<boolean>;
  /** Store this exact draft as a separate document; leave the conflict unresolved. */
  saveCopy(source: string, expectedLocal: ConflictDraft): Awaitable<boolean>;
  copyText?(source: string): Awaitable<void>;
  onClose?(): void;
  onResolved?(result: {baseline: DocumentVersion; local: ConflictDraft; requiresSave: boolean}): void;
  onError?(error: unknown): void;
  locale?: "en" | "zh";
};
export type ConflictUI = {element: HTMLElement; refresh(): Promise<void>; dispose(): void};

const labels = {
  en: {
    title: "Review external changes", base: "Original version", local: "Your current draft", incoming: "External version",
    intro: "Review each external change. Your draft is kept until a storage operation succeeds.",
    change: "Change", applicable: "Can apply", conflicting: "Overlaps your changes", uncertain: "Needs full-version review", applied: "Already in your draft",
    before: "Before", after: "External change", undecided: "Review later", apply: "Apply this change",
    keep: "Keep my version; discard this external change", applySelected: "Apply selected changes",
    finish: "Complete review", keepAll: "Keep my version for all remaining changes", accept: "Use external version",
    saveCopy: "Save my draft as a copy", copy: "Copy my draft", refresh: "Refresh comparison", close: "Close",
    working: "Working…", stale: "The document or external version changed. Your draft is safe; refresh the comparison.",
    partial: "Selected changes applied. Review the remaining changes before saving over the original file.",
    resolved: "Review completed. Your draft still needs a successful save.", matches: "Review completed. Your draft matches the external version.",
    accepted: "External version opened. Your previous draft was kept for recovery.", copied: "A separate copy was saved. The original conflict remains open.",
    clipboard: "Your draft was copied.", failed: "The operation could not finish. Your draft remains available.",
    noConflict: "There are no external changes to review.", more: "Show more changes", full: "Show complete source",
    unresolved: "changes still need a decision", error: "An error occurred. Your draft remains available.",
  },
  zh: {
    title: "检查外部修改", base: "原始版本", local: "当前草稿", incoming: "外部版本",
    intro: "逐项决定如何处理外部修改。存储操作成功前会保留当前草稿。",
    change: "修改", applicable: "可以应用", conflicting: "与当前修改重叠", uncertain: "需要检查完整版本", applied: "已在当前草稿中",
    before: "修改前", after: "外部修改", undecided: "稍后决定", apply: "应用这项修改",
    keep: "保留我的版本，放弃这项外部修改", applySelected: "应用选中修改",
    finish: "完成检查", keepAll: "其余修改全部保留我的版本", accept: "使用外部版本",
    saveCopy: "将草稿另存为副本", copy: "复制当前草稿", refresh: "刷新比较", close: "关闭",
    working: "正在处理…", stale: "文档或外部版本已变化。草稿已保留，请刷新比较。",
    partial: "已应用选中修改。处理其余修改后才能保存覆盖原文件。",
    resolved: "检查完成，当前草稿仍需成功保存。", matches: "检查完成，当前内容与外部版本一致。",
    accepted: "已打开外部版本，之前的草稿已保留用于恢复。", copied: "已保存独立副本，原文档的冲突仍待处理。",
    clipboard: "已复制当前草稿。", failed: "操作未能完成，当前草稿仍可继续使用。",
    noConflict: "没有需要处理的外部修改。", more: "显示更多修改", full: "显示完整源码",
    unresolved: "项修改尚待决定", error: "发生错误，当前草稿仍可继续使用。",
  },
};
let nextPanel = 0;

function sameLocal(a: ConflictDraft, b: ConflictDraft): boolean {
  return a.documentId === b.documentId && a.generation === b.generation && a.sequence === b.sequence &&
    a.baseRevision === b.baseRevision && a.source === b.source;
}
function sameVersion(a: DocumentVersion, b: DocumentVersion): boolean {
  return a.documentId === b.documentId && a.revision === b.revision && a.source === b.source;
}

/** Optional, non-modal review UI. Include conflictUI.css with the Host's editor styles. */
export function attachConflictUI(root: HTMLElement, host: ConflictUIHost): ConflictUI {
  const document = root.ownerDocument, panelId = `tegg-conflict-${++nextPanel}`;
  const locale = host.locale ?? (document.documentElement.lang.toLowerCase().startsWith("zh") ? "zh" : "en");
  const text = labels[locale];
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const element = document.createElement("section");
  element.className = "tegg-conflict-panel"; element.tabIndex = -1;
  element.setAttribute("role", "dialog"); element.setAttribute("aria-modal", "false");
  element.setAttribute("aria-labelledby", `${panelId}-title`);
  const heading = document.createElement("h2"); heading.id = `${panelId}-title`; heading.textContent = text.title;
  const status = document.createElement("p"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const body = document.createElement("div"), actions = document.createElement("div"); actions.className = "tegg-conflict-actions";
  element.append(heading, status, body, actions); root.append(element);
  let session: DocumentConflict | null = null, decisions: Record<string, ConflictDecision> = {};
  let alive = true, busy = false, stale = false, resolved = false, visibleCount = 50, refreshEpoch = 0;

  function message(value: string) {if (alive) status.textContent = value;}
  function report(error: unknown) {
    message(text.error);
    try {host.onError?.(error);} catch { /* a Host observer must not discard review state */ }
  }
  function button(label: string, run: () => Awaitable<unknown>, disabled = false): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.disabled = busy || disabled;
    button.addEventListener("click", () => {try {Promise.resolve(run()).catch(report);} catch (error) {report(error);}});
    return button;
  }
  function source(title: string, value: string): HTMLElement {
    const details = document.createElement("details"), summary = document.createElement("summary"), pre = document.createElement("pre");
    summary.textContent = title; pre.textContent = value.slice(0, 100_000); pre.tabIndex = 0;
    details.append(summary, pre);
    if (value.length > 100_000) details.append(button(text.full, () => {pre.textContent = value;}));
    return details;
  }
  function setStale() {stale = true; message(text.stale); render();}
  function pendingCount() {
    return session?.hunks.filter(hunk => hunk.status !== "already-applied" && !decisions[hunk.id]).length ?? 0;
  }
  function render() {
    if (!alive) return;
    element.setAttribute("aria-busy", String(busy)); body.replaceChildren(); actions.replaceChildren();
    if (session && !resolved) {
      const intro = document.createElement("p"); intro.textContent = text.intro;
      const snapshots = document.createElement("div"); snapshots.className = "tegg-conflict-snapshots";
      snapshots.append(source(text.base, session.base.source), source(text.local, session.local.source), source(text.incoming, session.incoming.source));
      body.append(intro, snapshots);
      const count = document.createElement("p"); count.textContent = `${pendingCount()} ${text.unresolved}`; body.append(count);
      session.hunks.slice(0, visibleCount).forEach((hunk, index) => {
        const fieldset = document.createElement("fieldset"), legend = document.createElement("legend");
        legend.textContent = `${text.change} ${index + 1} · ${hunk.status === "applicable" ? text.applicable : hunk.status === "conflicting" ? hunk.reason === "uncertain-range" ? text.uncertain : text.conflicting : text.applied}`;
        fieldset.append(legend, source(text.before, hunk.external.expected), source(text.after, hunk.external.insert));
        if (hunk.status !== "already-applied") {
          for (const [value, labelText] of [["", text.undecided], ["apply", text.apply], ["keep-local", text.keep]] as const) {
            const label = document.createElement("label"), control = document.createElement("input");
            control.type = "radio"; control.name = `${panelId}-${hunk.id}`; control.value = value;
            control.checked = value === (decisions[hunk.id] ?? "");
            control.disabled = busy || (value === "apply" && hunk.status === "conflicting");
            control.addEventListener("change", () => {
              if (value) decisions[hunk.id] = value; else delete decisions[hunk.id];
              // Keep the selected control focused. Only summary/actions need updating.
              count.textContent = `${pendingCount()} ${text.unresolved}`; renderActions();
            });
            label.append(control, document.createTextNode(labelText)); fieldset.append(label);
          }
        }
        body.append(fieldset);
      });
      if (session.hunks.length > visibleCount) body.append(button(text.more, () => {visibleCount += 50; render();}));
    }
    renderActions();
  }
  function renderActions() {
    actions.replaceChildren();
    if (session && !resolved) {
      const hasSelected = session.hunks.some(hunk => hunk.status !== "already-applied" && !!decisions[hunk.id]);
      actions.append(button(pendingCount() ? text.applySelected : text.finish, applySelected, stale || (!hasSelected && pendingCount() > 0)));
      actions.append(button(text.keepAll, () => {
        for (const hunk of session!.hunks) if (hunk.status !== "already-applied" && !decisions[hunk.id]) decisions[hunk.id] = "keep-local";
        render();
      }, stale || !pendingCount()));
      actions.append(button(text.accept, acceptExternal, stale), button(text.saveCopy, saveCopy, stale));
      if (host.copyText) actions.append(button(text.copy, async () => {
        await host.copyText!(session!.local.source); message(text.clipboard);
      }));
      actions.append(button(text.refresh, refresh));
    }
    actions.append(button(text.close, close));
  }
  async function guardedContext(expected: DocumentConflict): Promise<ConflictUIContext | null> {
    const context = await host.getContext();
    if (!alive) return null;
    if (!context || !sameVersion(expected.base, context.base) || !sameVersion(expected.incoming, context.incoming) ||
        !sameLocal(expected.local, context.local)) {setStale(); return null;}
    return context;
  }
  async function refresh() {
    if (!alive || busy) return;
    const epoch = ++refreshEpoch;
    const context = await host.getContext();
    if (!alive || epoch !== refreshEpoch || busy) return;
    if (!context) {session = null; resolved = true; message(text.noConflict); render(); return;}
    const next = createDocumentConflict(context);
    const preserve = session && sameVersion(session.base, next.base) && sameVersion(session.incoming, next.incoming) &&
      session.local.generation === next.local.generation;
    if (!preserve) decisions = {};
    for (const [id, decision] of Object.entries(decisions)) {
      const hunk = next.hunks.find(item => item.id === id);
      if (!hunk || (decision === "apply" && hunk.status === "conflicting")) delete decisions[id];
    }
    session = next; stale = false; resolved = false; visibleCount = 50; message(""); render();
  }
  async function runOperation(run: (expected: DocumentConflict) => Promise<void>) {
    if (!session || busy || resolved || stale) return;
    const expected = session; busy = true; refreshEpoch++; message(text.working); render();
    try {await run(expected);} catch (error) {report(error);} finally {
      busy = false; render();
      // Re-rendering removes the clicked control. Restore a useful dialog focus
      // unless the user deliberately moved into another non-modal surface.
      if (alive && (document.activeElement === document.body || element.contains(document.activeElement))) element.focus();
    }
  }
  async function applySelected() {
    await runOperation(async expected => {
      const context = await guardedContext(expected); if (!context) return;
      const plan = planDocumentReconciliation(expected, decisions, context);
      if (plan.status === "rejected") {setStale(); return;}
      let local = context.local;
      if (plan.patches.length) {
        const result = await host.applyPatches(plan.patches, context.local);
        if (!alive) return;
        if (!result || result.documentId !== local.documentId || result.generation !== local.generation ||
            result.baseRevision !== local.baseRevision || result.sequence <= local.sequence || result.source !== plan.source) {setStale(); return;}
        local = result;
      }
      const after = await host.getContext();
      if (!alive) return;
      if (!after || !sameLocal(after.local, local) || !sameVersion(after.base, expected.base) || !sameVersion(after.incoming, expected.incoming)) {setStale(); return;}
      if (plan.status === "ready" && plan.nextBaseline) {
        if (!await host.adoptIncomingBaseline(plan.nextBaseline, local)) {setStale(); return;}
        if (!alive) return;
        resolved = true; message(plan.requiresSave ? text.resolved : text.matches);
        try {host.onResolved?.({baseline: plan.nextBaseline, local, requiresSave: plan.requiresSave});} catch (error) {report(error);}
      } else {
        session = createDocumentConflict(after);
        message(text.partial);
      }
    });
  }
  async function acceptExternal() {
    await runOperation(async expected => {
      if (!await guardedContext(expected)) return;
      if (!await host.acceptExternal(expected.incoming, expected.local)) {setStale(); return;}
      if (alive) {resolved = true; message(text.accepted);}
    });
  }
  async function saveCopy() {
    await runOperation(async expected => {
      if (!await guardedContext(expected)) return;
      message(await host.saveCopy(expected.local.source, expected.local) ? text.copied : text.failed);
    });
  }
  function close() {
    if (busy) return;
    dispose(); host.onClose?.();
  }
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !event.isComposing && !busy) {event.preventDefault(); event.stopPropagation(); close();}
  };
  function dispose() {
    if (!alive) return;
    alive = false; refreshEpoch++; element.removeEventListener("keydown", keydown); element.remove();
    if (returnFocus?.isConnected) returnFocus.focus();
  }
  element.addEventListener("keydown", keydown);
  void refresh().then(() => {if (alive) element.focus();}).catch(report);
  return {element, refresh, dispose};
}
