import {afterEach, describe, expect, it, vi} from "vitest";
import {EditorState, Text} from "@codemirror/state";
import {analyzeSource} from "./sourceAnalysis";
import * as profileHelpers from "./profile";

afterEach(()=>vi.restoreAllMocks());

describe("source-version analysis cache", () => {
  it("reuses analysis across selection changes and invalidates on edits", () => {
    const state = EditorState.create({doc: "[[Note]] ==highlight=="});
    const first = analyzeSource(state.doc);
    expect(analyzeSource(state.update({selection: {anchor: 4}}).state.doc)).toBe(first);
    const changed = state.update({changes: {from: 0, to: 8, insert: "plain"}}).state;
    expect(analyzeSource(changed.doc)).not.toBe(first);
    expect(analyzeSource(changed.doc).wikiLinks).toEqual([]);
  });
});


describe("lazy source analysis", () => {
  const mixed = [
    "---", "title: Example", "---", "",
    "==visible== \\==escaped== `==code==` [[Note|Alias]]", "",
    "```md", "$$ literal $$ and [[code]]", "```", "",
    "$$", "x + y", "$$", "",
    "```mermaid", "flowchart TD", "A --> B", "```", "",
    "~~~dot", "digraph { A -> B }", "~~~", "",
    "```graphviz", "digraph { C -> D }", "```", "",
  ].join("\n");

  it.each(["LF", "CRLF", "BOM"] as const)("matches existing helpers for every profile on %s mixed syntax", encoding => {
    const source = encoding === "CRLF" ? mixed.replaceAll("\n", "\r\n") : encoding === "BOM" ? "\ufeff" + mixed : mixed;
    const doc = Text.of(source.split("\n"));
    const full = {source, frontmatter: profileHelpers.findFrontmatter(source), highlights: profileHelpers.findHighlights(source),
      technicalBlocks: profileHelpers.findTechnicalBlocks(source), wikiLinks: profileHelpers.findWikiLinks(source)};
    // Interleave disabled and enabled projections to detect profile cache pollution.
    for (const profile of ["gfm", "tegg", "github", "tegg", "gfm"] as const) {
      const expected = profile === "tegg" ? full : {...full,
        frontmatter: {metadata: null, body: source, from: 0, to: 0}, highlights: [], wikiLinks: [],
        technicalBlocks: profile === "gfm" ? [] : full.technicalBlocks.filter(block => block.kind === "math" || block.kind === "mermaid")};
      expect({...analyzeSource(doc, profile)}).toEqual(expected);
    }
  });

  it("reads source and formatting without parsing technical blocks or wiki links", () => {
    const frontmatter = vi.spyOn(profileHelpers, "findFrontmatter"), highlights = vi.spyOn(profileHelpers, "findHighlights");
    const technical = vi.spyOn(profileHelpers, "findTechnicalBlocks"), wiki = vi.spyOn(profileHelpers, "findWikiLinks");
    const analysis = analyzeSource(Text.of(mixed.split("\n")));
    expect(analysis.source).toBe(mixed);
    expect(Object.keys(analysis)).toEqual(["source", "frontmatter", "highlights", "technicalBlocks", "wikiLinks"]);
    expect(frontmatter).not.toHaveBeenCalled();expect(highlights).not.toHaveBeenCalled();
    const firstFrontmatter = analysis.frontmatter, firstHighlights = analysis.highlights;
    expect(firstFrontmatter.metadata).toBe("title: Example");expect(firstHighlights.length).toBeGreaterThan(0);
    expect(analysis.frontmatter).toBe(firstFrontmatter);expect(analysis.highlights).toBe(firstHighlights);
    expect(frontmatter).toHaveBeenCalledExactlyOnceWith(mixed);expect(highlights).toHaveBeenCalledExactlyOnceWith(mixed);
    expect(technical).not.toHaveBeenCalled();expect(wiki).not.toHaveBeenCalled();
  });

  it("keeps every GFM field independent of disabled parsers, including math", () => {
    const scans = (["findFrontmatter", "findHighlights", "findTechnicalBlocks", "findWikiLinks"] as const).map(name => vi.spyOn(profileHelpers, name));
    const doc = Text.of(mixed.split("\n"));
    for (let i = 0; i < 2; i++) {
      const analysis = analyzeSource(doc, "gfm");
      expect({...analysis}).toEqual({source: mixed, frontmatter: {metadata: null, body: mixed, from: 0, to: 0}, highlights: [], wikiLinks: [], technicalBlocks: []});
      expect(analysis.technicalBlocks).toBe(analysis.technicalBlocks);
    }
    for (const scan of scans) expect(scan).not.toHaveBeenCalled();
  });

  it("parses GitHub technical blocks only on demand and shares the unfiltered scan", () => {
    const technical = vi.spyOn(profileHelpers, "findTechnicalBlocks"), wiki = vi.spyOn(profileHelpers, "findWikiLinks");
    const doc = Text.of(mixed.split("\n")), github = analyzeSource(doc, "github");
    expect(github.source).toBe(mixed);expect(github.frontmatter.to).toBe(0);expect(github.highlights).toEqual([]);expect(github.wikiLinks).toEqual([]);
    expect(technical).not.toHaveBeenCalled();
    const first = github.technicalBlocks;expect(first.map(block => block.kind)).toEqual(["math", "mermaid"]);
    expect(github.technicalBlocks).toBe(first);expect(analyzeSource(doc, "github").technicalBlocks).toEqual(first);
    expect(analyzeSource(doc).technicalBlocks.map(block => block.kind)).toEqual(["math", "mermaid", "dot", "graphviz"]);
    expect(technical).toHaveBeenCalledExactlyOnceWith(mixed);expect(wiki).not.toHaveBeenCalled();
  });

  it("binds unread fields to their own immutable document revision", () => {
    const wiki = vi.spyOn(profileHelpers, "findWikiLinks");
    const before = EditorState.create({doc: "[[Old]] ==before=="}), old = analyzeSource(before.doc);
    const after = before.update({changes: {from: 0, to: before.doc.length, insert: "[[New]] ==after=="}}).state;
    const next = analyzeSource(after.doc);expect(next === old).toBe(false);expect(wiki).not.toHaveBeenCalled();
    expect(next.wikiLinks.map(item => item.target)).toEqual(["New"]);
    expect(old.wikiLinks.map(item => item.target)).toEqual(["Old"]);
    expect(analyzeSource(before.update({selection: {anchor: 2}}).state.doc)).toBe(old);
    expect(old.source).toBe("[[Old]] ==before==");expect(next.source).toBe("[[New]] ==after==");
    expect(wiki).toHaveBeenCalledTimes(2);
  });

  it("retries a failed lazy scan without caching partial data", () => {
    const technical = vi.spyOn(profileHelpers, "findTechnicalBlocks").mockImplementationOnce(() => {throw new Error("scan failed");});
    const analysis = analyzeSource(Text.of(mixed.split("\n")));
    expect(() => analysis.technicalBlocks).toThrow("scan failed");
    const blocks = analysis.technicalBlocks;expect(blocks.map(block => block.kind)).toEqual(["math", "mermaid", "dot", "graphviz"]);
    expect(analysis.technicalBlocks).toBe(blocks);expect(technical).toHaveBeenCalledTimes(2);
  });
});
