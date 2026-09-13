export type ProjectionBehavior = "render" | "decorate" | "source" | "fallback";

export type SyntaxCapability = {
  id: string;
  reader: ProjectionBehavior;
  liveEdit: ProjectionBehavior;
  quickLook: ProjectionBehavior;
  quickLookFallback?: ProjectionBehavior;
};

/**
 * The single capability manifest consumed by projections, documentation, and
 * tests. A parser is an implementation detail; these behaviors are the public
 * contract for each source syntax.
 */
const nativeSyntaxCapabilities = [
  { id: "headings-atx", reader: "render", liveEdit: "decorate", quickLook: "render" },
  { id: "headings-setext", reader: "render", liveEdit: "decorate", quickLook: "fallback" },
  { id: "paragraphs", reader: "render", liveEdit: "decorate", quickLook: "render" },
  { id: "line-breaks", reader: "render", liveEdit: "decorate", quickLook: "fallback" },
  { id: "emphasis", reader: "render", liveEdit: "decorate", quickLook: "render" },
  { id: "blockquotes", reader: "render", liveEdit: "decorate", quickLook: "render" },
  { id: "ordered-list", reader: "render", liveEdit: "decorate", quickLook: "render" },
  { id: "unordered-list", reader: "render", liveEdit: "decorate", quickLook: "render" },
  { id: "nested-list", reader: "render", liveEdit: "decorate", quickLook: "render" },
  { id: "inline-code", reader: "render", liveEdit: "decorate", quickLook: "render" },
  { id: "indented-code", reader: "render", liveEdit: "render", quickLook: "fallback" },
  { id: "horizontal-rule", reader: "render", liveEdit: "render", quickLook: "render" },
  { id: "links", reader: "render", liveEdit: "decorate", quickLook: "render" },
  { id: "link-title", reader: "render", liveEdit: "decorate", quickLook: "render" },
  { id: "autolink", reader: "render", liveEdit: "decorate", quickLook: "render" },
  { id: "reference-link", reader: "render", liveEdit: "render", quickLook: "fallback" },
  { id: "images", reader: "render", liveEdit: "render", quickLook: "fallback" },
  { id: "linked-image", reader: "render", liveEdit: "render", quickLook: "fallback" },
  { id: "escaping", reader: "render", liveEdit: "decorate", quickLook: "render" },
  { id: "html", reader: "render", liveEdit: "render", quickLook: "source" },
  { id: "tables", reader: "render", liveEdit: "render", quickLook: "fallback" },
  { id: "table-alignment", reader: "render", liveEdit: "render", quickLook: "fallback" },
  { id: "fenced-code", reader: "render", liveEdit: "render", quickLook: "render" },
  { id: "fenced-code-tilde", reader: "render", liveEdit: "render", quickLook: "render" },
  { id: "syntax-highlight", reader: "render", liveEdit: "render", quickLook: "fallback" },
  { id: "footnotes", reader: "render", liveEdit: "render", quickLook: "fallback" },
  { id: "heading-id", reader: "render", liveEdit: "decorate", quickLook: "fallback" },
  { id: "definition-list", reader: "render", liveEdit: "decorate", quickLook: "fallback" },
  { id: "strikethrough", reader: "render", liveEdit: "decorate", quickLook: "render" },
  { id: "task-list", reader: "render", liveEdit: "render", quickLook: "render" },
  { id: "emoji-direct", reader: "render", liveEdit: "decorate", quickLook: "render" },
  { id: "emoji-shortcode", reader: "render", liveEdit: "decorate", quickLook: "fallback" },
  { id: "highlight", reader: "render", liveEdit: "decorate", quickLook: "fallback" },
  { id: "subscript", reader: "render", liveEdit: "decorate", quickLook: "fallback" },
  { id: "superscript", reader: "render", liveEdit: "decorate", quickLook: "fallback" },
  { id: "bare-url", reader: "render", liveEdit: "decorate", quickLook: "render" },
  { id: "frontmatter", reader: "render", liveEdit: "render", quickLook: "render" },
  { id: "wiki-link", reader: "render", liveEdit: "decorate", quickLook: "fallback" },
  { id: "callout", reader: "render", liveEdit: "decorate", quickLook: "render" },
  { id: "math-inline", reader: "render", liveEdit: "render", quickLook: "source" },
  { id: "math-block", reader: "render", liveEdit: "render", quickLook: "source" },
  { id: "mermaid", reader: "render", liveEdit: "render", quickLook: "fallback" },
  { id: "graphviz", reader: "render", liveEdit: "render", quickLook: "fallback" },
] as const satisfies readonly SyntaxCapability[];

// Rich Quick Look uses the Reader projection. Resource permissions and preview
// budgets can still fall back; retain the native projection contract explicitly.
export const syntaxCapabilities = nativeSyntaxCapabilities.map(capability => ({
  ...capability,
  quickLook: capability.reader,
  quickLookFallback: capability.quickLook,
}));

export type SupportedSyntaxMarker = typeof syntaxCapabilities[number]["id"];

export const supportedSyntaxMarkers: readonly SupportedSyntaxMarker[] = syntaxCapabilities.map(({ id }) => id);

/**
 * The versioned semantic contract shared by Reader, Live Edit, documentation,
 * and host adapters. Renderers may use different parsers, but they must agree
 * on this capability set and preserve unsupported source.
 */
export const technicalMarkdownProfile = {
  version: "1.1",
  base: "commonmark",
  gfm: ["table", "table-alignment", "task-list", "strikethrough", "autolink"],
  document: ["footnote", "frontmatter", "image", "heading-id", "definition-list"],
  inline: ["emoji-shortcode", "highlight", "subscript", "superscript"],
  technical: ["highlighted-code", "katex", "mermaid", "graphviz"],
  knowledge: ["wikilink", "callout"],
  capabilities: supportedSyntaxMarkers,
  rawHtml: "sanitized",
  remoteResources: "blocked",
} as const;

export type TechnicalMarkdownProfile = typeof technicalMarkdownProfile;
