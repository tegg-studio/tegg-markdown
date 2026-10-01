# Block Hover controls

The Live Edit block control follows the pointer independently of the editing selection. A menu captures its semantic target and original selection; hovering another block cannot retarget an open menu. Escape and dismissal do not change source or selection. Only an explicit command transfers the editing target. Document, source and selection changes invalidate stale menus.

## Layout and input

The control uses a stable external gutter: 28 px target, 16 px vector glyph, 10 px content gap, neutral hover fill, keyboard-only focus ring. Reserve symmetric content padding of at least 40 px before first interaction. Coarse pointers use 44 px targets and 56 px padding. Use the CodeMirror editorAttributes facet to keep the gutter class stable across state updates. Hosts with higher-specificity content padding must preserve this minimum.

Wrapped and multiline paragraphs anchor to their first visual line; nested list items resolve independently. Tall rendered objects anchor near their visible top edge. Hovering the gap between content and control keeps the target reachable. Alt+Shift+B exposes and focuses the current block control for keyboard users. Enter opens; Escape dismisses. Composition and active text selection suppress accidental block operations.

## Semantic scope

- Paragraph style conversion operates on the whole parsed paragraph. Inline marks and list/quote/task containers remain intact. Soft source wraps join with spaces; explicit hard breaks become `<br>` within a heading. Undo restores the exact original source, including Setext underlines.
- The icon presents the primary type; its accessible label includes heading, list and quote context. Existing menu checks show the independent paragraph and list styles.
- Tables, fenced code, Mermaid, Graphviz, display math, standalone images, callouts and footnotes use object menus. Code opens its existing embedded editor; other objects reuse the existing draft editor. Cancel never writes source.
- Inline formulas, links and inline images do not replace their paragraph target. Definitions, reference definitions, HTML blocks and dividers expose source editing without unsafe paragraph conversion. Metadata retains its separate panel.
- Movement uses the same parsed scope for its label and mutation: quoted text explicitly says Move entire quote; list text says Move list item and includes nested children. Source patches carry complete lines, including enclosing quote prefixes; undo restores the exact original bytes. Paragraph conversion still affects only the current paragraph.
- Reader, Source and streaming/read-only surfaces retain their existing controls and mutation boundaries.

Regression coverage lives in `src/commandBlockTarget.test.ts`, `src/commandSurface.test.ts` and `tests/browser/block-hover.spec.ts`, alongside existing command/object/table layout suites. This is desktop/browser evidence, not iOS device or release certification.


## Visual refinement

Block and menu glyphs use original Lucide 1.17.0 vectors, with 24-unit geometry and a 2-unit round stroke. Type and heading glyphs are vectors, not font text. The pinned archive integrity, original SVG hashes and selected nodes are recorded in `docs/block-icons.json`; full notices are in `licenses/lucide-block-icons.txt`. No runtime icon library or network loading is required. Block controls use a 16 px canvas, menu icons 18 px, and checkmarks 16 px.

Pointer-over-content reveals only the neutral glyph. Pointer-over-button adds the host secondary surface; expanded buttons use selection; current menu formats use quiet selection plus a vector check. Keyboard navigation has its own focus indicator and never changes the current-format check. Hover has no border or shadow; only keyboard focus draws a ring. All colors use semantic host tokens with SDK fallbacks.

Menus follow a 242 px preferred width, 34 px minimum row height, 20 px icon column, 10 px icon/label gap, 6 px inset and 10 px corners. Width and height remain constrained by the viewport; increased prose size does not increase control or menu size. Hosts may supply `--command-menu-surface` for a distinct menu surface.


## Scope boundaries and integration review

The distinct quote-line hover target, container submenu, moving a heading among
siblings inside a quote, and per-cell block menus are not implemented here.
Markdown table cells retain inline editing and the table-level object entry.
These future interaction choices must not be inferred from the current primary
icon. Existing container movement is explicitly named before execution.

Integration regression adds quoted heading/container movement, quoted nested
list items, localized scope labels and source-safe undo/redo. The shared movement
planner includes whole source-line prefixes to avoid damaging enclosing quotes.
