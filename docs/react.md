# React integration

React 18 and 19 are optional peers. Install React and ReactDOM in your application.
The adapter uses the Host's React tree and portals, so a custom renderer retains
Context. It does not create a second independent React root.

```tsx
import {MarkdownReader, type RendererProps} from "@tegg/markdown/react";
import "@tegg/markdown/reader.css";
function Code({node}: RendererProps) { return <pre>{node.text}</pre>; }
const components = {code: Code};
function Document({source, revision}: {source: string; revision: string}) {
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

## Layout contract

For internal scrolling, give the React component a definite height (for example
`height: 100%` under a sized parent, or a constrained flex/grid item with
`min-height: 0`). The adapter carries that height through its dedicated mount;
no selectors targeting its private child div are needed. The Host still owns the
outer layout. For naturally sized content and page/Host scrolling use
`host={{layout: "host"}}`; the adapter mount then uses automatic height. Layout is
construction-time configuration: remount if it changes.

## Reference toolbar and command discovery

Copy [MarkdownToolbar](../examples/react-toolbar/Toolbar.ts), pass the instance from
`onReady` and the latest state from `host.onStateChange`. The sample is compiled and
exercised in independent React 18/19 consumers. Supply your product styles and labels.
It uses native buttons/selects, exposes pressed/mixed/disabled state and preserves
selection on mouse activation; native controls retain keyboard operation.

`state.profile` and immutable `state.commands` expose profile support. Use
`editor.commandStatus(name)` for transient availability and a reason when disabled.
When rendering a whole toolbar, use `getCommandStatus(name, state)` on its existing
snapshot to avoid rescanning the selection per button; execution always checks fresh
state through `command()`.
`getSupportedCommands(profile)` from `@tegg/markdown/editor` works before mounting.
Support is not a promise that an optional preview engine is installed: inserting
valid Markdown can still be supported with source fallback. `command()` keeps its
boolean result and shares the same capability rules. Unknown commands remain rejected.

For TypeScript bundler projects prefer `moduleResolution: "bundler"`. Legacy
`moduleResolution: "node"` consumers receive explicit `typesVersions` mappings for
public typed subpaths without Host `paths` aliases. This does not add CommonJS
runtime exports or support every historical compiler/bundler. Both strategies are
checked against the supported TypeScript version in independent consumers.

## Explaining Live Edit

Reader presents a document for reading. Live Edit combines source editing with
previews for supported structures; syntax visibility depends on the structure,
selection and accessibility configuration. Source mode exposes the underlying
Markdown. Preserved syntax is intentional, but missing supported previews should
still be reported as bugs. A Host may show a short mode description when switching;
the SDK does not impose first-use dialogs or store onboarding preferences.
