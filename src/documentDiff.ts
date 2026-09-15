import {applySourcePatches, validateSourcePatches, type SourcePatch} from "./sourcePatch";

/** A persisted version supplied by the Host, never a fabricated save receipt. */
export type DocumentVersion = Readonly<{documentId: string; revision: string; source: string}>;
export type ConflictDraft = Readonly<{
  documentId: string; baseRevision: string; generation: string; sequence: number; source: string;
}>;
export type ConflictDecision = "apply" | "keep-local";
export type DocumentDiffHunk = Readonly<SourcePatch & {expected: string; coarse: boolean}>;
export type DocumentConflictHunk = Readonly<{
  id: string;
  external: DocumentDiffHunk;
  localPatch: Readonly<SourcePatch & {expected: string}> | null;
  status: "applicable" | "conflicting" | "already-applied";
  reason?: "overlapping-change" | "uncertain-range";
}>;
export type DocumentConflict = Readonly<{
  base: DocumentVersion; local: ConflictDraft; incoming: DocumentVersion;
  hunks: readonly DocumentConflictHunk[];
}>;
export type ReconciliationPlan =
  | Readonly<{status: "rejected"; reason: string; patches: readonly []; nextBaseline: null}>
  | Readonly<{
    status: "partial" | "ready";
    patches: readonly SourcePatch[];
    source: string;
    unresolvedIds: readonly string[];
    /** Only ready plans may adopt this after the Host rechecks the stored revision. */
    nextBaseline: DocumentVersion | null;
    /** There is deliberately no saved/acknowledged flag: this plan performs no I/O. */
    requiresSave: boolean;
  }>;

type Edit = {from: number; to: number; insert: string; coarse: boolean};
const MAX_DIFF_CELLS = 250_000;
const MAX_SOURCE_UNITS = 4 * 1024 * 1024;

function assertVersion(value: DocumentVersion): void {
  if (!value || typeof value.documentId !== "string" || !value.documentId ||
      typeof value.revision !== "string" || typeof value.source !== "string") {
    throw new TypeError("A document version requires documentId, revision and source");
  }
}
function assertDraft(value: ConflictDraft): void {
  if (!value || typeof value.documentId !== "string" || !value.documentId ||
      typeof value.baseRevision !== "string" || typeof value.source !== "string" ||
      typeof value.generation !== "string" || !value.generation ||
      !Number.isSafeInteger(value.sequence) || value.sequence < 0) {
    throw new TypeError("A draft requires its document identity, generation and sequence");
  }
}

/** Bounded LCS. Coarse fallbacks remain displayable but are never auto-applicable. */
function tokenEdits(left: string[], right: string[], offset: number): Edit[] {
  let start = 0, endLeft = left.length, endRight = right.length;
  while (start < endLeft && start < endRight && left[start] === right[start]) start++;
  while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
    endLeft--; endRight--;
  }
  offset += left.slice(0, start).join("").length;
  const a = left.slice(start, endLeft), b = right.slice(start, endRight);
  if (!a.length && !b.length) return [];
  if (!a.length || !b.length) return [{from: offset, to: offset + a.join("").length, insert: b.join(""), coarse: false}];
  if ((a.length + 1) * (b.length + 1) > MAX_DIFF_CELLS) {
    return [{from: offset, to: offset + a.join("").length, insert: b.join(""), coarse: true}];
  }
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    table[i * width + j] = a[i] === b[j] ? 1 + table[(i + 1) * width + j + 1] :
      Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  }
  const edits: Edit[] = [];
  let i = 0, j = 0, position = offset, pending: Edit | null = null;
  const flush = () => {if (pending) edits.push(pending); pending = null;};
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush(); position += a[i].length; i++; j++;
    } else {
      pending ??= {from: position, to: position, insert: "", coarse: false};
      if (j < b.length && (i === a.length || table[i * width + j + 1] >= table[(i + 1) * width + j])) {
        pending.insert += b[j++];
      } else {position += a[i++].length; pending.to = position;}
    }
  }
  flush();
  return edits;
}

/** Exact textual edits; offsets are UTF-16 and never bisect Unicode code points. */
export function diffDocumentSources(base: string, next: string): readonly DocumentDiffHunk[] {
  if (typeof base !== "string" || typeof next !== "string") throw new TypeError("Diff inputs must be strings");
  if (base === next) return Object.freeze([]);
  if (base.length > MAX_SOURCE_UNITS || next.length > MAX_SOURCE_UNITS) {
    return Object.freeze([Object.freeze({from: 0, to: base.length, expected: base, insert: next, coarse: true})]);
  }
  // Line alignment bounds memory for long files; each changed span is refined by
  // code point so independent edits within a paragraph remain distinguishable.
  const lines = (source: string) => source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const aligned = tokenEdits(lines(base), lines(next), 0);
  const edits = aligned.flatMap(edit => {
    const old = base.slice(edit.from, edit.to);
    return tokenEdits(Array.from(old), Array.from(edit.insert), edit.from);
  });
  return Object.freeze(edits.map(edit => Object.freeze({...edit, expected: base.slice(edit.from, edit.to)})));
}

