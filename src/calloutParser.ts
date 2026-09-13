import type MarkdownIt from "markdown-it";
import { parseCalloutHeader } from "./callouts";

/** Runs on block tokens, before inline parsing: rich title/body tokens survive. */
export function calloutPlugin(md: MarkdownIt) {
  md.core.ruler.after("block", "tegg_callouts", state => {
    for (let index = 0; index < state.tokens.length; index++) {
      const quote = state.tokens[index];
      const paragraph = state.tokens[index + 1];
      const inline = state.tokens[index + 2];
      if (quote.type !== "blockquote_open" || paragraph?.type !== "paragraph_open" || inline?.type !== "inline") continue;
      const newline = inline.content.indexOf("\n");
      const header = parseCalloutHeader(newline < 0 ? inline.content : inline.content.slice(0, newline));
      if (!header) continue;
      if (state.env?.profile === "github" && (!/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/.test(newline < 0 ? inline.content : inline.content.slice(0, newline)) || quote.level !== 0)) continue;
      quote.attrSet("data-callout", header.type);
      quote.attrJoin("class", `callout md-render-callout callout-${header.type}`);
      // This metadata is structural only. Folding interaction is intentionally separate.
      if (header.fold) quote.attrSet("data-callout-fold", header.fold);
      const titleOpen = new state.Token("callout_title_open", "div", 1);
      titleOpen.attrSet("class", "callout-title");
      const title = new state.Token("inline", "", 0);
      title.content = header.title || header.rawType.toUpperCase();
      title.children = [];
      const titleClose = new state.Token("callout_title_close", "div", -1);
      const body = newline < 0 ? "" : inline.content.slice(newline + 1);
      inline.content = body;
      const removeCount = body.length ? 0 : 3;
      state.tokens.splice(index + 1, removeCount, titleOpen, title, titleClose);
      index += 3;
    }
  });
}
