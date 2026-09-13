import type MarkdownIt from "markdown-it";
/** Literal autolinks from GFM section 6.9, outside explicit links and HTML anchors. */
export function gfmAutolinks(md: MarkdownIt) {
  md.core.ruler.after("inline", "gfm_autolinks", state => {
    for (const block of state.tokens) {
      if (block.type !== "inline" || !block.children) continue;
      const result = []; let linkDepth = 0;
      for (const token of block.children) {
        if (token.type === "link_open" || (token.type === "html_inline" && /^<a(?:\s|>)/i.test(token.content))) linkDepth++;
        if (token.type === "link_close" || (token.type === "html_inline" && /^<\/a\s*>/i.test(token.content))) linkDepth--;
        if (token.type !== "text" || linkDepth > 0) {result.push(token); continue;}
        const text = token.content; let cursor = 0;
        for (const match of text.matchAll(/(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>]+|[a-z0-9._+-]+@[a-z0-9._-]+/gi)) {
          const start = match.index!, prefix = text.slice(0, start);
          if (prefix.lastIndexOf("<") > prefix.lastIndexOf(">")) continue;
          let value = match[0].replace(/[?!.,:*_~]+$/, "");
          const email = !/^(?:https?:|ftp:|www\.)/i.test(value);
          if (email) {
            if (!/^[a-z0-9._+-]+@[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/i.test(value) || !/[a-z0-9]$/i.test(match[0].replace(/\.+$/, ""))) continue;
          } else {
            value = value.replace(/&[a-z0-9]+;$/i, "");
            let extra = (value.match(/\)/g)?.length ?? 0) - (value.match(/\(/g)?.length ?? 0);
            while (extra-- > 0 && value.endsWith(")")) value = value.slice(0, -1);
            const domain = value.replace(/^(?:https?:\/\/|ftp:\/\/)/i, "").split(/[/?#]/)[0];
            if (!domain.includes(".") || domain.split(".").slice(-2).some(part => part.includes("_"))) continue;
            if (/^www\./i.test(value) && start > 0 && !/[\s(*_~]/.test(text[start - 1])) continue;
          }
          const href = md.normalizeLink(email ? `mailto:${value}` : /^www\./i.test(value) ? `http://${value}` : value);
          if (!md.validateLink(href)) continue;
          if (start > cursor) {const before = new state.Token("text", "", 0); before.content = text.slice(cursor, start); result.push(before);}
          const open = new state.Token("link_open", "a", 1); open.attrs = [["href", href]];
          const label = new state.Token("text", "", 0); label.content = value;
          result.push(open, label, new state.Token("link_close", "a", -1)); cursor = start + value.length;
        }
        if (!cursor) result.push(token);
        else if (cursor < text.length) {const tail = new state.Token("text", "", 0); tail.content = text.slice(cursor); result.push(tail);}
      }
      block.children = result;
    }
  });
}
export function gfmTagfilter(md: MarkdownIt) {
  for (const kind of ["html_inline", "html_block"]) md.renderer.rules[kind] = (tokens, index) =>
    tokens[index].content.replace(/<(\/?)(title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext)(?=[\s/>])/gi, "&lt;$1$2");
}
