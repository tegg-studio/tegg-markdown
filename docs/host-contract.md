# Host contract

## Ownership

Markdown is authoritative. The SDK derives rendering and source patches; the
Host owns storage, permission checks, documentId, opaque revision strings, image
resolution, links and conflicts. Revisions must reflect the Host's actual storage
state, not timestamps invented by the SDK.

Construct `TeggMarkdownEditor(root, document, host, mode)` with a dedicated root
of a meaningful height. Keep mode in `reader | live | source`.
Call `destroy()` before dropping an instance. It removes only its own frame.
Multiple independent instances may coexist on the same document page.

## Local changes and saving

`onChange` receives a snapshot with source, documentId, baseRevision, generation
and sequence. It is delivered after the CodeMirror transaction. It does not
save. For asynchronous saves, serialize saves per document or implement an
equivalent compare-and-swap strategy. Capture `snapshot()`, save that exact
source against baseRevision, then call `acknowledgeSaved(snapshot, newRevision)`.

If a later local edit happens while saving, acknowledgement updates the base
revision but keeps that later edit dirty. A completion from an old document
generation or stale base revision returns false. The Host must reconcile it;
do not blindly retry writing against a newer revision.

Use only snapshots actually issued by this instance. Advanced manipulation
through `view` is subject to CodeMirror's transaction contract.

## External changes

`update(document)` refuses to overwrite a dirty draft and returns `conflict`,
also calling `onConflict`. This includes a newer revision or different document.
Once a person or Host policy explicitly resolves it, `replaceDocument` discards
the draft and resets undo. It never saves the discarded draft automatically.
Updates during IME composition return `composing`; the Host retains and retries
the latest pending input after composition finishes.

Streaming content is shown in Reader and cannot be edited through normal SDK
commands. After updating to `contentState: "settled"`, choose Live Edit or Source.
Modes preserve undo; replacing a document deliberately starts a fresh session.

## Resources and navigation

`resolveImage(src, documentPath)` is synchronous and belongs to each instance.
Return a browser-loadable URL (for example an object URL, or an allowlisted URL).
The default blocks resource URLs; configure `resourcePolicy` explicitly. Both synchronous `resolveImage` and asynchronous `resolveResource` results pass this policy. Footnotes, tables, quotes and normal
images use the instance context. The Host controls remote image/network policy;
rendering a URL can cause the browser to request it.

`openLink` receives navigation requests; validate schemes and destination rights.
The SDK does not grant filesystem access. `copyText` can bridge an application
clipboard; otherwise browser clipboard support applies.

## Accessibility and limits

Source mode exposes a CodeMirror editor; Reader exposes semantic document content.
Guarding composition transitions is automated; real OS IME, VoiceOver and
platform-specific WebViews need target-platform acceptance.
Use uniform LF or CRLF input; mixed newline styles are not a fidelity guarantee.
Instance creation and rendering require a browser DOM; lightweight module import is safe during SSR. Treat preview API changes as possible until
a stable release; pin a reviewed version.

## UI state, outline and native menus (preview.2)

`editor.state` and `onStateChange` report formatting, mixed selections, mode, dirty
state and undo/redo availability. `command()` rejects unknown commands, Reader,
streaming, composition and focused independent widget inputs. Toolbar actions
should preserve the editor selection; commands use CodeMirror's retained selection.

`outline()` returns `{documentId, generation, sequence, headings}`. Pass that
snapshot to `navigateHeading(id, snapshot)` to reject stale UI actions. The outline
callback is debounced 150 ms. A Host handling a click sooner may request a fresh
snapshot and validate the chosen heading's identity/title before navigating.
`navigateFragment()` uses the same parser as the native Host. `ready()` waits for
the current Reader render. Navigation checks identity again after awaiting it.

`setAppearance({fontScale, contentWidth, toolbarInset, background, text, muted,
border, accent, accentSoft})` only changes the instance. `setAccessibility(true)`
keeps editing syntax visible and preserves undo; it rejects a composition in flight.
It does not substitute for assistive-technology testing.

A native Host may implement async `selectCalloutType({current, x, y, viewportWidth})`.
Return the selected type or null. The editor validates the response against source,
generation and mode before applying a source patch.

## Asynchronous resources and selections

`resolveResource(src, {documentId, documentPath, signal})` resolves a URL or null.
New renders abort obsolete resource work; late results do not update a newer document.
Failures keep alt/source available and report through `onError`. It is a Reader
presentation hook; Live Edit uses the synchronous `resolveImage` cache. A Host can
prefetch authorized resources, cache owned URLs and expose them through that resolver.

`onSelection` receives documentId/revision/text. Editor `selection()` additionally
returns generation/sequence and an exact UTF-16 source range for the current draft.
Reader selections deliberately omit source ranges because display transformations
need not map to a single contiguous source range. Never infer write offsets from
rendered text.

See the [local HTTP CAS example](../examples/http-cas/README.md) for a tested atomic
revision comparison and exact save/reopen. SDK conflict events alone do not implement
a storage transaction, Git write or backend lock.

## Command availability

Use `getSupportedCommands(profile)` or `editor.state.commands` for static profile
support; these immutable arrays have stable identity. `editor.commandStatus(name)`
returns `{supported, enabled, reason?}` for profile, editing focus/mode, selection
and undo history constraints. Querying it does not edit source or save state.
`command()` checks the same rules and retains its boolean result. Toolbar subscriptions
receive profile/command metadata with the existing state update, not a second event
stream. Neither the support list nor query enables network resources or installs
an optional renderer.

## Reliable editing additions

See [reliable editing](reliable-editing.md) for the shared controller, optional `/ui`,
attachment storage and newline policy. `beginSave`/`saveState` are useful Host signals;
they never perform I/O. Exact issued snapshot verification rejects forged source and
unresolved incoming conflicts. The latest 32 issued snapshots are retained; a delayed
older completion may need Host reconciliation. Recovery journals and three-version
decisions are described in [recovery](recovery.md).
