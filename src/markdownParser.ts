import {gfmAutolinks, gfmTagfilter} from "./gfmRules";
import {resolveProfile, type MarkdownProfile} from "./syntaxProfiles";
import MarkdownIt from "markdown-it";
import { mathPlugin } from "./mathSyntax";
import deflist from "markdown-it-deflist";
import { full as emoji } from "markdown-it-emoji";
import footnote from "markdown-it-footnote";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import taskLists from "markdown-it-task-lists";
import { findHighlights, parseWikiLink, type HighlightRange } from "./profile";
import { highlightCode } from "./renderKit";
import { calloutPlugin } from "./calloutParser";

function wikiLinkPlugin(md: MarkdownIt) {
  md.inline.ruler.before("link", "wikilink", (state, silent) => {
    if (state.src.slice(state.pos, state.pos + 2) !== "[[") return false;
    const close = state.src.indexOf("]]", state.pos + 2);
    if (close < 0) return false;
    const raw = state.src.slice(state.pos + 2, close);
    const { target, label } = parseWikiLink(raw);
    if (!target) return false;

    if (!silent) {
      const open = state.push("link_open", "a", 1);
      open.attrs = [["href", "#"], ["data-wiki-target", encodeURIComponent(target)], ["class", "wikilink"]];
      const text = state.push("text", "", 0);
      text.content = label || target;
      state.push("link_close", "a", -1);
    }
    state.pos = close + 2;
    return true;
  });
}

function highlightPlugin(md: MarkdownIt) {
  const rangesByState = new WeakMap<object, Map<number, HighlightRange>>();
  md.inline.ruler.before("emphasis", "highlight", (state, silent) => {
    if (state.src.slice(state.pos, state.pos + 2) !== "==") return false;
    let ranges = rangesByState.get(state);
    if (!ranges) {
      ranges = new Map(findHighlights(state.src).map(range => [range.from, range]));
      rangesByState.set(state, ranges);
    }
    const range = ranges.get(state.pos);
    if (!range || range.to > state.posMax) return false;
    const maximum = state.posMax;
    if (!silent) {
      state.push("mark_open", "mark", 1).markup = "==";
      state.pos = range.contentFrom;
      state.posMax = range.contentTo;
      // Reuse the current inline state so nested styles and link context are
      // preserved, just as Markdown's own link-label tokenizer does.
      state.md.inline.tokenize(state);
      state.push("mark_close", "mark", -1).markup = "==";
    }
    state.pos = range.to;
    state.posMax = maximum;
    return true;
  });
}

function headingIdPlugin(md: MarkdownIt, allowExplicit = true) {
  const headingIdPattern = /\s*\{#([A-Za-z][A-Za-z0-9_.:-]*)\}\s*$/u;

  md.core.ruler.after("inline", "heading_id", (state) => {
    for (let index = 1; index < state.tokens.length - 1; index += 1) {
      const inline = state.tokens[index];
      const headingOpen = state.tokens[index - 1];
      const headingClose = state.tokens[index + 1];
      if (inline.type !== "inline" || headingOpen.type !== "heading_open" || headingClose.type !== "heading_close") continue;

      if (state.env?.outline && headingOpen.map) headingOpen.attrSet("data-outline-anchor", `outline-line-${headingOpen.map[0]}`);

      if (!allowExplicit) continue;
      const match = inline.content.match(headingIdPattern);
      const lastChild = inline.children?.at(-1);
      if (!match || !lastChild || lastChild.type !== "text" || !headingIdPattern.test(lastChild.content)) continue;

      headingOpen.attrSet("id", match[1]);
      inline.content = inline.content.slice(0, match.index).trimEnd();
      lastChild.content = lastChild.content.replace(headingIdPattern, "");
    }
  });
}

function imageAltTextPlugin(md: MarkdownIt) {
  md.core.ruler.after("text_join", "image_alt_text", state => {
    // markdown-it joins escaped/entity text only in top-level inline children.
    // Image labels have their own inline tokens; keep their literal characters for alt rendering.
    const pending = [...state.tokens];
    while (pending.length) {
      const token = pending.pop()!;
      if (!token.children) continue;
      if (token.type === "image") {
        for (const child of token.children) if (child.type === "text_special") child.type = "text";
      }
      for (const child of token.children) pending.push(child);
    }
  });
}

function tableAlignmentClassPlugin(md: MarkdownIt) {
  md.core.ruler.after("block", "table_alignment_classes", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "th_open" && token.type !== "td_open") continue;
      const style = token.attrGet("style") ?? "";
      const alignment = style.match(/(?:^|;)\s*text-align\s*:\s*(left|center|right)\s*(?:;|$)/i)?.[1]?.toLowerCase();
      if (!alignment) continue;

      token.attrJoin("class", `align-${alignment}`);
      const styleIndex = token.attrIndex("style");
      if (styleIndex >= 0) token.attrs?.splice(styleIndex, 1);
    }
  });
}

export function createMarkdownParser(profile: MarkdownProfile = "tegg", extensions: readonly string[] = ["table", "strikethrough", "autolink", "tagfilter", "tasklist"]) {
  resolveProfile(profile);
  const parser = profile === "tegg" ? new MarkdownIt({html: true, linkify: true, typographer: true})
    : new MarkdownIt("commonmark", {html: true}).enable(extensions.filter(name => ["table", "strikethrough"].includes(name)));
  if (profile !== "tegg") {
    if (extensions.includes("autolink")) parser.use(gfmAutolinks);
    if (extensions.includes("tagfilter")) parser.use(gfmTagfilter);
    parser.renderer.rules.s_open = () => "<del>"; parser.renderer.rules.s_close = () => "</del>";
  }
  if (profile === "tegg" || extensions.includes("tasklist")) parser.use(taskLists as any, {enabled: profile === "tegg", label: profile === "tegg", labelAfter: profile === "tegg"});
  parser.use(tableAlignmentClassPlugin).use(imageAltTextPlugin);
  if (profile !== "gfm") {
    parser.use(mathPlugin).use(footnote as any).use(emoji, {shortcuts: {}});
    parser.renderer.rules.footnote_caption = (tokens, index) => `[${tokens[index].meta.id + 1}]`;
    parser.use(calloutPlugin);
  }
  if (profile === "tegg") parser.use(deflist).use(sub).use(sup).use(wikiLinkPlugin).use(highlightPlugin);
  parser.use(headingIdPlugin, profile === "tegg");
  return parser;
}
export const markdownParser = createMarkdownParser();
const dialectParsers = new Map<MarkdownProfile, MarkdownIt>([["tegg", markdownParser]]);
export function parserFor(profile: MarkdownProfile = "tegg"): MarkdownIt {
  resolveProfile(profile);
  let parser = dialectParsers.get(profile);
  if (!parser) {parser = createMarkdownParser(profile); dialectParsers.set(profile, parser);}
  return parser;
}
