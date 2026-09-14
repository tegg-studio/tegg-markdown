# Security and CSP

Markdown is untrusted data. Raw HTML passes DOMPurify and cannot execute scripts,
embed arbitrary frames or supply SDK UI markers. Resource attributes and resolved
URLs are checked separately. SVG diagrams retain local fragment references but
remove remote links/resources and unsafe CSS resource directives. KaTeX disables
trusted HTML commands and bounds macro expansion. Optional geometry has explicit
input/expansion limits. Host renderer code remains trusted application code.

Default resource policy is offline: no image, media or poster URL is loaded without
Host opt-in. `allowedOrigins` compares exact origins; credentials, dangerous schemes,
control characters and backslash network aliases are rejected. `allowRelative`,
`allowBlob`, `allowDataImages` and native `allowedProtocols` are separate decisions.
Data images are restricted to base64 raster formats. Link activation is a Host event,
not an automatic navigation or link-preview fetch.

## Tested local configurations

The production-consumer harness uses real HTTP headers, not HTML meta tags.
For basic Reader, the policy is:

```text
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self';
font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'
```

For the optional-engine fixture, the differences are:

```text
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
worker-src 'self' blob:;
```

The fixture keeps every font local with Vite `build.assetsInlineLimit: 0`, so
`font-src` remains `'self'`. Graphviz uses a local bundled blob worker and WASM;
KaTeX/Mermaid need generated inline styles. These permissions are only for enabled
engines. Basic Reader does not need them. The compatibility `style.css` embeds font
data; use separate Reader/Editor CSS and the peer's KaTeX CSS for this narrower
configuration. Other bundlers must preserve equivalent local asset behavior.

Never copy a broad policy allowing arbitrary CDN origins, `unsafe-eval`, data scripts,
or unrestricted `connect-src`. An unavailable engine keeps source/fallback content.
Disabling an engine is supported when the Host cannot grant its required permissions.

The SDK does not implement authentication, document authorization, database CAS,
filesystem sandboxing, uploads, malware scanning or network proxies. Those remain
Host responsibilities. Report security issues through [SECURITY.md](../SECURITY.md),
not public issue bodies containing sensitive material or exploit details.

SVG styles permit `@keyframes` and `@-webkit-keyframes` for local diagram animation.
Other at-rules remain rejected, along with escaped CSS and external URL/image/src
functions. Classification removes CSS comments before checking. Local fragment
paint references remain allowed. Unsafe blocks are dropped; this deliberately
supports a conservative generated-style subset, not arbitrary user CSS.
