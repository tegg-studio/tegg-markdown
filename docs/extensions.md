# Optional engines and read-only renderers

The lightweight entries do not register engines globally. Pass an instance registry:

```ts
import {katexEngine} from "@tegg/markdown/engines/katex";
import {highlightEngine} from "@tegg/markdown/engines/highlight";
import {mermaidEngine} from "@tegg/markdown/engines/mermaid";
import {graphvizEngine} from "@tegg/markdown/engines/graphviz";
import "katex/dist/katex.min.css";
const engines = {math: katexEngine, highlight: highlightEngine,
  mermaid: mermaidEngine, graphviz: graphvizEngine};
```

Install only the peers you enable: `katex`, `highlight.js`, `mermaid`, `@viz-js/viz`.
The compatibility root/core entry registers all four and requires those peers.
Mermaid loads on first use. Graphviz uses a bounded worker with a 3-second job
budget, 24 admitted jobs and 10-second idle reclamation. Its worker/WASM requires
additional CSP permissions; see [security and CSP](security-and-csp.md).

`renderers` supports `table`, `code`, `link`, `image`, and `fence:<language>` keys.
Each callback gets `(container, node, context)` and may return `{destroy, update?}`
or a promise. The node is a frozen DTO; table rows/headers are frozen arrays.
`context` carries documentId, revision, AbortSignal and `renderDefault()`.
Image DTOs include alt/title and the authorized URL. Asynchronous image hooks mount
after resource resolution; unrelated slots do not wait for those URLs. Images may
remount when their resource resolution state changes. Only mutate the supplied container. Errors restore the safe default. Every acquired
instance is destroyed at most once; a late acquired instance is immediately released.
Unchanged semantic content with the same renderer function retains its instance.
Changed content mounts a new instance; `update` refreshes an unchanged node when its
revision changes. It does not grant arbitrary editable-widget ownership.

```ts
const renderers = {table(container, node, context) {
  container.append(context.renderDefault());
  return {destroy() {container.replaceChildren();}};
}};
```

For optional GitHub geometry fences:

```ts
import {githubGeometryRenderers} from "@tegg/markdown/engines/geometry";
const host = {engines: {}, renderers: githubGeometryRenderers};
```

GeoJSON uses a bounded offline coordinate projection with pan/zoom and polygon
holes. The combined geometry entry requires `topojson-client` at build time for its
TopoJSON adapter; expanded arcs are bounded
before conversion. ASCII STL has pan/zoom/rotation and a 4,096-triangle limit.
These are offline SVG previews, not GitHub's map tiles or a photorealistic 3D engine.
No basemap requests are made. Geometry source is limited to 512 KiB, 20,000
coordinates and 32 nesting levels; invalid or unsupported input keeps default code.
Binary STL is not a Markdown text fence input.

Custom renderers are trusted Host code. They own their output sanitization,
accessibility and resource authorization. Markdown never chooses executable modules.
No inaccurate source ranges are synthesized for transformed display nodes.

Reader automatically renders at most 128 formulas per update. Additional formulas
retain TeX and expose an explicit preview action; individual TeX over 16 KiB remains
source. At 1 MiB UTF-8 and above, Reader shows the complete source without rich
parsing. Editor source and save snapshots are not truncated. These bounded fallbacks
are visible behavior, not a claim of unlimited rendering.

## Business identifiers and inline text

Bare issue/order/document identifiers are Host business semantics, not built-in
Markdown syntax. For portable content, generate standard Markdown links in the
Host. This version does not expose arbitrary markdown-it plugin registration or
an inline text matcher. A future Reader-only matcher must preserve source, skip
existing links/code/math, validate destination URLs and bound matching work before
it becomes a supported API. Live Edit requires separate selection/composition
validation; do not patch its DOM to add business links.
