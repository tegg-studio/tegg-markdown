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

The structured inline link adapter preserves title, escaped labels and rich display
text. A rich label stays a read-only preview in its field editor; changing the target
does not flatten its formatting. Source reference editing exposes an explicit source
draft. Live reference editing shows a read-only destination until the user enters the
shared target scope, which lists the affected occurrences. Updating that definition
is one operation; missing, conflicting or unmappable definitions are not silently
merged or rewritten as inline links. A table-cell shared target stays in the cell's
local draft until completion, including when its editor is reopened.
Live ordinary and Wiki links keep their visible labels editable: an ordinary click or tap places the actual text caret and does not open the destination or reveal Markdown syntax. On macOS, Command-click explicitly opens a supported destination; Control-click belongs to the context menu. The existing link menu provides Open, Edit link and Copy link address. Copy retains the exact destination and reports success only after the Host completion Promise or browser write succeeds. Drag selection and composition take priority. A selected table cell first enters its existing text-editing state before these text-link actions apply; readonly preview selection does not create an editing capability. Reader keeps its existing click-to-open policy.

Metadata values use source-bound local patches; unknown fields, comments and untouched source remain. Hosts enabling value changes do not need a second whole-YAML action; Source remains available explicitly.
Math and diagram drafts expose their language body first, with the Markdown wrapper
available in a secondary source disclosure. Unchanged wrappers are preserved;
malformed or unsafe projections remain source. Drafts have input budgets, generation
guards and source fallbacks. A preview is never a save or an acknowledgement.

Built-in technical adapters expose an optional `validate` parser. A current math,
Mermaid or Graphviz draft is checked before completion: pending validation and actual
syntax errors disable Done and the leave choice's Complete action. Engine, resource
or preview-budget unavailability does not masquerade as a syntax error. Inputs stay
available for correction or copying; cancelled and replaced drafts ignore late results.
A custom renderer without a validator remains usable without an inferred syntax claim.

## Readonly document inspection

`ui.openInspection({projection: "reader" | "live" | "source"})` opens a readonly
inventory of comments, shared definitions, anchors and declarations omitted from the
safe projection. It joins the actual draft/IME preflight and never queues a rejected
open. Search and per-entry Copy do not edit the document. Copy reports success only
when the Host callback or browser clipboard write resolves. Inspection has Close and
source-owned Locate actions, without a completion/save action.

`EditingUIHost.source()` can provide the original source, including its line separators;
the default is the current state's `sliceDoc()`. The `tegg-inspection-locate` event carries
`coordinates: "source"`, original UTF-16 `sourceRange` and `ownerRange`, captured
`identity`, and `expandedCount`. One Locate expands current session folds without
changing author `open` or Callout markers. Hosts validate identity and translate original
positions to their editor's normalized offsets before a Source/Live selection.
`TechnicalMarkdownReader.locateSourceRange(range)` and
`locateRenderedSourceRange(root, range)` instead use actual renderer registrations to
synchronize display folds, scroll and focus a visible Reader owner; author attributes
cannot authorize a location. `TeggMarkdownReader` exposes the same method.

`ui.inspectionElement` grants the current readonly panel's exact DOM ownership and
returns null after closing, destruction or reuse for Search or an object. Inspection is
excluded from `captureActiveDrafts()` and never creates an editing session.

## Leaving an editing surface

Call `editor.prepareLeave()` before document navigation, closing a panel or replacing
an editing surface. `setMode()` runs the same preflight. Valid table-cell and metadata
value drafts commit before leaving; invalid or composing drafts remain in place.
Independent dirty objects require Complete, Discard or Keep editing. A rejected
composition attempt is not queued and must never run automatically after composition.

Low-level Hosts using `EditingController` and their own `EditorView` call
`prepareEditingLeave(view, overlayRoot, controller)` from `/core`. Keep the attached
editing UI alive while the result is false. Its read-only `awaitingLeaveChoice` getter
includes projected child editors and is true only for an explicit pending draft
choice. `ui.captureActiveDrafts()` returns only mounted, source-bound main and nested
object sessions, dedicated link drafts, active HTML-cell drafts and metadata value forms. Every item has `{kind, panel, current}`;
`kind: "object"` also carries its real `controller` and `token`, while `kind: "link"`
uses the dedicated link controller's lease. `kind: "html-cell"` binds the actual
local draft and cell, preserving ownership when focus moves to its independent child
editor and revoking it when the cell cancels, completes or reopens. It excludes Search, Viewer and author
DOM impersonations. Keep the captured lease and call `current()` again
before granting completion of an existing draft: cancellation, panel reuse, document
identity/source changes and session retirement invalidate it. This ownership check
does not override read-only, composition, expected-source or commit validation.
`kind: "metadata"` uses the actual generated value form and its editor token. Save,
cancel, panel disposal or opening a new value permanently invalidates an old lease.
Author HTML that resembles a metadata form cannot acquire editing permission.
`captureActiveHtmlDirectInput(view)` captures only a currently focused registered
HTML text projection; leaving that input revokes this continuous-input lease.

