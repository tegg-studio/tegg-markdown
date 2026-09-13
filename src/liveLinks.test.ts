/** @vitest-environment jsdom */
import {describe, expect, it} from "vitest";
import {EditorState} from "@codemirror/state";
import type {EditorView} from "@codemirror/view";
import {markdown} from "@codemirror/lang-markdown";
import {GFM} from "@lezer/markdown";
import {linkAt, linkReplacement, linkPopoverPlacement, linkActionLabel} from "./liveLinks";
import {resolveHeadingLink} from "./linkNavigation";
function link(source: string, position: number) {
  return linkAt({state: EditorState.create({doc: source, extensions: [markdown({extensions: GFM})]})} as EditorView, position);
}
describe("Live Edit link targets", () => {
  it.each([
    ["[Text](https://example.com)", 3, "https://example.com"],
    ["[Note](folder/note.md#title)", 3, "folder/note.md#title"],
    ["[[笔记#标题|文字]]", 4, "笔记#标题"],
    ["[Ref][id]\n\n[id]: target.md", 3, "target.md"],
    ["<https://example.com>", 4, "https://example.com"],
  ])("resolves %s", (source, position, target) => {
    expect(link(String(source), Number(position))?.target).toBe(target);
  });
  it("never edits apparent links in code or images", () => {
    expect(link("`[[Note]]`", 4)).toBeNull();
    expect(link("```md\n[[Note]]\n```", 10)).toBeNull();
    expect(link("![alt](image.png)", 9)).toBeNull();
  });
  it("escapes edited labels and preserves Wiki syntax", () => {
    const original = link("[Text](target.md)", 3)!;
    expect(linkReplacement(original, "[New]", "other note.md#heading")).toBe("[\\[New\\]](<other note.md#heading>)");
    expect(linkReplacement(link("[[Note]]", 3)!, "Label", "Other#Section")).toBe("[[Other#Section|Label]]");
    expect(() => linkReplacement(original, "Text", "javascript:alert(1)")).toThrow();
  });
  it("preserves label formatting and the optional title when only the destination changes", () => {
    const original = link('[**Bold**](old.md "description")', 5)!;
    expect(linkReplacement(original, original.label, "new.md")).toBe('[**Bold**](<new.md> "description")');
  });
  it("resolves explicit IDs, generated slugs and duplicate headings after Metadata", () => {
    const source = "---\ntitle: sample\n---\n# Start {#start}\n\n## 中文 标题\n\n## Repeat\n\n## Repeat";
    expect(resolveHeadingLink(source, "start")?.from).toBe(source.indexOf("# Start"));
    expect(resolveHeadingLink(source, "中文-标题")?.from).toBe(source.indexOf("## 中文"));
    expect(resolveHeadingLink(source, "repeat-1")?.from).toBe(source.lastIndexOf("## Repeat"));
    expect(resolveHeadingLink(source, "missing")).toBeNull();
  });
});


describe("Link popup placement", () => {
  it("flips above a bottom link without covering it", () => {
    const result = linkPopoverPlacement({left: 700, top: 720, bottom: 744}, 280, 150, {width: 800, height: 768});
    expect(result.top + 150).toBeLessThanOrEqual(712);
    expect(result.left + 280).toBeLessThanOrEqual(792);
  });
  it("uses available space and limits tall panels instead of overlapping the anchor", () => {
    const below = linkPopoverPlacement({left: 20, top: 20, bottom: 44}, 280, 150, {width: 800, height: 768});
    expect(below.top).toBe(52);
    const tall = linkPopoverPlacement({left: 20, top: 200, bottom: 224}, 280, 600, {width: 800, height: 400});
    expect(tall.top).toBe(8);
    expect(tall.maxHeight).toBe(184);
  });
});


describe("Link action copy", () => {
  it.each([
    ["https://example.com/file.pdf", "Open in browser"],
    ["mailto:hello@example.com", "Open in mail app"],
    ["#heading", "Jump to heading"],
    ["note%20name.md#heading", "Open note"],
    ["manual.PDF#page=2", "Open file"],
    ["./folder/", "Show in Finder"],
    ["archive.zip", "Show in Finder"],
    ["custom:action", "Unsupported link"],
  ])("describes %s", (target, label) => expect(linkActionLabel(target)).toBe(label));
  it("describes Wiki notes without a file extension", () => expect(linkActionLabel("Note#Heading", true)).toBe("Open note"));
});
