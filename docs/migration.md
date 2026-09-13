# Migrating from 0.1 preview to 0.2 preview

This is a new minor line because resource defaults and dependency requirements change.

1. Keep `profile: "tegg"` (the default) for existing Tegg documents. Choose `github`
   or `gfm` explicitly for their syntax boundaries. `profileVersion: "1.1"` remains
   the existing technical schema version; it is not the content dialect.
2. Resource URLs are blocked by default. Explicitly allow owned blob URLs, exact
   origins, or a native protocol. A resolver cannot bypass the policy. Never enable
   arbitrary protocols based on Markdown content.
3. Root/core compatibility consumers must install the optional engine peers they
   previously received transitively. For minimal Reader integrations switch to
   `/reader` plus `/reader.css`; editing uses `/editor` plus `/editor.css`.
4. Import KaTeX's CSS only when enabling its engine. Keep assets local and adjust CSP
   narrowly. Do not add blanket `unsafe-eval` or CDN permissions.
5. Keep snapshot/acknowledgement ordering unchanged. Locale, theme and renderer state
   do not create a new save generation. Dirty conflicts still need explicit resolution.
6. Destroy instances on unmount. Keep renderer functions stable to retain their state.

The license and mandatory visible attribution remain unchanged. No watermark is
inserted into documents. Existing historical validation is not proof of this version.
