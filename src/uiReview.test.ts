/** @vitest-environment jsdom */
import {describe, expect, it} from "vitest";
import {EditorState} from "@codemirror/state";
import {keymap} from "@codemirror/view";
import {editorSetup} from "./editorSetup";
import {HeadingIndex} from "./headingIndex";
import {markdownParser} from "./markdownParser";

describe("UI review contracts", () => {
  it("keeps undo, redo and editing without search keybindings", () => {
    const keys = EditorState.create({extensions: editorSetup}).facet(keymap).flat().map(item => item.key);
    expect(keys).toContain("Mod-z");
    for (const key of ["Mod-f", "Mod-g", "F3", "Mod-Alt-g"]) expect(keys).not.toContain(key);
  });
  it("shares ATX, Setext, inline formatting, frontmatter and fence semantics with Reader", () => {
    const source = '---\ntitle: hidden\n---\n# **One**\n\nSecond `code`\n---\n\n````md\n# hidden\n```\n````\n\n## Link [name](https://example.com) {#custom}\n';
    const result = new HeadingIndex().update(source);
    expect(result.map(h => [h.level, h.title])).toEqual([[1,"One"],[2,"Second code"],[2,"Link name"]]);
    expect(source.slice(result[1].from)).toMatch(/^Second/);
    const rendered = document.createElement("div");
    rendered.innerHTML = markdownParser.render(source.split('---\n').slice(2).join('---\n'), {outline:true});
    expect(markdownParser.render("## Safe {#custom}", {outline:true})).toContain('id="custom"');
    expect(result.every(h => /^outline-line-\d+$/.test(h.anchor))).toBe(true);
  });
  it("caches identical source and gives duplicate titles distinct stable identities", () => {
    const index = new HeadingIndex();
    const first = index.update("# Same\n\n## Same");
    expect(index.update("# Same\n\n## Same")).toBe(first);
    expect(new Set(first.map(h => h.id)).size).toBe(2);
    expect(index.update("Intro\n\n# Same\n\n## Same").map(h=>h.id)).toEqual(first.map(h=>h.id));
    expect(index.update("Intro\n\n# Renamed\n\n## Same")[0].id).toBe(first[0].id);
  });
  it("normalizes CRLF offsets to CodeMirror positions", () => {
    const result = new HeadingIndex().update("text\r\n\r\n# 中文");
    expect(result[0].from).toBe(6);
  });
  it("does not give an inserted heading the identity of a surviving heading", () => {
    const index = new HeadingIndex();
    const old = index.update("# Original")[0];
    const next = index.update("# New\n\n# Original");
    expect(next[1].id).toBe(old.id);
    expect(next[0].id).not.toBe(old.id);
  });
});
