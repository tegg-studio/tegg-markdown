# Mac editor alignment — preview.2

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
every document, including path changes. Supply the native image resolver. The core
entry does not inject CSS, a frame, storage or attribution: the Host must provide
styles and comply with the attribution license (or hold separate permission).

The Mac integration uses the packaged engine for its document surface and Quick
Look reader. Its legacy core source files remain temporarily for comparison/tests;
they must not be used as the application runtime implementation. Native CSS is
retained during this first integration. Shared stylesheet migration requires a
separate measured comparison of width, insets, typography and appearance.

## Reproducible next gate

1. Pin a tested package version/commit and retain the pre-integration Mac baseline.
2. Run both Hosts with the same Markdown corpus: formatting selection, tables,
   callouts, code, metadata, images, links, formulas/diagrams and unknown syntax.
3. Compare source before/after each edit, undo, mode switch and save/reopen; take
   paired screenshots at equal content width and font scale.
4. Exercise native IME, VoiceOver, file/path changes and Quick Look; only mark each
   case complete with actual native evidence. Build success alone is insufficient.

The preview.2 validation record separates tests, browser interactions and native
smoke checks. It is not a blanket parity certificate.
