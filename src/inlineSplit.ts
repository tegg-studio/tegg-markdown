import {ensureSyntaxTree,syntaxTree} from '@codemirror/language';
import type {EditorView} from '@codemirror/view';
import {inlineHtmlFormatting} from './inlineHtml';
import {scriptFormatting} from './scriptFormatting';
import {analyzeSource} from './sourceAnalysis';
/** Close/reopen only semantic inline spans crossing a new paragraph boundary. */
export function inlineBoundaryFormatting(view:EditorView,at:number){
  const spans:{from:number;to:number;contentFrom:number;contentTo:number}[]=[];
  const tree=ensureSyntaxTree(view.state,view.state.doc.length,50)??syntaxTree(view.state);
  for(let node=tree.resolveInner(at,-1);node;node=node.parent!){if(!['StrongEmphasis','Emphasis','Strikethrough','InlineCode'].includes(node.name))continue;const first=node.firstChild,last=node.lastChild;if(first&&last&&first!==last)spans.push({from:node.from,to:node.to,contentFrom:first.to,contentTo:last.from});}
  spans.push(...inlineHtmlFormatting(view.state).pairs,...scriptFormatting(view.state),...analyzeSource(view.state.doc).highlights);
  const crossing=spans.filter(span=>span.contentFrom<at&&span.contentTo>at).sort((a,b)=>(a.to-a.from)-(b.to-b.from));
  return {close:crossing.map(span=>view.state.sliceDoc(span.contentTo,span.to)).join(''),open:[...crossing].reverse().map(span=>view.state.sliceDoc(span.from,span.contentFrom)).join('')};
}
