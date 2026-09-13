# React integration

React 18 and 19 are optional peers. Install React and ReactDOM in your application.
The adapter uses the Host's React tree and portals, so a custom renderer retains
Context. It does not create a second independent React root.

```tsx
import {MarkdownReader} from "@tegg/markdown/react";
import "@tegg/markdown/reader.css";
function Code({node}) { return <pre>{node.text}</pre>; }
const components = {code: Code};
function Document({source, revision}) {
  return <MarkdownReader document={{documentId: "doc", revision, source, profile: "github"}}
    host={{engines: {}, locale: "en-US"}} components={components} />;
}
```

Use the exported `RendererProps` type for TypeScript components. Use
`MarkdownEditor` and `editor.css` for editing. `mode` can be controlled;
`onReady(instance)` or a ref's `getInstance()` exposes imperative saving and mode APIs.
Keep document objects stable when their values have not changed. Controlled source
echoes must keep the existing base revision until the Host acknowledges a save.

The instance is created in an effect, destroyed on cleanup, and checked in React
StrictMode. Reader updates are asynchronous and newer snapshots supersede older
presentation work. Locale/messages updates do not replace the Editor's draft.
Callbacks read current Host props. Construction options such as engine registry,
layout and resource policy should remain stable; remount explicitly to replace
those policies. Changing renderer keys updates the Reader mapping on its next render.

Custom components are read-only presentation. They must not manipulate SDK-owned
siblings, perform source writes through DOM mutation, or treat displayed text as an
exact source range. Use the Editor/Host source contract for changes.