A false preflight result can also mean IME, invalid input or a resource operation;
it is not permission to destroy a draft or a request to replay navigation later.

Listen for `tegg-editing-leave-resolved` and `tegg-editing-leave-cancelled` on the
actual overlay container passed to `attachEditingUI`, including sibling child UIs.
Resolved carries `detail.choice` as `complete` or `discard`. Keep editing and explicit
cancellation emit cancelled. The Host clears any pending action on cancellation,
composition rejection and document identity change; it validates identity again
before executing an action after an explicit resolution.

## Clipboard and attachments

Link destination and display-text popovers are independent field drafts. Blurring
never submits them. Dirty fields join the same leave boundary in prose, table-cell
and footnote child views; Complete, Discard and Keep editing apply to those fields
before an outer cell can commit. A changed source target retains the fields and
rejects completion. Composition rejects leaving and cancels an earlier pending
choice, so later completion cannot replay that rejected navigation. The attached
editing UI aggregates these choices and forwards resolution to its overlay root.

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
Inside a cell's text editor, the captured text selection is the target. Successful
attachment storage changes only that cell's local draft until cell completion.
The same input in cell-selection state follows the reviewed matrix transaction.
A Host must not apply a cell attachment directly to the outer document before
completion, or recapture a new caret after asynchronous storage.

Semantic Copy/Cut requests plain text, controlled HTML and a structural copy. A
whole rendered source block uses a trusted renderer-owned range rather than author
HTML attributes. Exact source and required reference/footnote definitions survive
that copy; a partial unsupported range uses controlled visible content or rejects it.
Native Hosts handle `tegg-copy-content` / `tegg-read-content` with the same completion
contract used for tables, including their structural MIME type. Paste reads the
native representations before applying the guarded captured selection.

`copyText` callbacks return a Promise that resolves only after the real write succeeds.
Technical copy requests keep `tegg-copy-text`'s string detail and optionally attach
`event.completion: Promise<void>`. Cancelling that event without a completion Promise
is legacy handling, not a confirmed write. Copy success is shown only after an actual
completion; composition prevents copying, and a late result cannot update a new
panel, document or changed code body.

HTML table Copy/Cut requests plain text, controlled HTML and a structural copy.
Native Hosts handle `tegg-copy-table` / `tegg-read-table` and complete the supplied
callback. Cut clears a range only after a successful three-representation write
acknowledgement and a fresh document, generation and source check; it forms one
parent Undo operation. A failed rich write does not silently fall back to `writeText`.
Unsupported input stays available, with plain-text insertion as an explicit choice.

## Tables

The GFM table service supports row/column insertion and deletion, alignment, cell
editing, Tab/Shift-Tab navigation and rectangular copy/paste. Row zero is the header.
Expansion is reviewed before mutation. Delimiter style and untouched cells are retained
where representable; pipe/newline escaping is explicit. For the standard empty field
containing exactly two ASCII spaces, entering content keeps one existing space on
either side. Other empty-field whitespace retains its existing behavior; this does
not normalize an authored row or table. Complex merged/formula tables
are not silently represented as equivalent GFM tables. Narrow layouts expose current
cell editing and local scrolling rather than widening the whole document.

A single click selects a cell; double-click, F2 or the edit shortcut enters its
text editor. On touch, a second deliberate tap on the same selected cell enters
editing; it does not require a rapid double-tap. Scrolling, cancellation and clicks
on controls do not count as that second tap. Preview link labels follow the same cell-selection and second-tap editing path; they do not navigate. GFM cells use a small CodeMirror view with projected inline formatting;
HTML cells use a source-preserving rich draft. Typing, formatting and local Undo/Redo
remain inside the cell draft. Completion commits one isolated parent-document Undo
operation. Escape cancels the draft; focus loss does not silently apply it.

Return completes and moves vertically; Tab completes and moves horizontally.
A final GFM-cell Tab appends the next row as one operation, while a final HTML-cell
Tab leaves the object. Code inside an HTML cell owns literal Return and four-space
Tab before parent cell navigation. Preview selection and text editing have distinct
command availability; unsupported block commands cannot affect a retained prose
selection. While editing a cell, ordinary link clicks place the caret in the visible label without navigating or committing the cell. Explicit link actions use the existing destination editor and controlled navigation policy.

