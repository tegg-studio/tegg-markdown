import { parserFor } from "./markdownParser";
import type {MarkdownProfile} from "./syntaxProfiles";
import { findFrontmatter } from "./profile";

/** Resolve explicit heading IDs, readable heading names and conventional slugs. */
export function resolveHeadingLink(source: string, fragment: string, profile: MarkdownProfile = "tegg") {
  const normalized = source.replace(/\r\n?/g, "\n");
  const {body} = profile === "tegg" ? findFrontmatter(normalized) : {body: normalized};
  const offset = normalized.length - body.length;
  const starts = [offset];
  for (let i = 0; i < body.length; i++) if (body[i] === "\n") starts.push(offset + i + 1);
  const tokens = parserFor(profile).parse(body, {outline: true, profile});
  const slug = (value: string) => value.toLowerCase().trim().replace(/[^\p{L}\p{N}_\s-]/gu, "").replace(/\s+/g, "-");
  const counts = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "heading_open" || !token.map) continue;
    const inline = tokens[i + 1];
    const title = inline.children?.filter(child => child.nesting === 0 && child.type !== "html_inline").map(child => child.content).join("") ?? inline.content;
    const base = slug(title);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    const generated = base + (count ? `-${count}` : "");
    if (token.attrGet("id") === fragment || title === fragment || generated === fragment) {
      return {from: starts[token.map[0]], anchor: `outline-line-${token.map[0]}`};
    }
  }
  return null;
}
