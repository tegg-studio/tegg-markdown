# An editor with optional editing controls

Install a reviewed SDK tarball in an independent project. The new editing controls are candidate APIs; do not assume that the current npm registry release includes them.

`vanilla.ts` mounts `TeggMarkdownEditor` and `attachEditingUI`. `ReactEditor.ts` composes the SDK React wrapper with the same optional UI. Both use public package entries and one controller per editor. Include `editor.css` and `ui.css`, give the editor a meaningful height, and destroy the UI before destroying its editor.

Pass a Host with `storeResource(file, context)` to enable file selection, image paste and drop. Store `file.blob` or the native `file.handle` in your own authorized storage, report real progress, and return `{reference: "assets/image.png"}` or a durable HTTP(S) reference. Rendering resolves that reference independently through the editor Host. Temporary object URLs are presentation resources and must not be returned as the saved reference. Cancellation can race with storage completion; keep storage idempotent and retain shared files when an insertion is cancelled or undone.

The Host owns saving and recovery. Serialize exact snapshots per document, compare their base revision in the storage transaction, and acknowledge only successful writes. Handle `update()` conflicts through the Host reconciliation flow. A rejected update must not overwrite the local draft. The wrappers deliberately do not invent a revision or report an in-memory callback as durable saving.

Run the SDK's reproducible browser example with:

```sh
npm run build
npm run check:consumers
npx playwright test tests/browser/reliable.spec.ts
```

`check:consumers` packs the actual distribution and installs it outside the source checkout. Its `reliable` consumer exercises the same public APIs. The loopback test server writes selected test files to a separate fixture directory and injects HTTP failure and late responses; it is a test adapter, not a production authentication or storage service. The browser suite covers Chromium, Firefox and WebKit, source/undo results, resource reopening, keyboard controls and accessibility. Clipboard event tests exercise browser event capture with explicit fixture data; they do not certify an operating-system clipboard or input method.
