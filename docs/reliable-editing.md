# Reliable editing and source fidelity

This development line keeps one CodeMirror document as the source of truth. Reader,
Live Edit and Source are three projections of the same Markdown. Native Apps consume
this package; there is no second Apple-specific grammar or serialization core.

## Optional shared interface

```ts
import {TeggMarkdownEditor} from '@tegg/markdown/editor';
import {attachEditingUI} from '@tegg/markdown/ui';
import '@tegg/markdown/editor.css';
import '@tegg/markdown/ui.css';

const editor = new TeggMarkdownEditor(documentRoot, {
  documentId: 'note-1', revision: storageRevision, source: markdown,
}, {onChange: draft => retainUnsavedDraft(draft)}, 'live');
const ui = attachEditingUI(editor.editing, toolbarRoot, {
  storeResource: (file, context) => storage.persistAttachment(file, context),
  copyText: text => navigator.clipboard.writeText(text),
});
// Tear down UI before its controller/view.
ui.destroy();
editor.destroy();
```

`toolbarRoot` should be a dedicated element outside the CodeMirror contentDOM.
The interface provides formatting, objects, file input, clipboard review and literal
find/replace. Hosts may use `toolbar:false` and call `openObject`/`openSearch` from native
menus. Keep the required visible attribution when integrating `/core` directly.
The public examples include both vanilla DOM and a React wrapper.

## Object sessions

`editor.editing.begin(kind?, range?)` captures a document/generation/profile/mode-bound
session. Its offsets are CodeMirror UTF-16 positions using normalized LF line breaks.
The original text, draft and token remain separate. `updateDraft(token, text)` does not
modify Markdown. `commit(token, text?)` checks identity and expected text, performs one
isolated undo transaction and is idempotent for recently applied tokens. `cancel(token)`
changes no source. Disjoint edits map the target; overlapping edits invalidate it and
retain the draft for copying. Document or mode changes cannot apply a stale draft.

Do not capture a cursor after waiting for a picker. Begin the session first and retain
its token. Native Hosts constructing an EditorView directly use `EditingController`;
it installs its own listener. After `view.setState`, call `controller.reset()` to retire
the old identity and reinstall its listener. Destroy UI, controller, then EditorView.

The structured inline link adapter preserves title and escaped labels. Reference-style
links use their source draft rather than being silently rewritten into inline links.
Metadata is edited as local YAML; unknown fields, comments and untouched source remain.
Math and diagram drafts have input budgets, generation guards and source fallbacks.
A preview is never a save or an acknowledgement.

## Clipboard and attachments

Capture DataTransfer synchronously with `captureClipboard`. `preparePaste` is a pure,
offline conversion for text, Markdown, common HTML and TSV/CSV; code targets use plain
text. It returns `ready`, `needs-review` or `rejected`, original input, conversion issues
and resource descriptors. Complex tables and unsupported layout require a visible
choice between converted Markdown, plain text and cancellation. External HTML never
executes and remote images are not automatically downloaded during conversion.

`ResourceTask` owns progress, AbortSignal, retry and late-completion rejection.
`storeResource(file, context)` must return a durable document-relative or HTTP(S)
reference only after actual storage succeeds. Blob/data/file URLs never become saved
attachment references. Storage should be idempotent; cancellation does not delete
possibly shared assets. A failed batch changes no Markdown. Successfully stored parts
can be reused on retry. No unavailable storage capability is represented as success.

The native `chooseResource` hook can open a system picker without sending image bytes
through JavaScript. Native Hosts retain file authorization and resource size/format
limits. Hosts are responsible for durable copies, naming collisions and disk errors.
The table resource-paste bridge routes through the same session and persistence flow.

## Tables

The GFM table service supports row/column insertion and deletion, alignment, cell
editing, Tab/Shift-Tab navigation and rectangular copy/paste. Row zero is the header.
Expansion is reviewed before mutation. Delimiter style and untouched cells are retained
where representable; pipe/newline escaping is explicit. Complex merged/formula tables
are not silently represented as equivalent GFM tables. Narrow layouts expose current
cell editing and local scrolling rather than widening the whole document.

## Saving and recovery

`beginSave()` issues the exact draft to persist; `acknowledgeSaved(snapshot, revision)`
accepts only a matching issued source/identity. A later edit remains dirty. The instance
retains the latest 32 issued source snapshots; an older completion can be safely rejected
and must be reconciled by the Host, never blindly overwritten. Serialize actual saves
per document or implement equivalent compare-and-swap storage semantics.

`saveState`/`onSaveStateChange` distinguish saved, dirty, saving, error and conflict.
`markSaveFailed()` preserves the draft. An optional Host-owned `recoveryJournal` schedules
checksummed recovery records on edits and save failures. A scheduled record is not yet
a durable checkpoint. See [recovery](recovery.md) for IndexedDB, native disk adapters,
500 ms/2 s scheduling, damaged-record quarantine and three-version conflict review.

`update()` on a dirty document creates a conflict without replacing source.
`reconcile()` verifies an immutable review session, applies only selected safe patches,
and advances the incoming baseline only after all hunks are resolved. The Host must
re-read the real storage revision first. An unresolved conflict blocks saving over the
original. Accepting the external file must preserve the local draft as a durable copy.

## Fidelity and performance boundaries

Uniform UTF-8 LF/CRLF and an optional BOM survive source patches. The shared
`detectNewlinePolicy` protects mixed or CR-only line separators as read-only; Hosts may
explicitly create a normalized copy. These files must never be silently normalized over
the original. Unrecognized Markdown remains ordinary source.

`editingPerformancePolicy` provides a shared conservative source-preview fallback at
512 Ki UTF-16 units. Dense technical notes use indexed containment queries. Pure plain
paragraph edits can map existing decorations; syntax changes still rebuild them.
Inline analysis caches are keyed by immutable state and parser progress.

The local performance script records production bundle hashes, environment, subscriber
on/off results, warmups, raw samples, medians and p95. It measures source insertion and
paint boundaries in actual Live Edit. It does not certify every editing operation or
physical-device IME/VoiceOver latency. See [validation](validation.md).

## Controlled Host commands

Hosts can register namespaced, versioned local draft preparers through
`ControlledExtensionRegistry` or `EditingUIHost.extensions`. They receive a local
session and AbortSignal, never a parser or document transaction. Results are reviewed
before one guarded commit. See [controlled extensions](controlled-extensions.md).
