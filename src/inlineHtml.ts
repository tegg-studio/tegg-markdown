import {syntaxTree} from "@codemirror/language";
import type {EditorState} from "@codemirror/state";
import type {SyntaxNode} from "@lezer/common";
import {simpleBreakTag} from "./liveBreaks";

type Pair = {from: number; contentFrom: number; contentTo: number; to: number; tag: string};
const cache=new WeakMap<EditorState,{tree:ReturnType<typeof syntaxTree>;value:{pairs:Pair[];paragraphs:Set<number>}}>();
export function inlineHtmlFormatting(state:EditorState){
  const tree=syntaxTree(state),old=cache.get(state);if(old?.tree===tree)return old.value;
  const value=scanInlineHtml(state);cache.set(state,{tree,value});return value;
}
function scanInlineHtml(state: EditorState) {
  const pairs: Pair[] = [], paragraphs = new Set<number>();
  const source = state.doc.toString();
  if(!source.includes("<"))return {pairs,paragraphs};
  syntaxTree(state).iterate({enter(node) {
    if (["FencedCode", "CodeBlock", "HTMLBlock"].includes(node.name)) return false;
    if (node.name !== "Paragraph" && !/^(ATX|Setext)Heading[1-6]$/.test(node.name)) return;
    const stack: {tag: string; from: number; to: number}[] = [], found: Pair[] = [];
    let supported = true;
    const visit = (child: SyntaxNode) => {
      if (child.name === "InlineCode") return;
      if (child.name === "HTMLTag") {
        const raw = source.slice(child.from, child.to);
        if (simpleBreakTag.test(raw)) return;
        const match = raw.match(/^<(\/)?(mark|u|strong|em|del|sub|sup)>$/i);
        if (!match) { supported = false; return; }
        const tag = match[2].toLowerCase();
        if (!match[1]) stack.push({tag, from: child.from, to: child.to});
        else {
          const open = stack.pop();
          if (!open || open.tag !== tag) supported = false;
          else found.push({from: open.from, contentFrom: open.to, contentTo: child.from, to: child.to, tag});
        }
      }
      for (let nested = child.firstChild; nested; nested = nested.nextSibling) visit(nested);
    };
    visit(node.node);
    if (supported && !stack.length) { paragraphs.add(node.from); pairs.push(...found); }
    return false;
  }});
  return {pairs, paragraphs};
}
