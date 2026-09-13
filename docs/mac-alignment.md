# Mac editor alignment — 0.2 preview

The target is one Markdown engine with explicit Host adapters. This preview does
not claim complete visual or behavioral equivalence with the Mac application.

## Responsibility and acceptance

| Area | Shared implementation / API | Acceptance boundary |
| --- | --- | --- |
| Reader, Live Edit, source patches, formatting | Same package core | Core regression suite; full cross-platform fixture matrix still pending |
| Toolbar | `editor.state`, `onStateChange`, `command()` | Native and browser controls differ; independent widget input is protected |
| Outline and links | `outline()`, `onOutlineChange`, `navigateHeading()`, `navigateFragment()` | Heading identity is checked against document generation and edit sequence |
| Appearance | `setAppearance()` | Instance sizing/colors; native chrome and complete pixel parity are not certified |
| Assistive editing | `setAccessibility()` | Keeps source visible without changing source/undo; real VoiceOver and OS IME matrix remains open |
| Callout menu | `selectCalloutType()` or default browser list | Native menu selection must be discarded if the source or generation changed |
| Persistence | Snapshot and exact save acknowledgement | Host owns atomic writes, files, iCloud, permissions, conflicts and navigation history |
| Attribution | Default footer or compliant Host placement | Never inserted into Markdown or exported files |

## Existing native adapters

`@tegg/markdown/core` exports the same editor setup, Live Edit extensions, reader,
formatting commands, resource context and navigation parser used by the high-level
editor. An existing Mac Host can import these exports while retaining its current
CodeMirror lifecycle, native menu protocol, save acknowledgements, toolbar insets
and scroll indicators. This avoids rewriting those behaviors during extraction.

Use one resolved copy of CodeMirror in the Host. Configure `resourceContext` for
every document, including path changes. Supply the native image resolver and an explicit resource policy. For a sandboxed
`app-file:` adapter, allow only that protocol and validate document grants, resolved
file paths, file types and sizes in the native handler. Configure the same optional
engine adapters for Reader and Live Edit; neither surface should load network images
implicitly. The core
entry does not inject CSS, a frame, storage or attribution: the Host must provide
styles and comply with the attribution license (or hold separate permission).

The Mac integration uses the packaged engine for its document surface and Quick
Look reader. Its legacy core source files remain temporarily for comparison/tests;
they must not be used as the application runtime implementation. Native layout and typography CSS remain Host-owned. Import
`@tegg/markdown/interaction.css` after the native stylesheet for shared formula,
diagram and footnote controls. This independent export is built from the same
source included in the complete SDK stylesheet; do not copy its rules into the
Host. Supply the usual appearance tokens; body size falls back to the Host font
scale when `--md-body` is absent. Full layout migration still requires measured
comparison of width, insets and typography.

Quick Look must cancel its diagram queue and call `reader.destroy()` before
replacing a reader, including theme refreshes and cancellation. Guard asynchronous
completion with a generation token, since theme refreshes reuse request IDs.

## Reproducible next gate

1. Pin a tested package version/commit and retain the pre-integration Mac baseline.
2. Run both Hosts with the same Markdown corpus: formatting selection, tables,
   callouts, code, metadata, images, links, formulas/diagrams and unknown syntax.
3. Compare source before/after each edit, undo, mode switch and save/reopen; take
   paired screenshots at equal content width and font scale.
4. Exercise native IME, VoiceOver, file/path changes and Quick Look; only mark each
   case complete with actual native evidence. Build success alone is insufficient.

The current validation record separates tests, browser interactions and native
smoke checks. It is not a blanket parity certificate.

## Browser example file access and narrow windows

The example's **Open folder** action indexes only files explicitly selected by the
user. Relative image URLs and Markdown links resolve against the current document
path inside that selection; nested paths, URL-encoded names and target fragments
are supported. Object URLs are reused and released when the file set is replaced.
A missing local image never falls through to the development server. Single-file
import cannot grant access to sibling attachments; use folder selection for those.

The document selector also returns to earlier files. Navigation retains the existing
unsaved-change confirmation. Browser save stores one explicit snapshot in localStorage;
other saved documents remain in the current session cache until a different file set
is opened. It does not overwrite disk files or persist attachment access across a
reload. Export Markdown to retain changes on disk; reopen the folder for attachments.

At widths up to 760px, **Outline and settings** opens the same sidebar controls.
Escape closes it and returns focus to its button; document navigation closes it too.
Attribution remains visible outside document scrolling in both layouts.
