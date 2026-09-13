/** Content dialect, independent of API/profile schema version. */
export type MarkdownProfile = "tegg" | "github" | "gfm";
export function resolveProfile(profile: MarkdownProfile = "tegg"): MarkdownProfile {
  if (!["tegg", "github", "gfm"].includes(profile)) throw new TypeError(`Unknown Markdown profile: ${profile}`);
  return profile;
}
export const markdownProfiles = Object.freeze({
  gfm: {standard: "0.29-gfm", extensions: []},
  github: {standard: "0.29-gfm", extensions: ["footnotes", "emoji", "alerts", "math", "diagrams"]},
  tegg: {standard: "technical-markdown", extensions: ["frontmatter", "wikilinks", "callouts", "math", "graphviz", "highlight", "subscript", "superscript", "definition-lists"]},
});
