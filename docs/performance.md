# Performance and resource budgets

Measure the installed production artifact, not just the library's build output.
`scripts/prepare-consumers.mjs` creates actual tarball consumers outside the source
checkout, type-checks them, builds them, checks SSR imports and records module graphs.
The minimal Reader graph rejects CodeMirror, React and unconfigured heavy engines.
The single package's installation tree still includes shared Editor dependencies;
lightweight JavaScript loading is not a claim that the npm installation has no such
packages. Heavy engines and React are optional peers.

`scripts/performance.mjs` compares a retained baseline distribution and the current
production build on deterministic ASCII/UTF-8 20 KiB, 200 KiB and 1 MiB fixtures:
text, mixed Markdown, formulas/diagrams, tables, and adversarial nesting/punctuation.
It alternates old/new order, performs five warmups then thirty measurements, and
records every sample, a fresh-page cold sample, artifact hashes, OS/CPU/browser and
viewport. It measures synchronous readable content, completed initial streaming DOM
and two animation frames as a paint opportunity. Diagrams are deferred in this
comparison; it is not full engine readiness or input-to-paint latency. Other browser tests cover actual engine completion and streams.
Both distributions use the current Host stylesheet and installed dependencies to
isolate SDK rendering changes. The prior distribution must be restored from a
recorded SDK commit before running.

For DOM completion and two-frame paint opportunity, a median or p95 increase fails the regression gate when it exceeds both 15% and 5 ms.
The 200 KiB/300 ms and input p95/16 ms values remain internal targets, not a public SLA.
Read the exact current measurements and missing categories in [validation](validation.md).

Subsequent streaming snapshots coalesce at animation frames; the first snapshot is
immediate and settled flushes the final state. Cross-block references are always
reparsed. Independent default blocks and unchanged custom renderer instances can be
retained. Blocks with cross-block IDs, resources or transformed math use safe rebuilds;
this is not an arbitrary DOM identity guarantee.

Reader renders at most 128 math elements automatically per update; additional formulas
keep TeX with explicit preview actions. TeX over 16 KiB stays source. At 1 MiB UTF-8,
Reader shows complete source instead of unbounded rich parsing. Geometry source is
limited to 512 KiB/20,000 coordinates/32 levels; ASCII STL has 4,096 triangles.
Graphviz has 24 jobs, 3 seconds per job, and 10-second idle worker reclamation.
Source snapshots and saves are never truncated by presentation budgets.

The continuous browser fixture runs 20 and 50 snapshots/second for thirty seconds
and checks final content plus a retained reading anchor within 2 CSS px. Long tasks
are recorded when supported; zero detected tasks is not a universal latency claim.

## Historical layered measurements

The following recorded results belong to the earlier published preview and are
retained as historical evidence; they are not the reliable-editing candidate gate.

`node scripts/performance-layers.mjs` records parser-only and settled Reader timing
(including explicit budget fallbacks). `--input-only` separately measures Source-mode
input in fresh contexts and retains the earlier rendering samples with their own
artifact identity. Both use five warmups and thirty samples per fixed fixture.
The input Host has no toolbar/outline subscription; subscribed Hosts must budget
state calculation separately. The SDK now avoids unsolicited state calculation.

All fifteen isolated input groups pass the relative regression gate. The internal
16 ms input p95 target is not met uniformly: final values are around one display
frame and reach 17.9 ms. This measures insertion to the next animation callback,
not physical display latency, real IME or a universal Live Edit/Host result.

| 200 KiB fixture | Parse p95 ms | Settled completion p95 ms | Input p95 before / after ms |
|---|---:|---:|---:|
| text | 5.8 | 29.8 | 16.5 / 16.1 |
| mixed | 26.6 | 383.8 | 37.2 / 17.5 |
| heavy | 3.5 | 2759.0 | 63.0 / 17.6 |
| table | 19.6 | 201.8 | 40.5 / 17.5 |
| adversarial | 20.4 | 100.7 | 136.5 / 17.4 |

Settled completion includes the bounded result, not a guarantee that every heavy
object rendered: inspect `finalStates` and `sourceFallback` in the
[layered samples](performance-layers.json). The earlier
[diagnostic combined run](performance-layers-diagnostic.json) is retained, including
its input regression, rather than silently replacing unsuccessful evidence.
The primary initial-render comparison remains separately identified above.

For applications subscribing to toolbar state, avoid polling the synchronous
`state` getter on every animation frame. Further latency work should measure that
Host and Live Edit separately, preserving formatting and composition correctness.

## Reliable editing candidate gates

`npm run test:performance:editing` measures settled Live Edit production bundles
with toolbar/outline subscribers enabled and disabled. It retains five warmups
and thirty samples for each 20/200 KiB/1 MiB fixture, including dispatch, callback
completion and the next animation frame. The absolute gate uses the next frame,
not callback completion. The candidate shows source preview at 512 Ki UTF-16 units;
this rendering fallback never truncates the document or the save snapshot.

On the fixed local runner, 20/200 KiB text/mixed inputs target p95 at most 50 ms;
heavy objects and the explicit 1 MiB source fallback allow 100 ms. The same
15-percent plus 5-ms regression rule remains active. These engineering budgets
are not device-independent promises. Diagnostic failed runs are retained separately.

`node scripts/interaction-performance.mjs` covers actual table and local object
UI handlers, complex-preview cancellation, eight concurrent Editor/UI instances
and one hundred complete session teardown cycles. It records real optional engine
use, runtime hashes and Chromium resource evidence separately from native testing.
Run it sequentially with the Live Edit and Reader comparisons on a quiet machine.