Pasting inside a text editor inserts or replaces only the captured text selection.
A multi-cell matrix does not spill into neighboring cells; conversion or multiple
blocks require explicit review. Pasting into cell-selection state uses the table
rectangle and reviews expansion first. GFM and supported HTML tables expose source-
bound row/column operations and clipboard representations. HTML merged-cell ranges
close over complete spans; unsupported grids and unsafe structural operations are
rejected while retaining their original source.

The cell-selection tint appears only while focus is within that table. Leaving
the table removes the tint without discarding the retained cell position; returning
restores it. Table controls manage rows and columns, while text formatting uses the
shared inline toolbar rather than a separate per-cell block menu. Add Row and
Add Column append at the end of the table; insert-before and insert-after remain
separate actions. The table actions control and existing object menu share the
mounted GFM or supported HTML table's action catalog. A Host can use full inline
controls, a compact table-actions menu, or the existing object menu when the
object's empty area cannot fit the controls. It must retain all original actions
without resizing the grid or intercepting cell taps. Touch targets the actual
mounted table without moving the main document caret. Read-only tables expose
only Copy cells through this catalog; incomplete or unsupported HTML retains
its Source fallback. Dimension information remains accessible without creating
another content row.

## Live semantic projection

Composition finishes its document update before a display-only projection redraw. Multiline comments hide without adding a line box when inactive, and a focused comment retains its literal source. Session-driven Callout expansion refreshes its body, fold control and accessible state together without moving the prose selection or adding history.

Live Edit keeps Markdown as the editable document. A complete, safely rendered
`<details>...</details>` container is projected as one unit across blank lines, so
its content stays inside the disclosure. Malformed or unclosed containers remain
visible source. Safe source-mappable HTML text and inline formatting edit directly in the projection.
The mapper preserves untouched tags, attributes, comments and entities. Activation and document-edge navigation retain a caret inside the actual editable author content; an input whose selection crosses outside that content is refused without changing the parent source. Unmappable
content retains a read-only explanation and explicit Source access; arbitrary HTML
never executes. A title-only details Return provides a temporary body caret without
writing a fake paragraph; the first effective input creates its source. Missing
summary labels are display-only until actual title input. Shift-Return inserts a
summary hard break while retaining its expansion state.

In the Tegg profile, an explicitly balanced HTML container with a `pre` subtree
keeps its literal blank lines in both Reader and Live Edit. Code input uses real
LF characters and plain text paste; selected-line Tab/Shift-Tab preserve untouched
source elements. Each indentation has its own Undo operation and retains the
selection direction. Ordinary inline formatting is unavailable inside literal
code; an existing inline-code span supports an explicit code toggle off.

Footnote references and definition descriptions are projected only when the
selected profile parses them in context. Escaped `\[^label]` and an ordinary
`: text` line retain their literal meaning. Footnotes form one projected section,
including unreferenced, repeated and undefined labels without fake numbering or
source merging. Each definition's child editor maps patches back to that original
definition. Its independent object UI inherits the parent Host's locale, renderers,
resource callbacks and overlay root; child source offsets are never outer offsets.

In the `tegg` profile, a Callout keeps its type marker projected while the caret
moves through its directly editable title and body. The type menu changes only
the type; an explicit “View Callout Markdown” action exposes the header source.
Nested quote structure stays in the underlying Markdown. The `github` profile
supports its standard alerts, while `gfm` leaves Callout syntax as source.

Clicking an inline formula selects it and shows compact View and Edit actions.
Double-click or Enter/F2 opens a local formula edit; View opens the viewer.
Escape or moving focus away closes the actions. Read-only formula controls allow
viewing without editing. Unsupported or invalid syntax stays available in Source.

## Display state shared between Reader and Live Edit

`TeggMarkdownEditor` shares one `ContentDisplaySession` for the current document.
Code wrapping, Callout/details expansion and table/math/diagram horizontal offsets
stay consistent across projections and follow source edits. Changing or replacing
the document resets that session. Display state does not change author Markdown.

A low-level Host shares a `ContentDisplaySession` through the editor's
`resourceContext` facet and the Reader's `displaySession` option, and includes
`displaySessionMapping` in the editor state. Do not rebuild object identity from
current source offsets alone, or share the session between unrelated documents.
Projected footnote editors map their local display ranges back to the parent source.

Mounted Details, Callouts and code controls follow session changes without replacing
an active draft or changing source, caret or Undo history. Reader blocks that survive
source edits rebind their display ranges from the current parse. Stable display IDs
let a hidden retained Reader follow a mapped object before its next render; removed
objects and document resets revoke those IDs. Subscriptions are released when their
projection is removed or destroyed.

Document inspection maps comments inside accepted footnote bodies to the rendered
body owner, excluding definition markers. Location expands the matching Reader or
Live display session while preserving the original LF/CRLF source coordinates.

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
