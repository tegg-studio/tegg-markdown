# Getting started

Tegg Markdown is a browser SDK. Importing the lightweight Reader and React modules
on a server is supported; creating an instance or rendering requires a browser DOM.
Pin a reviewed Git commit or install the tarball produced by `npm pack`. The package
remains private against accidental registry publication; these instructions do not
claim an npm registry release.

```ts
import {TeggMarkdownReader} from "@tegg/markdown/reader";
import "@tegg/markdown/reader.css";
const reader = new TeggMarkdownReader(container, {
  locale: "en-US", engines: {},
  openLink(href) { /* apply your application's navigation policy */ },
});
await reader.render({documentId: "readme", revision: "1", profile: "github", source: "# Hello"});
reader.destroy();
```

`container` is a dedicated HTMLElement. Give internal scrolling a meaningful height,
or select `layout: "host"` and a Host scroll container. Always destroy on unmount.
For editing import `TeggMarkdownEditor` from `@tegg/markdown/editor` and
`@tegg/markdown/editor.css`; initialize with `{documentId, revision, source}`.
Modes are `reader`, `live`, `source`. The default profile is `tegg`.

No resource URL is loaded by default. A Host that owns local object URLs can set
`resourcePolicy: {allowBlob: true}` and `resolveImage`. For network resources, set
exact `allowedOrigins` after applying document-specific authorization. The SDK's
allowlist is an additional check, not a replacement for Host permissions.

Math and diagrams are optional. See [engines and renderers](extensions.md),
[React](react.md), [saving](host-contract.md), and [migration](migration.md).
The visible attribution is outside the Markdown source; keep it visible under
[the attribution requirements](../ATTRIBUTION.md).
