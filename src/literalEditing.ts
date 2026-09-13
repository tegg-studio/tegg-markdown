import {syntaxTree} from "@codemirror/language";
import type {EditorState} from "@codemirror/state";
import {WidgetType} from "@codemirror/view";
import {unescapeAll} from "markdown-it/lib/common/utils.mjs";
import {markdownParser} from "./markdownParser";

export class LiteralWidget extends WidgetType {
  constructor(readonly text: string, readonly escaped = false) { super(); }
  eq(other: LiteralWidget) { return this.text === other.text && this.escaped === other.escaped; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-live-literal" + (this.escaped ? " cm-live-escaped" : "");
    span.textContent = this.text;
    return span;
  }
  ignoreEvent() { return false; }
}
export const decodeEntity = (raw: string) => unescapeAll(raw);

/** Copy visible literals, without interpreting literal text inside code as Markdown. */
export function literalClipboardText(text: string, state: EditorState) {
  if (state.selection.ranges.every(range => range.empty)) return text;
  const output = state.selection.ranges.map(selection => {
    let result = "", cursor = selection.from;
    const append = (from: number, to: number, value: string) => {
      if (from < cursor || from < selection.from || to > selection.to) return;
      result += state.sliceDoc(cursor, from) + value; cursor = to;
    };
    syntaxTree(state).iterate({from: selection.from, to: selection.to, enter(node) {
      if (["FencedCode", "CodeBlock", "HTMLBlock", "URL", "LinkTitle"].includes(node.name)) return false;
      if (node.name === "InlineCode") {
        if (node.from >= selection.from && node.to <= selection.to) {
          const token = markdownParser.parseInline(state.sliceDoc(node.from, node.to), {})[0]?.children?.[0];
          if (token?.type === "code_inline") append(node.from, node.to, token.content);
        } else {
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === "CodeMark" && child.from < selection.to && child.to > selection.from) append(Math.max(child.from, selection.from), Math.min(child.to, selection.to), "");
          }
        }
        return false;
      }
      if (node.name === "Entity") append(node.from, node.to, decodeEntity(state.sliceDoc(node.from, node.to)));
      if (node.name === "Escape") append(node.from, node.to, state.sliceDoc(node.from + 1, node.to));
    }});
    return result + state.sliceDoc(cursor, selection.to);
  }).join(state.lineBreak);
  return output;
}
