# Custom editor locale

Import `bindUI` from `@tegg/markdown/core` for custom CodeMirror Host roots. Bind
the container before mounting the editor; retain and destroy the binding when
unmounting. `update()` changes UI copy without replacing source or history.
Pass the same locale to `TechnicalMarkdownReader` and `attachEditingUI` when
their containers are separate.