function touches(a: DocumentDiffHunk, b: DocumentDiffHunk): boolean {
  if (a.from === a.to) return a.from >= b.from && a.from <= b.to;
  if (b.from === b.to) return b.from >= a.from && b.from <= a.to;
  return a.from < b.to && b.from < a.to;
}
function sameEdit(a: DocumentDiffHunk, b: DocumentDiffHunk): boolean {
  return a.from === b.from && a.to === b.to && a.expected === b.expected && a.insert === b.insert;
}
function snapshotVersion(value: DocumentVersion): DocumentVersion {
  return Object.freeze({documentId: value.documentId, revision: value.revision, source: value.source});
}
function snapshotDraft(value: ConflictDraft): ConflictDraft {
  return Object.freeze({documentId: value.documentId, baseRevision: value.baseRevision,
    generation: value.generation, sequence: value.sequence, source: value.source});
}

/** Creates an immutable review session. There is no document replacement or save. */
export function createDocumentConflict(input: {
  base: DocumentVersion; local: ConflictDraft; incoming: DocumentVersion;
}): DocumentConflict {
  assertVersion(input.base); assertDraft(input.local); assertVersion(input.incoming);
  const {base, local, incoming} = input;
  if (base.documentId !== local.documentId || base.documentId !== incoming.documentId ||
      base.revision !== local.baseRevision) throw new TypeError("Conflict versions do not share a document and base revision");
  if (incoming.revision === base.revision && incoming.source !== base.source) {
    throw new TypeError("A storage revision cannot identify two different sources");
  }
  const localEdits = diffDocumentSources(base.source, local.source);
  const externalEdits = diffDocumentSources(base.source, incoming.source);
  const hunks = externalEdits.map((external, index): DocumentConflictHunk => {
    const collisions = localEdits.filter(edit => touches(external, edit));
    const id = `external-${index}-${external.from}-${external.to}`;
    if (collisions.length === 1 && sameEdit(external, collisions[0])) {
      return Object.freeze({id, external, localPatch: null, status: "already-applied"});
    }
    if (collisions.length || external.coarse) {
      return Object.freeze({id, external, localPatch: null, status: "conflicting",
        reason: external.coarse || collisions.some(edit => edit.coarse) ? "uncertain-range" : "overlapping-change"});
    }
    const shift = localEdits.filter(edit => edit.to <= external.from)
      .reduce((total, edit) => total + edit.insert.length - (edit.to - edit.from), 0);
    const localPatch = Object.freeze({from: external.from + shift, to: external.to + shift,
      expected: external.expected, insert: external.insert});
    if (local.source.slice(localPatch.from, localPatch.to) !== localPatch.expected) {
      return Object.freeze({id, external, localPatch: null, status: "conflicting", reason: "uncertain-range"});
    }
    return Object.freeze({id, external, localPatch, status: "applicable"});
  });
  return Object.freeze({base: snapshotVersion(base), local: snapshotDraft(local),
    incoming: snapshotVersion(incoming), hunks: Object.freeze(hunks)});
}

function sameVersion(a: DocumentVersion, b: DocumentVersion): boolean {
  return a.documentId === b.documentId && a.revision === b.revision && a.source === b.source;
}
function sameDraft(a: ConflictDraft, b: ConflictDraft): boolean {
  return a.documentId === b.documentId && a.baseRevision === b.baseRevision && a.generation === b.generation &&
    a.sequence === b.sequence && a.source === b.source;
}

/**
 * Each external hunk needs an explicit decision. Unselected hunks keep the
 * conflict unresolved; partial application never advances a storage baseline.
 * Host profile/object constraints may reject the complete textual patch batch.
 */
export function planDocumentReconciliation(
  session: DocumentConflict,
  decisions: Readonly<Record<string, ConflictDecision>>,
  current: {local: ConflictDraft; incoming: DocumentVersion},
  options: {validatePatches?: (patches: readonly SourcePatch[], source: string) => boolean} = {},
): ReconciliationPlan {
  const reject = (reason: string): ReconciliationPlan => Object.freeze({status: "rejected", reason, patches: [] as const, nextBaseline: null});
  if (!sameDraft(session.local, current.local)) return reject("local-version-changed");
  if (!sameVersion(session.incoming, current.incoming)) return reject("incoming-version-changed");
  const validIds = new Set(session.hunks.map(hunk => hunk.id));
  for (const [id, decision] of Object.entries(decisions)) {
    if (!validIds.has(id)) return reject("unknown-hunk");
    if (decision !== "apply" && decision !== "keep-local") return reject("invalid-decision");
  }
  const patches: SourcePatch[] = [], unresolvedIds: string[] = [];
  for (const hunk of session.hunks) {
    const decision = Object.hasOwn(decisions, hunk.id) ? decisions[hunk.id] : undefined;
    if (hunk.status === "already-applied") continue;
    if (!decision) {unresolvedIds.push(hunk.id); continue;}
    if (decision === "keep-local") continue;
    if (hunk.status !== "applicable" || !hunk.localPatch) return reject("selected-hunk-conflicts");
    patches.push({...hunk.localPatch});
  }
  try {
    const ordered = validateSourcePatches(current.local.source, patches);
    if (options.validatePatches && !options.validatePatches(ordered, current.local.source)) return reject("profile-range-rejected");
    const source = applySourcePatches(current.local.source, ordered);
    const complete = unresolvedIds.length === 0;
    return Object.freeze({status: complete ? "ready" : "partial", source,
      patches: Object.freeze(ordered.map(patch => Object.freeze(patch))),
      unresolvedIds: Object.freeze(unresolvedIds), nextBaseline: complete ? session.incoming : null,
      requiresSave: !complete || source !== session.incoming.source});
  } catch {return reject("patch-validation-failed");}
}
