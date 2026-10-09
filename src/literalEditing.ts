import emojiMap from "markdown-it-emoji/lib/data/full.mjs";
import {footnoteDocument} from './footnoteModel';
import {resourceContext} from "./editorHost";
import {syntaxTree} from "@codemirror/language";
import {EditorSelection, type EditorState, type Text} from "@codemirror/state";
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

/** Visible entities, escapes, shortcode emoji and extended graphemes are indivisible. */
const literalModels=new WeakMap<Text,{tree:ReturnType<typeof syntaxTree>;profile:string;cell:boolean;atoms:{from:number;to:number}[]}>();
export function literalSemanticAtoms(state: EditorState): {from:number;to:number}[] {
  const tree=syntaxTree(state),context=state.facet(resourceContext),profile=context.profile??'tegg',cell=context.editingContext==='table-cell',cached=literalModels.get(state.doc);
  if(cached&&cached.tree===tree&&cached.profile===profile&&cached.cell===cell)return cached.atoms;
  const source=state.doc.toString(),atoms:{from:number;to:number}[]=[],excluded:{from:number;to:number}[]=[];
  tree.iterate({enter(node){
    if(cell&&node.name==='HTMLBlock')return false;
    if(['FencedCode','CodeBlock','HTMLBlock','Table','InlineCode','URL','LinkTitle'].includes(node.name)){excluded.push({from:node.from,to:node.to});return false;}
    if(node.name==='Entity'||node.name==='Escape')atoms.push({from:node.from,to:node.to});
  }});
  if(cell){for(const match of source.matchAll(/&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);|\\[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/gi)){const from=match.index!,to=from+match[0].length;if(!excluded.some(item=>item.from<to&&item.to>from)&&(match[0].startsWith('\\')||decodeEntity(match[0])!==match[0]))atoms.push({from,to});}}
  if(profile!=='gfm')for(const match of source.matchAll(/:([+\-\w]+):/g)){
    const from=match.index!,to=from+match[0].length;let escapes=0;for(let n=from-1;n>=0&&source[n]==='\\';n--)escapes++;
    if((emojiMap as Record<string,string>)[match[1]]&&escapes%2===0&&!excluded.some(item=>item.from<to&&item.to>from))atoms.push({from,to});
  }
  if(profile!=='gfm')atoms.push(...footnoteDocument(source,excluded).references.map(({from,to})=>({from,to})));
  for(const unit of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(source))if(unit.segment.length>1)atoms.push({from:unit.index,to:unit.index+unit.segment.length});
  atoms.sort((a,b)=>a.from-b.from||b.to-a.to);literalModels.set(state.doc,{tree,profile,cell,atoms});return atoms;
}
export function snapLiteralSelection(state:EditorState,selection:EditorSelection):EditorSelection {
  const atoms=literalSemanticAtoms(state);
  return EditorSelection.create(selection.ranges.map(range=>{
    let from=range.from,to=range.to;
    for(const atom of atoms){
      if(range.empty){if(from>atom.from&&from<atom.to)from=to=range.assoc>0?atom.to:atom.from;}
      else if(from<atom.to&&to>atom.from){from=Math.min(from,atom.from);to=Math.max(to,atom.to);}
    }
    return range.empty?EditorSelection.cursor(from,range.assoc):range.anchor<=range.head?EditorSelection.range(from,to):EditorSelection.range(to,from);
  }),selection.mainIndex);
}
