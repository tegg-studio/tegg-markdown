# Controlled draft extensions

`ControlledExtensionRegistry` and the optional `EditingUIHost.extensions` support trusted Host commands that prepare a **single local Markdown draft**. A command has a stable namespaced ID (`acme.shorten-label`), a semantic version, a label and optional profile/object-kind filters. Registration rejects duplicate IDs and unsupported capabilities. Extensions do not register parsers, mutate an AST, receive an EditorView, or supply document transactions.

```ts
const ui = attachEditingUI(editor.editing, toolbarRoot, {
  extensions: [{
    id: "acme.uppercase", version: "1.0.0", label: "Uppercase selection",
    profiles: ["tegg", "gfm", "github"], kinds: ["selection"],
    async prepare({session, signal}) {
      signal.throwIfAborted();
      return {draft: session.draft.toUpperCase()};
    },
  }],
});
```

The toolbar captures the current object or selection using the same public editing controller as built-in tools. Prepare receives an immutable identity and local session snapshot plus an AbortSignal. It returns exactly `{draft: string}`. Preparation never changes the document; the UI keeps Cancel and Copy draft available, displays the result in a source field, and requires Apply. The reviewed text commits through the existing source patch and undo contract. A lower-level Host can call `registry.prepare(id, session.token)`, review the returned preparation, then `registry.commit(prepared, reviewedText)`.

The registry rejects a nonempty whole-document `selection`, local inputs or results above 65,536 UTF-16 units, and output containing extra transaction/parser fields. Editing an identified object that occupies a small complete document remains supported. Read-only/Reader and IME gates are checked before work and again after asynchronous preparation. Changes to document identity, mode or the target invalidate the result; disjoint source changes can map the existing local session safely. A draft modified while work is pending is retained and the late result is rejected.

Cancel, target invalidation and disposal abort preparation and settle the public promise even if a Host ignores AbortSignal. The default waiting limit is 30 seconds (configurable up to 60 seconds). Late completions cannot reopen the panel or commit. The identity of the registry-issued preparation is checked on commit, so an arbitrary object with a copied token is rejected. This is a workflow boundary for trusted Host callbacks, not a JavaScript security sandbox: a callback that captures other application APIs can access them. CPU-heavy callbacks must yield or run in a Host worker; AbortSignal cannot interrupt arbitrary synchronous JavaScript. Network access or data disclosure is a Host decision, and no network integration is supplied by this API.

Call `ui.setUI({locale, messages})` when the Host language changes, and `ui.destroy()` at teardown. The editing UI inherits its editor's UI context even when mounted in a separate toolbar root. With a custom UI, call `registry.dispose()` on teardown and cancel the associated controller session when the user closes its draft.
