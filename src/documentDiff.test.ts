import {describe, expect, it} from "vitest";
import {applySourcePatches} from "./sourcePatch";
import {createDocumentConflict, diffDocumentSources, planDocumentReconciliation, type ConflictDraft,
  type DocumentConflict, type DocumentVersion} from "./documentDiff";

const version = (source: string, revision = "v1"): DocumentVersion => ({documentId: "fixture.md", source, revision});
const draft = (source: string, sequence = 1): ConflictDraft => ({documentId: "fixture.md", baseRevision: "v1", source, generation: "editor-1", sequence});
const conflict = (base: string, local: string, incoming: string) => createDocumentConflict({base: version(base), local: draft(local), incoming: version(incoming, "v2")});
const current = (session: DocumentConflict) => ({local: session.local, incoming: session.incoming});
const applyAll = (session: DocumentConflict) => Object.fromEntries(session.hunks.map(hunk => [hunk.id, "apply" as const]));

describe("bounded source differences", () => {
  it("round-trips seeded Unicode/CRLF edits without changing untouched source", () => {
    let seed = 91;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
    const alphabet = ["中", "文", "😀", "e\u0301", "\r\n", " | ", "`", "a", "\n", "$"];
    for (let run = 0; run < 200; run++) {
      const tokens = Array.from({length: 25}, () => alphabet[random() % alphabet.length]);
      const base = tokens.join("");
      for (let edit = 0; edit < 4; edit++) tokens.splice(random() % (tokens.length + 1), random() % 3, alphabet[random() % alphabet.length]);
      const next = tokens.join("");
      const hunks = diffDocumentSources(base, next);
      expect(applySourcePatches(base, hunks)).toBe(next);
      for (const hunk of hunks) {
        expect(hunk.expected).toBe(base.slice(hunk.from, hunk.to));
        expect(hunk.from === 0 || !/[\uD800-\uDBFF]/.test(base[hunk.from - 1]) || !/[\uDC00-\uDFFF]/.test(base[hunk.from])).toBe(true);
      }
    }
  });

  it("retains byte-significant source and bounds unalignable differences", () => {
    const base = "\uFEFF# 标题\r\n\r\nunknown ::: keep  \r\nvalue: old\r\n";
    const next = base.replace("old", "new");
    expect(applySourcePatches(base, diffDocumentSources(base, next))).toBe(next);
    const huge = diffDocumentSources("a".repeat(2000), "b".repeat(2000));
    expect(huge).toHaveLength(1);
    expect(huge[0].coarse).toBe(true);
    const session = conflict("a".repeat(2000), "a".repeat(2000), "b".repeat(2000));
    expect(planDocumentReconciliation(session, applyAll(session), current(session)).status).toBe("rejected");
  });
});

describe("reviewed three-version reconciliation", () => {
  it("maps independent external edits past a changed local range", () => {
    const base = "Title\nalpha=old\nbeta=old\ngamma=old\n";
    const session = conflict(base, base.replace("alpha=old", "alpha=人类编辑"), base.replace("gamma=old", "gamma=agent"));
    const plan = planDocumentReconciliation(session, applyAll(session), current(session));
    expect(plan.status).toBe("ready");
    if (plan.status !== "rejected") {
      expect(plan.source).toBe("Title\nalpha=人类编辑\nbeta=old\ngamma=agent\n");
      expect(plan.nextBaseline).toEqual(session.incoming);
      expect(plan.requiresSave).toBe(true);
      expect(applySourcePatches(session.local.source, plan.patches)).toBe(plan.source);
    }
  });

  it("does not interpret an unselected external hunk as rejection or a save", () => {
    const base = "one=old\ntwo=old\nthree=old\n";
    const session = conflict(base, base, base.replace("one=old", "one=new").replace("three=old", "three=new"));
    expect(session.hunks.length).toBeGreaterThan(1);
    const plan = planDocumentReconciliation(session, {[session.hunks[0].id]: "apply"}, current(session));
    expect(plan.status).toBe("partial");
    if (plan.status !== "rejected") {
      expect(plan.nextBaseline).toBeNull();
      expect(plan.unresolvedIds.length).toBeGreaterThan(0);
      const renewed = createDocumentConflict({base: session.base, incoming: session.incoming, local: {...session.local, source: plan.source, sequence: 2}});
      expect(renewed.hunks.some(hunk => hunk.status === "already-applied")).toBe(true);
      const completed = planDocumentReconciliation(renewed, applyAll(renewed), current(renewed));
      expect(completed.status).toBe("ready");
      if (completed.status !== "rejected") expect(completed.source).toBe(session.incoming.source);
    }
  });

  it("rejects overlapping and same-point edits as a complete batch", () => {
    const session = conflict("hello\nend\n", "hello local\nend\n", "hello external\nend changed\n");
    expect(session.hunks.some(hunk => hunk.status === "conflicting")).toBe(true);
    const result = planDocumentReconciliation(session, applyAll(session), current(session));
    expect(result.status).toBe("rejected");
    expect(result.patches).toEqual([]);
    const kept = planDocumentReconciliation(session,
      Object.fromEntries(session.hunks.map(hunk => [hunk.id, hunk.status === "conflicting" ? "keep-local" : "apply"])), current(session));
    expect(kept.status).toBe("ready");
  });

  it("rechecks document, generation, local sequence/source and persisted revision/source", () => {
    const session = conflict("a\nb\n", "local a\nb\n", "a\nexternal b\n");
    for (const patch of [{documentId: "other"}, {generation: "new"}, {sequence: 2}, {source: "different"}, {baseRevision: "v0"}]) {
      expect(planDocumentReconciliation(session, applyAll(session), {...current(session), local: {...session.local, ...patch}}).status).toBe("rejected");
    }
    for (const patch of [{documentId: "other"}, {revision: "v3"}, {source: "changed without new revision"}]) {
      expect(planDocumentReconciliation(session, applyAll(session), {...current(session), incoming: {...session.incoming, ...patch}}).status).toBe("rejected");
    }
  });

  it("requires valid explicit decisions and accepts a profile veto", () => {
    const session = conflict("first\nlast\n", "first\nlast\n", "first\nchanged\n");
    expect(planDocumentReconciliation(session, {unknown: "apply"}, current(session)).status).toBe("rejected");
    expect(planDocumentReconciliation(session, {[session.hunks[0].id]: "invalid" as "apply"}, current(session)).status).toBe("rejected");
    expect(planDocumentReconciliation(session, applyAll(session), current(session), {validatePatches: () => false}).status).toBe("rejected");
    expect(planDocumentReconciliation(session, {}, current(session)).status).toBe("partial");
  });

  it("recognizes already applied changes and freezes all session snapshots", () => {
    const session = conflict("original", "changed", "changed");
    expect(session.hunks.every(hunk => hunk.status === "already-applied")).toBe(true);
    const plan = planDocumentReconciliation(session, {}, current(session));
    expect(plan.status).toBe("ready");
    if (plan.status !== "rejected") {expect(plan.patches).toEqual([]); expect(plan.requiresSave).toBe(false);}
    expect(Object.isFrozen(session.local)).toBe(true);
    expect(Object.isFrozen(session.hunks[0].external)).toBe(true);
  });

  it("rejects inconsistent version identity before opening a session", () => {
    expect(() => createDocumentConflict({base: version("a"), local: draft("b"), incoming: version("c")})).toThrow(/revision/);
    expect(() => createDocumentConflict({base: version("a"), local: {...draft("b"), baseRevision: "wrong"}, incoming: version("c", "v2")})).toThrow(/base revision/);
  });
});
