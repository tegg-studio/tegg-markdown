# Preview capabilities

| Capability | Available behavior | Boundary |
|---|---|---|
| Reader / Live Edit / Source | All included | Browser-only preview API |
| Basic Markdown / GFM | Headings, formatting, lists, tasks, tables, links, code | Unknown syntax remains editable source |
| Table editing | Cells, row/column operations, alignment, rectangular clipboard and narrow-screen controls | No spreadsheet formulas, arbitrary merged cells or Office parity |
| Code blocks | Top-level code content/language editing | Nested blocks may require Source |
| Metadata and callouts | Rendering, local object drafts and validated source patches | Native application menus are not part of this SDK |
| Math / Mermaid / Graphviz | Local source drafts with bounded preview and one-step apply/undo | No arbitrary visual object editor |
| HTML | Sanitized preview and source editing | No trusted script execution |
| Undo and redo | Shared across modes | Resets on document replacement |
| Saving / reopening | Host snapshot and acknowledgement APIs | Host provides storage and atomic revision comparison |
| Multiple instances | Scoped state and resource context | Shared renderer runtime may serialize some work |
| Attribution | Default visible footer | Host placement requires equivalent visible credit or written waiver |
| Chinese text | Unicode source and composition transition guards | Real OS IME matrix still requires verification |
| Toolbar / outline | Selection state, optional `/ui` toolbar and object/search controls, versioned headings and fragment navigation | Host may supply native toolbar/menu presentation |
| Appearance | Per-instance font scale, content width, colors and toolbar inset | Native layout and scroll indicators remain Host-owned |
| Accessibility | Semantic Reader and source-visible editing toggle | Complete assistive-technology audit pending |
| Mobile / native WebView | Source is portable | No new iOS/Android/native-device certification in this release |

No realtime collaboration, proprietary block database, account system, official
sync service, application shell or paid feature unlocks are included.

## Content profiles and GitHub extensions

| Profile/capability | Contract | Boundary |
|---|---|---|
| `gfm` | CommonMark base + GFM tables, strike, autolinks, task lists and tagfilter | Raw HTML is additionally sanitized for Host safety |
| `github` | GFM plus footnotes, emoji shortcodes, five standard alerts, math and Mermaid fences | No GitHub account/repository issue/mention resolution |
| `tegg` (default) | Existing metadata, wiki links, custom callouts, Graphviz and formatting extensions | Choose explicitly when consuming Tegg-specific documents |
| GitHub math forms | Inline dollars, paired dollar/backtick inline, block math and `math` fences | KaTeX engine; unsupported macros show safe source/error, not promised MathJax parity |
| `geojson` / `topojson` / `stl` | Optional offline read-only fence renderer | Bounded geometry projection/ASCII STL; no remote basemap or binary file viewer |
| Heading anchors | Outline/navigation uses the selected profile | Host handles cross-document permissions and paths |
| Raw HTML / media | Sanitized content; resource URLs opt-in | No executable script, iframe or arbitrary CSS |

Normative fixtures pin CommonMark 0.31.2 and GFM 0.29. Their semantic tests do not
claim pixel parity with github.com or exhaustive support for every GitHub service.
See [performance budgets](performance.md) for source fallbacks and optional rendering
limits. Source remains authoritative in every profile.

## Reliable editing candidate

The `0.3.0-preview.1` development candidate adds shared local editing sessions,
offline HTML/text/Markdown/TSV/CSV review, durable attachment tasks, optional UI,
checksummed recovery and three-version conflict review. It is not a registry release.

| Capability | Available behavior | Boundary |
|---|---|---|
| Object sessions | Mapped local ranges, review, cancel, stale rejection and isolated undo | Edits overlapping an active target invalidate it |
| Attachments | Host storage, progress, cancel/retry, reviewed replacement and durable references | Host owns file permissions/storage; no embedded temporary blob URL is saved |
| Recovery | Bounded checkpoints, integrity checks and corrupt-record quarantine | Only persisted checkpoints survive process loss; Host owns native persistence |
| Conflict review | Base/local/incoming hunks and explicit finite application | Re-read storage before adoption; unresolved conflicts reject old save acknowledgements |
| Controlled extensions | Namespaced/versioned local draft preparers with cancellation and review | Trusted Host callbacks; no arbitrary parser injection or JavaScript sandbox claim |

See [reliable editing](reliable-editing.md), [recovery](recovery.md),
[controlled extensions](controlled-extensions.md) and [validation](validation.md)
for contracts, exact commands and platform evidence limits.
