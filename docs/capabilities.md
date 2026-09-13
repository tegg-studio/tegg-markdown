# Preview capabilities

| Capability | Available behavior | Boundary |
|---|---|---|
| Reader / Live Edit / Source | All included | Browser-only preview API |
| Basic Markdown / GFM | Headings, formatting, lists, tasks, tables, links, code | Unknown syntax remains editable source |
| Table editing | Basic cells and structural operations | No spreadsheet formulas, arbitrary merged cells or Office parity |
| Code blocks | Top-level code content/language editing | Nested blocks may require Source |
| Metadata and callouts | Rendering and supported source patches | Native application menus are not part of this SDK |
| Math / Mermaid / Graphviz | Render plus source editing | No arbitrary visual object editor |
| HTML | Sanitized preview and source editing | No trusted script execution |
| Undo and redo | Shared across modes | Resets on document replacement |
| Saving / reopening | Host snapshot and acknowledgement APIs | Host provides storage and atomic revision comparison |
| Multiple instances | Scoped state and resource context | Shared renderer runtime may serialize some work |
| Attribution | Default visible footer | Host placement requires equivalent visible credit or written waiver |
| Chinese text | Unicode source and composition transition guards | Real OS IME matrix still requires verification |
| Accessibility | Semantic Reader and Source editor | Complete assistive-technology audit pending |
| Mobile / native WebView | Source is portable | No new iOS/Android/native-device certification in this release |

No realtime collaboration, proprietary block database, account system, official
sync service, application shell or paid feature unlocks are included.
