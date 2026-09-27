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

## Natural editing commands

Live Edit resolves a command against the current semantic container and selection.
Paragraph splits, list continuation indentation, nested quotes and heading changes
use guarded local source patches. Source mode remains literal. A structural command
does not silently serialize the whole document or reinterpret unsupported syntax.

With no text selected, inline formatting arms the next input rather than inserting
placeholder text. Toggling it off preserves the caret and existing formatting on
either side. Composition input is applied once; mode changes clear pending styles.
Selections with mixed formatting follow the shared inline-format command semantics.

The optional shared UI provides an empty-block plus button, a Slash command menu,
and an existing-block menu with paragraph styles, list styles and move-up/down commands. Escape or
clicking outside dismisses the menu without deleting a typed query. Code is inserted
directly and its body receives focus. Formula and diagram commands open a local
draft first: Cancel preserves the original query, and Apply commits one operation.
Menus respect the grammar profile, read-only state and composition; they do not
capture ordinary typing inside code, table cells or other local editors. Dragging
blocks is not implemented by this menu.

The block trigger identifies the current type with a compact text or line icon.
Paragraph style and list style are independent: changing a heading inside a list
or quote preserves that container. Current-style checkmarks are separate from
keyboard navigation highlighting. Wrapping an entire list in a quote is labelled
explicitly. Metadata YAML and other object editors do not offer prose block actions.
The menu stays inside the visible editor region and scrolls when space is limited.
Ordinary text focus does not paint a full-row selection or imply drag support.

Native hosts should route commands through the same SDK capability checks. When a
table cell owns focus, inline commands target that cell and block commands are
unavailable. When focus is on the table preview or its controls, prose formatting
and block commands are unavailable; retained outer selection is not an editing
target. Undo, redo and find remain available. A separate dialog or input must never
dispatch to an old document selection merely because the outer editor still has one.

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
Math and diagram drafts expose their language body first, with the Markdown wrapper
available in a secondary source disclosure. Unchanged wrappers are preserved;
malformed or unsafe projections remain source. Drafts have input budgets, generation
guards and source fallbacks. A preview is never a save or an acknowledgement.

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

Live cell editing uses a small CodeMirror view with projected inline formatting.
The parent Markdown document owns changes and the only undo history. Ordinary
typing can form one history group; formatting and leaving a cell form explicit
boundaries. Select-all is scoped to the cell, Tab/Shift-Tab move between cells, and
Escape returns to its cell control. Undo/redo stays available from either focus.
Links use the shared destination editor and navigation policy.
The cell-selection tint appears only while focus is within that table. Leaving
the table removes the tint without discarding the retained cell position; returning
restores it. Table controls manage rows and columns, while text formatting uses the
shared inline toolbar rather than a separate per-cell block menu. The compact
table toolbar keeps Add Row and Add Column visible; selection, cell copying and
source editing remain available from the table actions menu. Dimensions stay on
one line, with responsive controls rather than overflowing the document.

## Live semantic projection

Live Edit keeps Markdown as the editable document. A complete, safely rendered
`<details>...</details>` container is projected as one unit across blank lines, so
its content stays inside the disclosure. Malformed or unclosed containers remain
visible source. Raw HTML editing uses Source; projection does not make arbitrary
HTML executable or promise full browser HTML editing.

Footnote references and definition descriptions are projected only when the
selected profile parses them in context. Escaped `\[^label]` and an ordinary
`: text` line retain their literal meaning.

In the `tegg` profile, a Callout keeps its type marker projected while the caret
moves through its directly editable title and body. The type menu changes only
the type; an explicit “View Callout Markdown” action exposes the header source.
Nested quote structure stays in the underlying Markdown. The `github` profile
supports its standard alerts, while `gfm` leaves Callout syntax as source.

Clicking an inline formula selects it and shows compact View and Edit actions.
Double-click or Enter/F2 opens a local formula edit; View opens the viewer.
Escape or moving focus away closes the actions. Read-only formula controls allow
viewing without editing. Unsupported or invalid syntax stays available in Source.

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
