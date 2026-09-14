# Recovery and external-change review

These optional services help a Host protect Markdown drafts and review external
updates. They do not replace the Host's document store, grant file permissions,
write an authoritative document, or acknowledge a successful save.

## Three-version review

The public editor entry exports `createDocumentConflict`,
`planDocumentReconciliation`, and their types. A session contains:

- `base`: the last known persisted source and Host storage revision;
- `local`: the active draft, its base revision, editor generation and sequence;
- `incoming`: a newly observed persisted source and revision.

All three must identify the same document. A revision cannot label two different
sources. Snapshots and hunks are immutable. Textual differences use UTF-16 ranges
that do not split Unicode code points. The bounded diff aligns lines and refines
changed spans by code point; uncertain large ranges are displayed as coarse
conflicts instead of being assumed safe. Files above 4 Mi UTF-16 units use a
whole-range conflict. This is a review tool, not a general automatic merge engine.

```ts
const session = createDocumentConflict({base, local, incoming});
const decisions = {[session.hunks[0].id]: "apply" as const};
const plan = planDocumentReconciliation(session, decisions, {
  local: readCurrentDraft(),
  incoming: await storage.readCurrentVersion(),
});
```

Every external hunk is `applicable`, `conflicting`, or `already-applied`.
Decisions are `apply` and `keep-local`; absence means **unresolved**, never
permission to discard that external change. An overlapping or uncertain hunk
cannot be applied individually. Users can keep their version explicitly, accept
the full external version, or save a separate copy. Insertions at the same point
or at a changed range boundary are conservatively conflicting.

The planner checks the entire current source, document, generation, sequence,
base revision, incoming revision and incoming source. It validates every expected
patch range before returning any batch. A Host can additionally supply
`validatePatches` to reject changes that violate its profile or object boundary
rules. Textual non-overlap alone does not promise semantic equivalence for every
custom Markdown extension.

| Result | Host behavior |
| --- | --- |
| `rejected` | Apply nothing; keep all drafts and refresh the comparison. |
| `partial` | Apply the chosen patch batch as one undoable transaction. Keep the original base and unresolved conflict; do not autosave over the original file. |
| `ready` | Recheck storage, preserve recoverable copies, and adopt `nextBaseline` without replacing the active draft or undo history. Save the resulting draft conditionally against that incoming revision. |

After a partial patch, rebuild the session with the original `base`, the actual
new `local` snapshot, and the same verified `incoming`. Changes now in the draft
are recognized as already applied. Keep decisions only for the same verified
external hunk; reopening another document or external version requires new review.

A ready plan is **not a save receipt**. If the resulting source differs from
incoming, `requiresSave` remains true. Adopting a base must not clear newer edits.
Only a real successful Host write may acknowledge its exact saved snapshot. If
storage changes again, stop reconciliation and compare the new version. A file
read followed by a write is not automatically a race-free compare-and-swap.

## Optional conflict UI

`attachConflictUI(root, host)` renders a non-modal accessible review panel and
returns `{element, refresh, dispose}`. Include the shipped conflict styles through
the editor style entry. The interface has English and Chinese labels, three source
views, explicit decisions per hunk, partial application, full external acceptance,
save-copy, refresh, and keyboard close. Source is rendered as text, not HTML.
Long source views and large hunk lists expand on demand; the actual comparison and
saved copy always retain the full source. A closed panel restores the launch focus.

```ts
const review = attachConflictUI(container, {
  getContext: () => ({base, local: controller.snapshot(), incoming}),
  applyPatches: async (patches, expectedLocal) => {
    // Atomically check expectedLocal, apply one undoable batch, return the ACTUAL
    // resulting snapshot. Return null on readonly/composition/stale rejection.
    return applyReviewedPatches(patches, expectedLocal);
  },
  adoptIncomingBaseline: (incoming, expectedLocal) =>
    adoptVerifiedBaselineAndPreserveExternalCopy(incoming, expectedLocal),
  acceptExternal: (incoming, expectedLocal) =>
    preserveDraftThenAcceptVerifiedExternal(incoming, expectedLocal),
  saveCopy: (source, expectedLocal) => saveSeparateCopy(source, expectedLocal),
  locale: "en",
});
```

