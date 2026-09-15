# Validation status — 0.2.0-preview.2

## Current published version

`@tegg/markdown@0.2.0-preview.2` is published on npm. The package was built from
`6d03f9457768283e16113d870d25175bc918e730`; merged main commit
`d6a3409e8481ec77fdfd409130348098e8715d0c` has the same source tree.
See [artifact integrity and installation](npm-release.md).

- Core: 40 files / 2,892 tests passed; HTTP CAS checks passed.
- Four real registry consumers: vanilla, React 18, React 19 and optional engines;
  modern/legacy TypeScript resolution, production builds and all 21 runtime hashes passed.
- Browser: 49 Chromium/Firefox/WebKit checks passed, including source/save/undo,
  constrained/natural React height, Mermaid color/CSP and lifecycle behavior.
- [Mermaid CI](https://github.com/tegg-studio/tegg-markdown/actions/runs/34810728330)
  passed for 11.9.0, 11.10.0 and the latest compatible 11.x at the run date.
- Mac candidate consumption: 36 files / 1,545 Web tests and local Debug App/Quick
  Look builds passed. This version has no new native window or Finder visual acceptance.
  Release signing is a separate unresolved host configuration check.
- The complete performance baseline below was not rerun for preview.2. No new
  OS IME, assistive-technology or full browser-product certification is claimed.

## Historical preview.1 SDK evidence (2026-09-14)

- 39 test files / 2,889 tests passed, including all 652 CommonMark 0.31.2 and
  672 GFM 0.29 fixed examples, without skips. Normative parser comparisons are
  distinct from sanitized browser output and additional GitHub product features.
- Type checking, production builds, declared exports and mandatory license inventory
  passed. The Attribution License and required visible branding are unchanged.
- Independent vanilla, React 18, React 19 and optional-engine tarball consumers are
  built outside the SDK checkout. Reader's module graph excludes unconfigured heavy
  engines, React and CodeMirror; the package installation tree still contains shared
  Editor dependencies. React SSR shells and public types have separate checks.
- 37 browser regression checks cover Chromium, Firefox and WebKit: real CSP headers, local
  math/diagram/geometry rendering, default control accessibility, eight instances,
  100 lifecycle cycles, React StrictMode/Context and draft/save/undo behavior.
  Streaming runs at 20 and 50 snapshots/second for 30 seconds, checking final source
  and a reading anchor within 2 CSS pixels. Chromium additionally records post-GC
  heap/DOM/listener counts; that CDP test is not claimed for other engines. Actual
  Graphviz idle worker reclamation and recreation also pass in all three engines.
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

## Native evidence and remaining boundaries

The Mac Host consumed candidate `0ff177e749c0568442e350d4a68adc1cfab8df79` on
macOS 26.6 / Xcode 26.5: 1,545 Host tests, native build/launch, and actual
Reader/Live Edit/Source, task/table/code editing, undo/redo, exact file save,
relative navigation/reopen, local images and viewer Escape/focus restoration passed.
Finder Quick Look actually displayed the same fixture; restricted sibling images
showed a clear fallback while the application loaded them.

Final native follow-up on the released Git tag `v0.2.0-preview.1`
(`cdfe69e9ec708f88d6459afb07ffe2a337060ced`) also passed: Live Edit visibly retains
unresolved reference brackets; an actual code edit followed by undo and save
restored the exact file bytes; Reader, local-link navigation and return/reopen
preserved the saved content. Finder Quick Look displayed the same final document,
including literal brackets, table, code and formula. The earlier locked-machine
blocker is resolved. This is a validation-record update; the immutable preview
artifact and its runtime are unchanged.

Synthetic composition tests are not real macOS Pinyin, Sogou, Windows
Microsoft Pinyin or VoiceOver/NVDA testing. Playwright engines are not certification
of the latest two Chrome/Edge/Firefox/Safari product versions. No Windows native app or
mobile device matrix has been exercised in this record. Linux CI and local macOS
Playwright runs are separately identified by their artifacts.

The published performance run measures initial streaming rendering with diagrams
pending. Parser-only, settled completion with fallback counts and isolated Source input
are recorded in [layered measurements](performance-layers.json); subscribed Host
toolbars and Live Edit input timing still require their own workload measurements; the internal 200 KiB/300 ms and input-p95/16 ms targets
are not a public SLA. Offline geometry and KaTeX have documented compatibility limits.

The final code candidate [CI run](https://github.com/tegg-studio/tegg-markdown/actions/runs/34774188719) passed on Linux. Subsequent documentation and merge identities are tracked by PR #5 and release artifacts.

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

## Integration regression follow-up (0.2.0-preview.2)

The release adds assertions for actual Mermaid node fill/stroke, React constrained
and natural-height layouts, legacy Node-style TypeScript subpath resolution,
profile command discovery and table quantity localization. Mermaid compatibility CI
installs 11.9.0, 11.10.0 and the latest compatible 11.x separately, records the resolved
version and exercises all three engines. A generated SVG or a passing old sanitizer
suite alone is not evidence of readable colors. The previous lockfile already used
Mermaid 11.17.2; this was an assertion gap, not simply use of an old engine.

Historical test totals and performance samples above describe their recorded
artifacts. New totals and the published identity are recorded above and by CI;
this follow-up does not claim to have rerun the complete performance benchmark.

## npm registry installation (2026-09-14)

`@tegg/markdown@0.2.0-preview.2` was installed from the official registry in four
independent vanilla/React 18/React 19/optional-engine consumers. Their lockfiles
resolve to registry tarballs with the published integrity, and all 21 runtime
JS/CSS hashes match the pre-publication artifact. Modern and legacy TypeScript
resolution, production builds and all 49 Chromium/Firefox/WebKit browser checks
passed. See [published artifact](npm-release.md#published-artifact). Native OS
interaction and performance coverage retain their previously documented limits.

## Reliable editing development gate

- `npm run verify:reliable`: typecheck, complete unit/fidelity suite, build and package
  inventory, CAS, independent packed consumers, three-engine browser workflows, and
  the independent IndexedDB/conflict UI browser suite.
- `npm run test:performance:editing`: requires `.validation/baseline-dist` from the
  recorded unmodified baseline; writes raw production Live Edit measurements.
- `node scripts/interaction-performance.mjs`: production Editor/UI table and object
  draft measurements, complex-preview cancellation, eight simultaneous Editors and
  100 full session/destroy cycles. Writes raw samples and Chromium resource counts
  to `.validation/interaction-performance-results.json`. Run performance commands
  sequentially on an otherwise quiet runner; failure remains a failure.
- `npm run test:performance`: existing Reader relative gate. Keep Reader and settled
  Live Edit measurements distinct.
- `tests/fixtures/reliable/fidelity-cases.json`: 30 source constructs × three profiles
  × LF/CRLF × BOM/no BOM, tested through edits, mode changes and save/reopen.
- Native Hosts separately run macOS XCTest/WKWebView/window workflows and iPhone/iPad
  simulator builds/tests against the same immutable SDK dependency.

A test failure, skipped test or unavailable OS permission must remain visible in the
acceptance report. Browser-created composition/clipboard events prove event handling,
not a real operating-system IME or clipboard. Physical VoiceOver, real iCloud devices
and the oldest supported operating systems need their own evidence. No release is
implied by this development gate.
