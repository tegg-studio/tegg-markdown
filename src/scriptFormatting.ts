import {syntaxTree} from "@codemirror/language";
import type {EditorState} from "@codemirror/state";
import {markdownParser} from "./markdownParser";

export function scriptFormatting(state: EditorState) {
  const source = state.doc.toString();
  const excluded: {from: number; to: number}[] = [];
  syntaxTree(state).iterate({enter(node) {
    if (["InlineCode", "FencedCode", "CodeBlock", "HTMLBlock", "HTMLTag", "URL", "LinkTitle", "Escape"].includes(node.name)) {
      excluded.push({from: node.from, to: node.to}); return false;
    }
  }});
  const pairs: {from: number; contentFrom: number; contentTo: number; to: number; tag: "sub" | "sup"}[] = [];
  for (const match of source.matchAll(/(?<!~)~([^~\n]+)~(?!~)|\^([^\^\n]+)\^/g)) {
    const from = match.index!, to = from + match[0].length;
    if (excluded.some(range => from < range.to && to > range.from)) continue;
    const tag = match[1] !== undefined ? "sub" : "sup";
    const tokens = markdownParser.parseInline(match[0], {})[0]?.children ?? [];
    if (tokens.length !== 3 || tokens[0].type !== `${tag}_open` || tokens[2].type !== `${tag}_close`) continue;
    pairs.push({from, contentFrom: from + 1, contentTo: to - 1, to, tag});
  }
  return pairs;
}
