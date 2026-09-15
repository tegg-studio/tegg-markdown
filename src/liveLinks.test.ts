/** @vitest-environment jsdom */
import {afterEach, describe, expect, it, vi} from "vitest";
import {EditorState} from "@codemirror/state";
import {EditorView} from "@codemirror/view";
import {history, undo} from "@codemirror/commands";
import {readLinkDraft} from "./objectDraft";
import {markdown} from "@codemirror/lang-markdown";
import {resourceContext} from "./editorHost";
import {GFM} from "@lezer/markdown";
import {editCurrentLink, liveLinks, linkAt, linkReplacement, linkPopoverPlacement, linkActionLabel} from "./liveLinks";
import {resolveHeadingLink} from "./linkNavigation";
function link(source: string, position: number, profile: "tegg" | "github" | "gfm" = "tegg") {
  return linkAt({state: EditorState.create({doc: source, extensions: [markdown({extensions: GFM}),resourceContext.of({documentPath:"",profile})]})} as EditorView, position);
}
describe("Live Edit link targets", () => {
  it.each(["github","gfm"] as const)("does not turn literal wiki syntax into navigation in %s", profile => {
    expect(link("[[Note]]",3,profile)).toBeNull();
    expect(link("[Text](target.md)",3,profile)?.target).toBe("target.md");
  });
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
    expect(linkReplacement(original, "[New]", "other note.md#heading")).toBe("[\\[New\\]](<other%20note.md#heading>)");
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


describe("legacy link editing preserves source properties", () => {
  const views: EditorView[] = [];
  afterEach(() => {for (const view of views.splice(0)) view.destroy();vi.restoreAllMocks();document.body.replaceChildren();});
  const open = (source: string, position = 4) => {
    const view = new EditorView({parent: document.body, state: EditorState.create({doc: source, selection: {anchor: position},
      extensions: [markdown({extensions: GFM}), resourceContext.of({documentPath: "", profile: "tegg"}), history(), liveLinks]})});
    views.push(view);vi.spyOn(view, "coordsAtPos").mockReturnValue({left: 20, right: 30, top: 20, bottom: 40});
    expect(editCurrentLink(view)).toBe(true);return view;
  };
  const edit = (name: string, value: string) => {const input = document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;input.value = value;input.dispatchEvent(new Event("input"));};
  const save = () => document.querySelector(".md-link-editor form")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
  const remove = () => document.querySelector<HTMLButtonElement>(".md-link-remove")!.click();
  const original = '[**first**\nsecond](old "line&#10;next&#9;tab &amp;copy;")';

  it("changes only the target and retains formatted multiline label and title semantics", () => {
    const view = open(original);edit("Link destination", "folder/new note.md");expect(view.state.doc.toString()).toBe(original);save();
    const source = view.state.doc.toString();expect(source).toContain("[**first**\nsecond]");
    expect(readLinkDraft(source)).toEqual({label: "first\nsecond", url: "folder/new%20note.md", title: "line\nnext\ttab &copy;"});
    expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(original);
  });
  it("edits the label without flattening title entities or decoding the untouched destination", () => {
    const raw = '[first](<folder/a%20b.md?literal=%2520> "line&#10;next&#9;tab &amp;copy;")';const view = open(raw);
    edit("Display text", "[replacement] &copy;");save();
    expect(readLinkDraft(view.state.doc.toString())).toEqual({label: "[replacement] &copy;", url: "folder/a%20b.md?literal=%2520", title: "line\nnext\ttab &copy;"});
    expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(raw);
  });
  it("submits untouched multiline content without creating a transaction", () => {
    const view = open(original);save();expect(view.state.doc.toString()).toBe(original);expect(undo(view)).toBe(false);
  });
  it("unwraps only an untouched link while preserving label Markdown", () => {
    const view = open(original);remove();expect(view.state.doc.toString()).toBe("**first**\nsecond");expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(original);
  });
  it("removes the wrapper around an edited plain label with Markdown escaping", () => {
    const view = open(original);edit("Display text", "**literal** &copy;");remove();
    expect(view.state.doc.toString()).toBe("\\*\\*literal\\*\\* &amp;copy;");expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(original);
  });
  it("keeps reference-link conversion local and preserves the resolved title", () => {
    const raw = '[**first**\nsecond][id]\n\n[id]: old "line&#10;next&#9;tab &amp;copy;"';const view = open(raw);
    edit("Link destination", "new.md");save();const source = view.state.doc.toString(), occurrence = source.slice(0, source.indexOf("\n\n"));
    expect(readLinkDraft(occurrence)).toEqual({label: "first\nsecond", url: "new.md", title: "line\nnext\ttab &copy;"});
    expect(source.slice(source.indexOf("\n\n"))).toBe(raw.slice(raw.indexOf("\n\n")));expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(raw);
  });
  it("unwraps a reference occurrence without editing its shared definition", () => {
    const raw = '[**first**][id]\n\n[id]: old "title"';const view = open(raw);remove();expect(view.state.doc.toString()).toBe('**first**\n\n[id]: old "title"');expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(raw);
  });
  it("retains target validation and leaves source unchanged after a rejected edit", () => {
    const view = open(original);edit("Link destination", "javascript:alert(1)");save();expect(view.state.doc.toString()).toBe(original);expect(document.querySelector('[role="alert"]')?.textContent).toContain("supported link");expect(undo(view)).toBe(false);
  });
});
