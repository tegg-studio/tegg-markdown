# Validation status - 0.2.0-preview.1

This developer preview is distributed through reviewed Git commits and tarballs.
It is not an npm registry release or a complete browser/platform certification.

## Current SDK evidence (2026-09-14)

- 39 test files / 2,884 tests passed, including all 652 CommonMark 0.31.2 and
  672 GFM 0.29 fixed examples, without skips. Normative parser comparisons are
  distinct from sanitized browser output and additional GitHub product features.
- Type checking, production builds, declared exports and mandatory license inventory
  passed. The Attribution License and required visible branding are unchanged.
- Independent vanilla, React 18, React 19 and optional-engine tarball consumers are
  built outside the SDK checkout. Reader's module graph excludes unconfigured heavy
  engines, React and CodeMirror; the package installation tree still contains shared
  Editor dependencies. React SSR shells and public types have separate checks.
- Browser regression covers Chromium, Firefox and WebKit: real CSP headers, local
  math/diagram/geometry rendering, default control accessibility, eight instances,
  100 lifecycle cycles, React StrictMode/Context and draft/save/undo behavior.
  Streaming runs at 20 and 50 snapshots/second for 30 seconds, checking final source
  and a reading anchor within 2 CSS pixels. Chromium additionally records post-GC
  heap/DOM/listener counts; that CDP test is not claimed for other engines.
- The HTTP CAS example verifies one success and one conflict from two writers using
  the same base revision, preserving exact CRLF/Unicode source.
- Fifteen production A/B performance groups pass the 15% AND 5 ms median/p95 gate
  for DOM completion and two-frame paint opportunity. See the complete samples,
  artifact hashes, environment and method in [performance-results.json](performance-results.json).
  Initial 200 KiB plain text exposed a p95 regression (12.4 to 19 ms); native subtree
  transfer replaced per-node moves. The final run measured 12.7 to 16.1 ms.
  One MiB falls back to complete source; this is not full rich-rendering throughput.
- The dependency advisory audit was clear after updating the test runner. Advisory
  status is time-dependent and does not replace review of Host authorization.

## Boundaries still requiring separate evidence

The native Host consumes an exact SDK commit and requires its own build and UI
journey. Until a native record is added below, this section does not certify that
migration. Synthetic composition tests are not real macOS Pinyin, Sogou, Windows
Microsoft Pinyin or VoiceOver/NVDA testing. Playwright engines are not certification
of the latest two Chrome/Edge/Firefox/Safari product versions. No Windows runner or
mobile device matrix has been exercised in this record.

The published performance run measures initial streaming rendering with diagrams
pending. Parse-only, heavy-object fully-ready latency and sustained editing latency
remain separate measurements; the internal 200 KiB/300 ms and input-p95/16 ms targets
are not a public SLA. Offline geometry and KaTeX have documented compatibility limits.

Run `npm run check`, `npm run test:cas`, `npm run check:consumers` and
`npm run test:browser`. `scripts/release-evidence.mjs` records the exact clean commit,
package integrity, lock/fixture hashes and browser summary in CI artifacts; it rejects
uncommitted or mismatched package identities. Mac evidence stays separately scoped.

---

## Historical 0.1 preview evidence

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
