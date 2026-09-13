/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { createMetadataPanel, disposeMetadataPanel } from "./metadata";
import { renderMarkdown } from "./markdown";

describe("YAML Metadata projection", () => {
  it.each(["tags: [markdown, syntax-review]", "tags:\n  - markdown\n  - syntax-review"])("renders equivalent list syntax: %s", source => {
    const panel = createMetadataPanel(source);
    expect(panel.querySelector("summary")).toBeNull();
    expect(Array.from(panel.querySelectorAll(".md-metadata-chip"), el => el.textContent)).toEqual(["markdown", "syntax-review"]);
  });
  it("preserves nested values, multiline text, large numbers and empty values", () => {
    const panel = createMetadataPanel('author: {name: Leon, active: true}\ncount: 9007199254740993\nempty: ""\nmissing: null\ntags: []\nsettings: {}\ndescription: |\n  First\n  Second\npeople:\n  - name: Ada\n  - name: Lin');
    expect(panel.querySelector(".md-metadata-source")).toBeNull();
    for (const value of ["Leon", "true", "9007199254740993", '""', "null", "[]", "{}", "First\nSecond\n", "Ada", "Lin"]) expect(panel.textContent).toContain(value);
  });
  it.each(["title: [broken", "title: one\ntitle: two", "? [a, b]\n: complex key", "value: " + "[".repeat(20) + "0" + "]".repeat(20), "x".repeat(32769)])("retains unsupported, invalid or over-budget YAML as source", source => {
    expect(createMetadataPanel(source).querySelector("pre")?.textContent).toBe(source);
  });
  it("distinguishes numeric and boolean strings without quoting ordinary text", () => {
    const panel = createMetadataPanel('flag: false\ntext: "false"\ncount: 12\ncode: "001234"\nversion: "1.0"\nname: Leon');
    const values = Array.from(panel.querySelectorAll(".md-metadata-row > dd"), node => node.textContent);
    expect(values).toEqual(["false", '\"false\"', "12", '\"001234\"', '\"1.0\"', "Leon"]);
  });
  it("limits source fallback to tagged or anchored fields and never expands aliases", () => {
    const source = 'title: Test\nversion: !!str 1.0\ncustom: !my-type something\nbase: &base [*base]\ncopy: *base\nstatus: draft';
    const panel = createMetadataPanel(source);
    expect(panel.querySelectorAll(".md-metadata-grid > .md-metadata-row")).toHaveLength(6);
    expect(Array.from(panel.querySelectorAll("pre"), node => node.textContent)).toEqual(['!!str 1.0', '!my-type something', '&base [*base]', '*base']);
    expect(panel.textContent).toContain("draft");
  });
  it("creates only supported links and sends Reader links through the host", async () => {
    const opened: string[] = [];
    const root = document.createElement("div");
    await renderMarkdown('---\nwebsite: https://example.com\nrelated: "[[Target|Label]]"\nbad: javascript:alert(1)\ncover: assets/cover.png\n---\nBody', root, { onOpenLink: href => opened.push(href) });
    const links = root.querySelectorAll<HTMLAnchorElement>(".frontmatter a");
    expect(links).toHaveLength(2);
    links[0].querySelector("svg")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    links[1].click();
    expect(opened).toEqual(["https://example.com", "wikilink:Target"]);
  });
  it("starts without Tags as Show Metadata and keeps Edit YAML on the action row", () => {
    const edit = vi.fn();
    const panel = createMetadataPanel("title: Test", edit);
    const toggle = panel.querySelector<HTMLButtonElement>(".md-metadata-toggle")!;
    const viewport = panel.querySelector<HTMLElement>(".md-metadata-viewport")!;
    expect(toggle.textContent).toBe("Show Metadata");
    expect(viewport.hidden).toBe(true);
    toggle.click();
    expect(toggle.textContent).toBe("Show Less");
    expect(viewport.hidden).toBe(false);
    toggle.click();
    expect(viewport.hidden).toBe(true);
    panel.querySelector<HTMLButtonElement>(".md-metadata-actions .md-metadata-edit")!.click();
    expect(edit).toHaveBeenCalledOnce();
  });
  it.each(["tags: [one, two]", "Tags: []"])("previews only Tags and puts it first when expanded: %s", tags => {
    const panel = createMetadataPanel(`title: Test\n${tags}\nstatus: draft`);
    const rows = Array.from(panel.querySelectorAll<HTMLElement>(".md-metadata-content > .md-metadata-grid > .md-metadata-row"));
    const toggle = panel.querySelector<HTMLButtonElement>(".md-metadata-toggle")!;
    expect(rows[0].querySelector("dt")!.textContent?.toLowerCase()).toBe("tags");
    expect(rows.map(row => row.hidden)).toEqual([false, true, true]);
    expect(toggle.textContent).toBe("Show More");
    toggle.click();
    expect(rows.every(row => !row.hidden && !row.inert)).toBe(true);
    expect(toggle.textContent).toBe("Show Less");
    toggle.click();
    expect(rows.map(row => row.hidden)).toEqual([false, true, true]);
  });
  it("allows opening invalid YAML and respects retained expansion", () => {
    const panel = createMetadataPanel("title: [broken", undefined, {expanded: true});
    expect(panel.querySelector<HTMLElement>(".md-metadata-viewport")!.hidden).toBe(false);
    expect(panel.querySelector("pre")!.textContent).toBe("title: [broken");
  });
  it("keeps link and string projections identical in Reader and Live Edit lists", () => {
    const source = 'links: [https://example.com, "[[Target|Label]]", "false", "001234", ""]';
    const reader = createMetadataPanel(source);
    const live = createMetadataPanel(source, undefined, {onChange: () => true});
    const values = (panel: HTMLElement) => Array.from(panel.querySelectorAll(".md-metadata-chip"), chip => chip.textContent);
    expect(values(live)).toEqual(values(reader));
    expect(Array.from(live.querySelectorAll("a"), a => [a.getAttribute("href"), a.dataset.wikiTarget])).toEqual(
      Array.from(reader.querySelectorAll("a"), a => [a.getAttribute("href"), a.dataset.wikiTarget]));
    expect(live.querySelectorAll("a svg")).toHaveLength(2);
  });
  it.each([998, 999, 1500])("shares the node budget between Reader and Live Edit for %i tags", count => {
    const source = 'tags: [' + Array(count).fill('a').join(',') + ']';
    for (const options of [{}, {onChange: () => true}]) {
      const panel = createMetadataPanel(source, undefined, options);
      expect(!!panel.querySelector("pre")).toBe(count > 998);
      expect(panel.querySelectorAll(".md-metadata-chip")).toHaveLength(count > 998 ? 0 : count);
    }
  });
  it("counts tags across sibling fields and enforces the list-item depth limit", () => {
    const sources = [
      'first: [' + Array(600).fill('a').join(',') + ']\nsecond: [' + Array(600).fill('b').join(',') + ']',
      'nested: {'.repeat(11) + 'nested: [leaf]' + '}'.repeat(11),
    ];
    for (const source of sources) {
      for (const options of [{}, {onChange: () => true}]) {
        expect(createMetadataPanel(source, undefined, options).querySelector("pre")?.textContent).toBe(source);
      }
    }
  });
  it("does not interpret metadata as HTML or Markdown, including math", async () => {
    const root = document.createElement("div");
    await renderMarkdown('---\ntitle: "<img src=x onerror=alert(1)>"\nprice: "$5 and $10"\n---\nBody', root);
    expect(root.querySelector(".frontmatter img")).toBeNull();
    expect(root.querySelector(".frontmatter .math-inline")).toBeNull();
    expect(root.querySelector(".frontmatter")?.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(root.querySelector(".md-metadata-header")).toBeNull();
    expect(root.querySelector(".frontmatter")?.getAttribute("aria-label")).toBe("Metadata");
    expect(root.textContent).toContain("Body");
  });
});
