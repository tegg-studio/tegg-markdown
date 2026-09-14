# Appearance, layout and language

The default accent remains Tegg/Mac blue (`#007aff`). Small control text derives a
higher-contrast color without changing the brand token. Override CSS variables on
one instance's `.tegg-surface`: `--background`, `--text`, `--muted`, `--border`,
`--accent`, `--accent-soft`. Do not apply unscoped global button/table rules.
The Editor also exposes `setAppearance` for existing Host appearance integration.

Use `locale: "en-US" | "zh-CN"` and `messages` to override SDK-owned labels.
Keys are English source messages; missing translations fall back to English.
Parameterized labels use `{value}`. `setUI({locale, messages})` updates labels without
changing source, dirty state, undo or save identity. Source text and the attribution
trademark are never translated. Third-party engine diagnostics retain their details.

`layout: "host"` removes the SDK's internal fixed-height layout; pass
`scrollContainer` for position preservation. `scrollBehavior` is `preserve` (default),
`follow` (follow only while already at the bottom), or `host` (Host owns position).
`chrome: "headless"` hides optional default object toolbars, not source semantics or
required attribution. Host controls must preserve access to needed actions.

`overlayContainer` places viewers in a dedicated per-instance surface inside the
Host's container. Theme variables and language remain scoped. Destroy releases the
surface and its listeners. Keep the owner surface's theme variables authoritative.
Custom renderer UI is the Host's responsibility.

Table quantity labels use the message variants `{rows} row × {columns} column`,
`{rows} row × {columns} columns`, `{rows} rows × {columns} column` and
`{rows} rows × {columns} columns`. Rows count data rows (excluding the header).
English selects singular/plural from each count; Chinese displays `{rows} 行 ×
{columns} 列`. Custom messages and live locale switching use the same instance UI
context. This is not a claim of general plural-rule support for other languages.
