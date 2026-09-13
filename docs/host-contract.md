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
The default leaves image sources unchanged. Footnotes, tables, quotes and normal
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
This is browser-only, not an SSR API. Treat preview API changes as possible until
a stable release; pin a reviewed version.
