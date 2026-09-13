import { describe, expect, it } from "vitest";
import { extractFrontmatter, parseWikiLink } from "./markdown";

describe("extractFrontmatter", () => {
  it("extracts YAML only at the start", () => {
    expect(extractFrontmatter("---\ntitle: Test\n---\n# Hello")).toEqual({
      metadata: "title: Test",
      body: "# Hello",
    });
  });

  it("preserves ordinary thematic breaks", () => {
    expect(extractFrontmatter("Hello\n---\nWorld")).toEqual({ metadata: null, body: "Hello\n---\nWorld" });
  });
});

describe("parseWikiLink", () => {
  it("uses the target as the default label", () => {
    expect(parseWikiLink("Notes/Alpha")).toEqual({ target: "Notes/Alpha", label: "Notes/Alpha" });
  });

  it("supports an explicit label", () => {
    expect(parseWikiLink("Notes/Alpha | Read this")).toEqual({ target: "Notes/Alpha", label: "Read this" });
  });
});
