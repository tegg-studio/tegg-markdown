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
