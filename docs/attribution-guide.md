# Interface attribution guide

Give users a clear, quiet indication of where Markdown reading and editing come
from: **Powered by Tegg Markdown**. Choose one placement that fits your interface;
you do not need to display all five. **We recommend the small corner watermark
as the default visual style.** Use another placement when it better fits your Host.

The [Attribution License](../LICENSE), especially sections 3–5, defines the
requirements. This guide suggests presentation and interaction patterns; its
pixel values are design starting points, not additional license conditions.
A [separate written commercial agreement](../COMMERCIAL-LICENSE.md) is required
for a white-label exemption. Selecting a layout or setting `attribution: "host"`
does not grant one.

## Choose a placement

| Your interface | Suggested placement | Keep in mind |
| --- | --- | --- |
| Most interfaces; especially minimal readers with a paper-like finish | **[Small corner watermark](#small-corner-watermark) — default recommendation** | Use small, readable text in reserved space without a background; never overlay document content. |
| Desktop workspace with word count or save status | [Status bar](#status-bar) | A natural alternative when your interface already has a bottom bar; keep it outside document scrolling. |
| Form field, comment box or embedded editor | [Component footer](#component-footer) | Place it immediately below the component and separate from submission actions. |
| Workspace with a persistent document sidebar | [Sidebar](#sidebar) | Switch to a visible footer when the sidebar closes. |
| Minimal reader that benefits from a subtle background label | [Corner signature](#corner-signature) | Reserve real layout space for the label. |

These are illustrative Host designs, not five built-in SDK presets. The English
mockups use a fictional, generic **Workspace** and sample documents. They were
created with AI image editing and are not screenshots of a shipped integration.
Use the specifications below rather than measuring pixels or colors from the images.

## Small corner watermark

![English minimal reader with a small, two-line gray Powered by Tegg Markdown signature at the bottom right, with no background](https://raw.githubusercontent.com/tegg-studio/tegg-markdown/main/docs/images/attribution/watermark-corner-small.png)

**Our default visual recommendation.** Here, “watermark” means a quiet **interface signature**, not a mark embedded in a
user's document. Keep it readable; do not make it transparent or repeat it across
the page.

| Property | Desktop starting point |
| --- | --- |
| First line | `Powered by`, 12px font, 16px line height, weight 400 |
| Second line | `Tegg Markdown`, 16px font, 20px line height, weight 500 |
| Arrangement | Right aligned, 2px between lines; natural width with no clipping |
| Edge spacing | 20px from the component's right edge and 16px from its bottom edge |
| Reserved space | At least 62px at the bottom by default; grow with text and wrapping |
| Light theme | Opaque `#6B7280` on `#FFFFFF` or `#F7F8FA` |
| Dark theme | Opaque `#A1A1AA` on `#18181B` |
| Decoration | No background, border, shadow, glow or animation |

The nominal two-line text height is 38px; 62px allows 16px below and 8px between
text and content. Prefer a naturally sized footer row to a fixed-height overlay.
Do not hard-code a width based on the illustrated font.

The specified opaque color pairs have calculated contrast ratios of approximately
4.83:1, 4.55:1 and 6.91:1 respectively. We recommend a 4.5:1 ordinary-text readability
target for the full phrase. These calculations do not validate the mockups or your
product: check the actual foreground/background combination and text size in your
Host. See [W3C's contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

## Status bar

![English workspace with attribution at the right of a persistent bottom status bar](https://raw.githubusercontent.com/tegg-studio/tegg-markdown/main/docs/images/attribution/status-bar.png)

An alternative for desktop workspaces that already have a bottom status bar. Put document status on the left and the
full attribution on the right. Keep both in a layout row adjacent to the document's
scrolling area, so long documents do not move the attribution out of view.

Start with 14px text, 20px line height, a minimum 36px bar height and 16px horizontal
padding. Match your own status bar background and allow the row to grow or wrap.

## Component footer

![English document form with attribution immediately below the editor, separate from create and cancel buttons](https://raw.githubusercontent.com/tegg-studio/tegg-markdown/main/docs/images/attribution/component-footer.png)

Use for an editor embedded in a larger form. Place the attribution 8–12px below
the editor, aligned to its edge. Use 14px text with 20px line height and leave at
least 24px between it and form submission controls as a starting point. Internal
editor scrolling must not move the footer. If the containing page can scroll the
footer away while the editor remains in use, adapt the layout to retain visible
attribution.

## Sidebar

![English workspace with two-line attribution at the bottom of the document sidebar](https://raw.githubusercontent.com/tegg-studio/tegg-markdown/main/docs/images/attribution/sidebar.png)

Use a sidebar only while it is visible alongside the relevant reader or editor.
Start with `Powered by` at 12px/16px and `Tegg Markdown` at 14px/20px, separated by
2px; allow at least 16px of side and bottom padding. Follow the sidebar's background
without adding an advertising card.

When the sidebar collapses or a document enters fullscreen, provide a status bar
or component footer before the sidebar attribution disappears.

## Corner signature

![English minimal reader with a subtle rounded attribution label in reserved bottom-right space](https://raw.githubusercontent.com/tegg-studio/tegg-markdown/main/docs/images/attribution/corner-signature.png)

Use a light background label in reserved space at the visible corner of the reader.
Start with 14px/20px text, a minimum 32px label height, 10–12px horizontal padding,
a 6px corner radius and 16px distance from the surrounding edges. Avoid strong shadows.

The label must occupy layout space. Absolute positioning over editable text,
selection, scrollbars or action buttons is not a substitute for that space.

## Connect a Host-owned placement

The SDK's built-in default remains a footer outside document scrolling. The
watermark is this guide's recommended Host presentation; it does not change the
SDK default. Keep the supplied footer unless your Host provides its own visible
placement.

For a custom editor layout, `attribution` belongs in the **third constructor
argument**, the Host object:

```ts
import { TeggMarkdownEditor } from "@tegg/markdown/editor";
import "@tegg/markdown/editor.css";

// editorElement is the document area inside your Host's layout.
// Render a visible adjacent attribution row before creating this editor.
const editor = new TeggMarkdownEditor(
  editorElement,
  { documentId: "example.md", revision: "1", source: "# Hello" },
  { attribution: "host" },
  "live"
);

// On unmount:
editor.destroy();
```

This is only the placement-specific portion of an integration. Add your normal
Host callbacks, persistence and lifecycle handling from the
[getting started guide](getting-started.md) and [Host contract](host-contract.md).
The Host must keep its attribution visible across Read, Live Edit and Source
modes. The option suppresses the supplied footer; it does not render one of the
five layouts for you. For other entry points or wrappers, follow that entry
point's API and keep the same visible attribution responsibility.

Use real text such as:

```html
<div class="workspace-attribution">Powered by Tegg Markdown</div>
```

A link is optional. If you choose one, the
[Tegg Markdown repository](https://github.com/tegg-studio/tegg-markdown) is a valid
destination. Preserve the current editing session when opening it, provide a
visible keyboard focus indicator, and retain normal link semantics. Attribution
needs no automatic network request, tracking, account or activation.

## Responsive behavior and accessibility

- Keep attribution in a visible layout area adjacent to the document scroller.
  Do not require scrolling through the document to discover it.
- At narrow component widths, use a horizontal footer with 14px/20px text and
  12px side padding. A width below 480px is a useful starting trigger, not a
  universal breakpoint. Wrap after `by` when needed and let the container grow;
  apply the same fallback when text enlargement no longer fits.
- Account for mobile keyboards and safe areas. Resize the content area or move
  the footer into a visible part of the component without covering the caret.
- Keep the complete phrase visible without ellipses, menu access or hover.
  A logo alone is not a replacement. Maintain your product's own brand hierarchy.
- Use the actual theme colors. In forced-color or high-contrast modes, prefer
  system text colors and remove decorative backgrounds.
- Keep the single semantic attribution accessible as real text. Do not mark it
  `aria-hidden`. Only redundant decoration may be hidden from assistive technology.
- For optional links, provide an adequately spaced hit area. Suggested targets
  are at least 24×24 CSS px on desktop and about 44×44 CSS px on touch, without
  overlapping document controls. See [W3C's target size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
  for its conditions and exceptions.
- Multiple simultaneously visible instances may share one attribution when its
  scope is clear. Check standalone dialogs, fullscreen views and independently
  visible regions separately. Avoid implying that unrelated product features
  are provided by Tegg Markdown.

## Keep user content separate

Attribution belongs to your interface. Generate copy, save, print and export
content from the document model, not from an enclosing UI DOM that includes the
attribution. Exclude interface decoration from print layouts. Do not add the
phrase to Markdown source, saved files, images, code blocks or exported documents.

For non-graphical use, follow the license's accompanying documentation or notices
requirement; a watermark on each API response is not required.

## Verify in your product

| Check | Expected result |
| --- | --- |
| Text and hierarchy | The full phrase is readable and subordinate to your own product branding. |
| Visibility | Long scrolling, mode changes, fullscreen and sidebar collapse retain visible attribution. |
| Input | Text selection, caret, buttons and scrollbars remain unobstructed; touch scrolling works. |
| Adaptation | Test 320px and 390px widths, desktop layouts and 200% zoom; no clipping or overflow. |
| Theme and access | Check real light/dark/custom colors, forced colors, keyboard focus and screen-reader output. |
| Content isolation | Copy, save, reopen, print and HTML/PDF/image export add no attribution to user content. |
| Scope | A shared label clearly covers its instances without implying unrelated product endorsement. |

The illustrations do not establish runtime, accessibility or export acceptance.
Run these checks against your actual Host and the SDK version you ship.
