import type {Text} from "@codemirror/state";
import {findFrontmatter, findHighlights, findTechnicalBlocks, findWikiLinks} from "./profile";

function scan(source: string) {
  return {source, frontmatter: findFrontmatter(source), highlights: findHighlights(source),
    technicalBlocks: findTechnicalBlocks(source), wikiLinks: findWikiLinks(source)};
}

// Immutable CodeMirror documents are the cache key. Selection/scroll changes do
// not rescan the source, and history eviction releases entries automatically.
const analyses = new WeakMap<Text, ReturnType<typeof scan>>();
export function analyzeSource(doc: Text) {
  let result = analyses.get(doc);
  if (!result) { result = scan(doc.toString()); analyses.set(doc, result); }
  return result;
}
