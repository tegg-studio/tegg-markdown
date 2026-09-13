# Preview validation — 2026-09-13

## Completed evidence

- Node/npm type checking passed.
- 33 Vitest files, 1512 tests passed, including inherited core regressions and
  11 standalone SDK tests for attribution, modes/undo, stale save completion,
  conflicts, instance lifecycle/resources, CRLF, composition guards, streaming
  and native-independent callout selection.
- ES module, CSS, graph worker and TypeScript declaration builds passed.
- npm pack inventory checks include all mandatory legal materials.
- A separate directory installed the real tarball, with matching JS/CSS hashes.
  Its own Vite Host ran in desktop Chromium through Playwright.
- Browser assertions passed: Unicode Chinese text editing; Reader/Live Edit/Source
  switching; callout type change and undo; saving exact Markdown without injected
  attribution; destroying/recreating the editor and reopening; attribution fixed
  outside document scrolling; Mermaid and Graphviz SVG rendering; no page errors.
- Production npm audit reported zero known vulnerabilities at validation time.
  This is a registry advisory check, not a comprehensive security audit.
- Curated public files were checked for common secret patterns and private local
  paths; no findings. Repository-relative Markdown links resolved.
- Production dependency inventory includes 152 installed npm packages; additional
  embedded Graphviz, Expat, Emscripten, ColorBrewer, rbtree and Lucide/Feather
  licensing is retained separately.

## Limits

This is a developer preview. Automated Unicode input is not verification of a
real macOS/iOS Chinese IME session. VoiceOver, native WebView/device matrices,
third-party customer adoption, npm publication and migration of Tegg Notes to
this package are not claimed. Custom licensing materials have not received an
independent external legal opinion. A commercial policy is not an executed
white-label contract.

Use npm ci and npm run check to reproduce automated core and packaging checks.
Follow README's packed-install example for the separate Host; exercise the
operations above on each supported deployment target before making platform
compatibility promises.

## Follow-up startup verification — 2026-09-13

A real table-cell edit followed by Enter exposed a duplicate commit on blur.
The editing session now ends before dispatching its source patch. A regression
test covers Enter, blur and undo. The updated full suite passed 1513 tests in
33 files; type checking, builds and package inventory passed. Chromium repeated
Chinese table-cell editing, all three modes, saving and destruction/reopening
with two attribution links and no page errors.

## 2026-09-13 — preview.2 Mac Host alignment

- SDK: 33 files / 1,521 tests passed; typecheck (including example), build and
  package inventory passed. Both public entries and declaration files are packed.
- Chromium: real table cell edit + Enter, three modes, current outline navigation,
  font/width changes, source-visible accessibility toggle and save/reopen passed.
  Saved Markdown was checked for the edited table and absence of attribution.
  No page errors occurred in this run; the footer remained visible at 1280 × 720.
- Mac integration: the document surface and Quick Look reader compiled using the
  packaged core. Mac Web tests: 34 files / 1,542 tests passed, including native
  toolbar synchronization against the real package and moved-document resources.
- Native macOS: build succeeded, the application launched, and an actual temporary
  Markdown document rendered. A table cell changed to `共享包验证通过`, the native
  Callout menu changed NOTE to warning, and both source changes were verified in
  the saved file. Reader mode displayed those changes.
- `examples/fixtures/editor-alignment.md` is the small shared smoke fixture.
  It does not replace the full syntax/IME/VoiceOver/Quick Look acceptance matrix.

This is shared-core integration plus scoped interaction evidence, not complete
Mac/browser visual parity. Native CSS/chrome remain in the Host. Real OS input
candidate sessions and a complete VoiceOver pass are still unverified.
