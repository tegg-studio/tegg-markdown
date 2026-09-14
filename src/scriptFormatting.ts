import {syntaxTree} from "@codemirror/language";
import type {EditorState} from "@codemirror/state";
import {markdownParser} from "./markdownParser";

type ScriptPair={from:number;contentFrom:number;contentTo:number;to:number;tag:"sub"|"sup"};
const cache=new WeakMap<EditorState,{tree:ReturnType<typeof syntaxTree>;value:ScriptPair[]}>();
export function scriptFormatting(state:EditorState){const tree=syntaxTree(state),old=cache.get(state);if(old?.tree===tree)return old.value;const value=scanScripts(state);cache.set(state,{tree,value});return value;}
function scanScripts(state: EditorState):ScriptPair[] {
  const source = state.doc.toString();
  if(!/[~^]/.test(source))return [];
  const excluded: {from: number; to: number}[] = [];
  syntaxTree(state).iterate({enter(node) {
    if (["InlineCode", "FencedCode", "CodeBlock", "HTMLBlock", "HTMLTag", "URL", "LinkTitle", "Escape"].includes(node.name)) {
      excluded.push({from: node.from, to: node.to}); return false;
    }
  }});
  const pairs: {from: number; contentFrom: number; contentTo: number; to: number; tag: "sub" | "sup"}[] = [];
  // Tree traversal skips descendants of excluded nodes, so these ranges are
  // disjoint and source ordered. Regex matches also advance in source order.
  let excludedIndex = 0;
  for (const match of source.matchAll(/(?<!~)~([^~\n]+)~(?!~)|\^([^\^\n]+)\^/g)) {
    const from = match.index!, to = from + match[0].length;
    while (excludedIndex < excluded.length && excluded[excludedIndex].to <= from) excludedIndex++;
    if (excludedIndex < excluded.length && excluded[excludedIndex].from < to) continue;
    const tag = match[1] !== undefined ? "sub" : "sup";
    const tokens = markdownParser.parseInline(match[0], {})[0]?.children ?? [];
    if (tokens.length !== 3 || tokens[0].type !== `${tag}_open` || tokens[2].type !== `${tag}_close`) continue;
    pairs.push({from, contentFrom: from + 1, contentTo: to - 1, to, tag});
  }
  return pairs;
}
