import type {MarkdownProfile} from "./syntaxProfiles";
import type {Text} from "@codemirror/state";
import {findFrontmatter, findHighlights, findTechnicalBlocks, findWikiLinks} from "./profile";

function scan(source: string) {
  let frontmatter: ReturnType<typeof findFrontmatter> | undefined;
  let highlights: ReturnType<typeof findHighlights> | undefined;
  let technicalBlocks: ReturnType<typeof findTechnicalBlocks> | undefined;
  let wikiLinks: ReturnType<typeof findWikiLinks> | undefined;
  // Toolbar queries must not parse every diagram/math block as a side effect
  // of reading plain source. Each semantic analysis is computed once on demand.
  return {source,
    get frontmatter() { return frontmatter ??= findFrontmatter(source); },
    get highlights() { return highlights ??= findHighlights(source); },
    get technicalBlocks() { return technicalBlocks ??= findTechnicalBlocks(source); },
    get wikiLinks() { return wikiLinks ??= findWikiLinks(source); },
  };
}

// Immutable CodeMirror documents are the cache key. Selection/scroll changes do
// not rescan the source, and history eviction releases entries automatically.
const analyses = new WeakMap<Text, ReturnType<typeof scan>>();
export function analyzeSource(doc: Text, profile: MarkdownProfile = "tegg") {
  let result = analyses.get(doc);
  if (!result) { result = scan(doc.toString()); analyses.set(doc, result); }
  if (profile === "tegg") return result;
  const base = result;
  let technicalBlocks: ReturnType<typeof findTechnicalBlocks> | undefined;
  // Do not spread the base object: spreading eagerly invokes every getter.
  return {source: base.source, frontmatter: {metadata: null, body: base.source, from: 0, to: 0}, highlights: [], wikiLinks: [],
    get technicalBlocks() { return technicalBlocks ??= profile === "gfm" ? [] : base.technicalBlocks.filter(block => block.kind === "math" || block.kind === "mermaid"); },
  };
}
