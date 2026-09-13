import type MarkdownIt from "markdown-it";

export function inlineMathAt(source: string, from: number) {
  if (source.slice(from, from + 2) === "$`" && source[from - 1] !== "\\") {
    const end = source.indexOf("`$", from + 2);
    if (end > from + 2 && !source.slice(from + 2, end).includes("\n")) return {from, to: end + 2, source: source.slice(from + 2, end)};
  }
  if (source[from] !== "$" || source[from + 1] === "$" || source[from - 1] === "$" || /\s/.test(source[from + 1] ?? " ")) return null;
  if (/^\$\d+(?:[.,]\d+)?[，。；：、]/.test(source.slice(from))) return null;
  let slashes = 0;
  for (let i = from - 1; i >= 0 && source[i] === "\\"; i--) slashes++;
  if (slashes % 2) return null;
  for (let end = from + 1; end < source.length && source[end] !== "\n"; end++) {
    if (source[end] === "`" || /^<[A-Za-z/!]/.test(source.slice(end))) return null;
    if (source[end] !== "$") continue;
    let escapes = 0;
    for (let i = end - 1; i > from && source[i] === "\\"; i--) escapes++;
    if (escapes % 2) continue;
    if (end === from + 1 || /\s/.test(source[end - 1]) || /[\d$]/.test(source[end + 1] ?? "")) return null;
    return {from, to: end + 1, source: source.slice(from + 1, end)};
  }
  return null;
}

/** Opaque tokens protect TeX from Markdown emphasis, sub/sup and HTML parsing. */
export function mathPlugin(md: MarkdownIt) {
  md.inline.ruler.before("escape", "tegg_math_inline", (state, silent) => {
    const match = inlineMathAt(state.src, state.pos);
    if (!match) return false;
    if (!silent) state.push("tegg_math_inline", "", 0).content = match.source;
    state.pos = match.to;
    return true;
  });
  md.block.ruler.before("fence", "tegg_math_block", (state, start, end, silent) => {
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    const line = (n: number) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
    const opening = line(start);
    if (!opening.startsWith("$$")) return false;
    let content = opening.slice(2), next = start + 1;
    if (content.trimEnd().endsWith("$$") && content.trim().length > 2) content = content.trimEnd().slice(0, -2);
    else {
      if (content.trim()) return false;
      let close = next;
      while (close < end && !(state.sCount[close] < state.blkIndent && !state.isEmpty(close)) && line(close).trim() !== "$$") close++;
      if (close >= end || line(close).trim() !== "$$") return false;
      content = state.getLines(next, close, state.blkIndent, false);
      next = close + 1;
    }
    if (silent) return true;
    const token = state.push("tegg_math_block", "", 0);
    token.block = true; token.content = content; token.map = [start, next];
    state.line = next;
    return true;
  }, {alt: ["paragraph", "reference", "blockquote", "list"]});
  for (const kind of ["inline", "block"]) md.renderer.rules[`tegg_math_${kind}`] = (tokens, i) => {
    const tag = kind === "block" ? "div" : "span";
    return `<${tag} data-tegg-math="${kind}" data-tex="${md.utils.escapeHtml(tokens[i].content)}"></${tag}>${kind === "block" ? "\n" : ""}`;
  };
}