The callback names above are Host application functions, not additional SDK APIs.
The panel rechecks context before mutation and after patch application. Each Host
callback must still compare the passed identity at its actual commit boundary,
including after any asynchronous permission or file operation. `applyPatches`
returns the actual new draft sequence; it must not update the storage revision.
`adoptIncomingBaseline` must preserve the external recovery copy and verify current
storage before advancing the base. It does not synthesize an acknowledgment.
`acceptExternal` must persist the local recovery copy before replacing it.
`saveCopy` leaves the original conflict open. A false/null result never becomes a
success message. The Host can use native sheets instead and call the same planner.

## Recovery checkpoints

`RecoveryJournal` accepts a `RecoveryStorage` adapter. Checkpoints contain schema
version, document identity/path, editor generation/sequence, base revision/source,
draft source, timestamp, UTF-8/BOM/newline metadata, recovery reason and SHA-256
checksum. The checksum detects corruption; it does not authenticate a malicious
Host or protect against another script that can write the same origin's storage.

```ts
const storage = new IndexedDBRecoveryStorage("my-product-recovery");
const journal = new RecoveryJournal(storage, {
  onCheckpoint: record => showRecoveryCheckpoint(record.createdAt),
  onError: error => showRecoveryStorageFailure(error),
});
journal.schedule({
  documentId: "example.md", generation: editorGeneration, sequence: draftSequence,
  baseRevision, baseSource, draftSource,
  encoding: "utf-8", bom: false, newline: "lf", reason: "dirty",
});
await journal.flush(); // Lifecycle hooks can await this when the OS permits.
```

Scheduling is independent for every document/editor session: a 500 ms quiet window,
or at most 2 seconds of continuous input before a checkpoint attempt starts. I/O
can take longer or fail. Only a completed write and validated readback triggers
`onCheckpoint`. The API never promises unflushed characters will survive process
termination or power loss. Newer snapshots queued during an earlier write remain
pending. Failure keeps the latest input for explicit retry and reports an error;
it does not clear dirty state or announce a checkpoint.

`dispose()` flushes by default and is retryable when flushing fails. Do not use
`dispose({flush:false})` for a document switch that needs recovery; it intentionally
discards only uncheckpointed in-memory scheduling state and leaves stored records
alone. A closing journal rejects new scheduled work so it cannot silently drop an
edit that arrived during its final flush.

`journal.read(documentId?)` returns valid records, quarantine outcomes and storage
failures separately. It verifies schema, checksum and storage-key identity.
Malformed records move to quarantine with their original raw content, and other
valid checkpoints remain available. Unavailable storage is an error, not an empty
document. The Host decides which checkpoint to recover and must compare its base:

1. Matching document, source and storage revision: restore the draft into a new
   active editor session; retain its dirty status.
2. Changed storage: open base/local/incoming review before overwriting anything.
3. Missing permissions or file: retain the recovery content and offer save-copy.

Normal pruning keeps at least the newest two valid checkpoints per session and
the last unresolved conflict/failed-save checkpoint, even if a smaller history
budget was requested. It never prunes another document or session. The Host must
resolve or explicitly discard old sessions according to its visible retention
policy; space exhaustion is reported rather than deleting unresolved work silently.
`removeResolved(record, savedReceipt)` deletes only a checkpoint whose document,
generation, sequence, base revision and exact draft match a real Host save receipt.
It cannot retire a newer draft using an older success response. The receipt is a
Host assertion about completed I/O, not a way to request a save.

Native adapters can store the serialized envelope as an opaque file, using atomic
replacement and real platform file coordination. Re-serializing in another language
must not change the checksum's fixed canonical payload. `quarantine` must preserve
raw data before removing the active entry. The included `IndexedDBRecoveryStorage`
resolves mutations only on transaction commit and quarantines atomically across
its checkpoint and quarantine stores. It is a recovery journal, not the primary
Markdown document database or a cloud backup service.

## Validation

- `npx vitest run src/documentDiff.test.ts src/conflictUI.test.ts tests/recovery/recoveryJournal.test.ts`
  checks Unicode/CRLF round trips, version races, explicit decisions, atomic patch
  rejection, DOM review behavior, actual temporary-file restart/corruption recovery,
  checkpoint timing, storage failure, retention and receipt identity.
- `npx playwright test --config playwright.recovery.config.ts` runs isolated real
  IndexedDB restart/quarantine/receipt checks plus conflict UI keyboard, narrow
  layout and accessibility checks in Chromium, Firefox and WebKit on port 18928.

These source-level browser checks are separate from packed-consumer, native-file,
system input method, physical device, screen-reader and production release evidence.
They do not turn a browser reload into a power-loss durability claim.
