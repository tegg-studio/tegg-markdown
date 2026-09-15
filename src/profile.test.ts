import { describe, expect, it } from "vitest";
import {
  extractFrontmatter,
  findFrontmatter,
  findHighlights,
  findTechnicalBlocks,
  findWikiLinks,
  parseInlineImage,
  resolveLocalImageSource,
  technicalMarkdownProfile,
} from "./profile";
import { supportedSyntaxMarkers, syntaxCapabilities } from "./syntaxContract";

describe("Technical Markdown Profile", () => {
  it("publishes the versioned offline profile", () => {
    expect(technicalMarkdownProfile.version).toBe("1.1");
    expect(technicalMarkdownProfile.gfm).toContain("table");
    expect(technicalMarkdownProfile.technical).toEqual(expect.arrayContaining(["katex", "mermaid", "graphviz"]));
    expect(technicalMarkdownProfile.capabilities).toHaveLength(43);
    expect(technicalMarkdownProfile.remoteResources).toBe("blocked");
  });

  it("declares projection behavior once for every published capability", () => {
    expect(syntaxCapabilities.map(({ id }) => id)).toEqual(supportedSyntaxMarkers);
    expect(new Set(supportedSyntaxMarkers).size).toBe(43);
    for (const capability of syntaxCapabilities) {
      expect(["render", "decorate", "source", "fallback"]).toContain(capability.reader);
      expect(["render", "decorate", "source", "fallback"]).toContain(capability.liveEdit);
      expect(["render", "decorate", "source", "fallback"]).toContain(capability.quickLook);
    }
  });

  it("keeps the public frontmatter result stable and exposes its source range", () => {
    const source = "---\ntitle: Test\ntags: [one]\n---\n# Hello";
    expect(extractFrontmatter(source)).toEqual({ metadata: "title: Test\ntags: [one]", body: "# Hello" });
    expect(findFrontmatter(source)).toMatchObject({ from: 0, to: source.indexOf("# Hello") });
  });

  it("finds wiki links and uses aliases as visible labels", () => {
    expect(findWikiLinks("See [[Docs/Plan|Migration plan]] and [[Readme]].")).toEqual([
      expect.objectContaining({ target: "Docs/Plan", label: "Migration plan" }),
      expect.objectContaining({ target: "Readme", label: "Readme" }),
    ]);
  });

  it("finds highlight ranges without spanning lines", () => {
    expect(findHighlights("A ==bright idea== here")).toEqual([
      { from: 2, to: 17, contentFrom: 4, contentTo: 15 },
    ]);
    expect(findHighlights("==first\nsecond==")).toEqual([]);
  });

  it("parses local images with accessible text and titles", () => {
    expect(parseInlineImage('![Reader](docs/reader.png "Preview")')).toEqual({
      alt: "Reader",
      src: "docs/reader.png",
      title: "Preview",
    });
    expect(parseInlineImage("![Space](<docs/My Image.png>)")).toEqual({ alt: "Space", src: "docs/My Image.png" });
  });

  it("resolves relative images against the Markdown file instead of the embedded web surface", () => {
    expect(resolveLocalImageSource("docs/My%20Image.png", "/tmp/#?%20/中文.md"))
      .toBe("app-file:///tmp/%23%3F%2520/docs/My%20Image.png");
    expect(resolveLocalImageSource("file:///tmp/image.png", "/tmp/note.md")).toBe("app-file:///tmp/image.png");
    expect(resolveLocalImageSource("docs/My Image.png", "/Users/test/My Notes/Gallery.md"))
      .toBe("app-file:///Users/test/My%20Notes/docs/My%20Image.png");
    expect(resolveLocalImageSource("data:image/png;base64,abc", "/Users/test/Gallery.md"))
      .toBe("data:image/png;base64,abc");
  });

  it("finds diagram and math blocks while preserving their source ranges", () => {
    const source = "```mermaid\nflowchart LR\nA-->B\n```\n\n$$\nx^2\n$$";
    expect(findTechnicalBlocks(source).map(({ kind, source: body }) => [kind, body])).toEqual([
      ["mermaid", "flowchart LR\nA-->B"],
      ["math", "x^2"],
    ]);
  });

  it("finds all diagram blocks beside complex brackets without block-math delimiters", () => {
    const complex = "[".repeat(256) + "]".repeat(256) + " inline $x$\n\n";
    const mermaid = "```mermaid\nflowchart LR\nA-->B\n```";
    const graphviz = "```graphviz\ndigraph { a -> b }\n```";
    const dot = "~~~dot\ndigraph { c -> d }\n~~~";
    const nested = "````markdown\n```mermaid\nnot a diagram\n```\n````";
    const source = complex + [mermaid, graphviz, dot, nested].join("\n\n");
    expect(source).not.toContain("$$");
    expect(findTechnicalBlocks(source)).toEqual([
      {kind: "mermaid", source: "flowchart LR\nA-->B", from: source.indexOf(mermaid), to: source.indexOf(mermaid) + mermaid.length},
      {kind: "graphviz", source: "digraph { a -> b }", from: source.indexOf(graphviz), to: source.indexOf(graphviz) + graphviz.length},
      {kind: "dot", source: "digraph { c -> d }", from: source.indexOf(dot), to: source.indexOf(dot) + dot.length},
    ]);
    expect(findTechnicalBlocks(complex)).toEqual([]);
  });

  it("does not interpret technical examples nested inside a longer code fence", () => {
    const source = "````markdown\n```mermaid\nflowchart LR\nA-->B\n```\n\n$$\nx^2\n$$\n````";
    expect(findTechnicalBlocks(source)).toEqual([]);
  });
});

// The enabled rich preview shares Reader semantics; native fallback remains explicit.
it("describes rich Quick Look separately from native fallback", () => {
  for (const capability of syntaxCapabilities) {
    expect(capability.quickLook).toBe(capability.reader);
    expect(["render", "source", "fallback"]).toContain(capability.quickLookFallback);
  }
});
