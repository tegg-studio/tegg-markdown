import {ensureSyntaxTree, syntaxTree} from '@codemirror/language';
import type {EditorState} from '@codemirror/state';
import type {SyntaxNode} from '@lezer/common';
import {blockContext} from './blockContext';
import {objectAt, type ObjectKind} from './editingController';
import type {MarkdownProfile} from './syntaxProfiles';
import type {StructuralPlan} from './structuralCommands';

export type BlockTarget = {from:number; to:number; position:number; kind:ObjectKind|'text'|'source'|'divider'|'definition'; nodeName:string};

/** Resolve a semantic block, never the inline link/formula below the pointer. */
export function commandBlockAt(state:EditorState, at:number, profile:MarkdownProfile='tegg'):BlockTarget|null {
  at=Math.max(0,Math.min(at,state.doc.length));
  const line=state.doc.lineAt(at), tree=ensureSyntaxTree(state,Math.min(state.doc.length,line.to+1),100)??syntaxTree(state);
  const probe=Math.min(line.to, Math.max(line.from+1,at));
  const nodes:SyntaxNode[]=[];
  for(let node:SyntaxNode|null=tree.resolveInner(probe,-1);node;node=node.parent)nodes.push(node);
  const object=objectAt(state,probe,profile);
  if(object?.kind==='metadata')return null; // Metadata owns its separate panel.
  const block=nodes.find(node=>['FencedCode','CodeBlock','Table','HTMLBlock','HorizontalRule'].includes(node.name));
  const paragraph=nodes.find(node=>(node.name==='Paragraph'||node.name==='Task')||/^(ATXHeading[1-6]|SetextHeading[12])$/.test(node.name));
  const standalone=object && object.from>=line.from && object.to<=line.to &&
    !state.sliceDoc(blockContext(state,line.to).contentFrom,object.from).trim() && !state.sliceDoc(object.to,line.to).trim();
  if(block) {
    const kind=block.name==='Table'?'table':block.name==='HorizontalRule'?'divider':block.name==='HTMLBlock'?'source':
      object && ['mermaid','graphviz','math'].includes(object.kind)?object.kind:'code';
    return {from:block.from,to:block.to,position:Math.min(block.to,block.from+1),kind,nodeName:block.name};
  }
  if(object && (object.kind==='callout' || (object.kind==='math'&&state.sliceDoc(object.from,object.from+2)==='$$') ||
    (object.kind==='image'&&standalone) || (object.kind==='footnote' && at>=object.from&&at<=object.to)))
    return {...object,position:Math.min(object.to,object.from+1),nodeName:object.kind};
  const protectedNode=nodes.find(node=>['LinkReference','HTMLBlock'].includes(node.name));
  if(protectedNode)return {from:protectedNode.from,to:protectedNode.to,position:protectedNode.from+1,kind:'source',nodeName:protectedNode.name};
  if(paragraph&&profile==='tegg'&&state.sliceDoc(paragraph.from,paragraph.to).split('\n').some(row=>/^\s*(?:>\s*)*:[ \t]+/.test(row)))return {from:paragraph.from,to:paragraph.to,position:paragraph.from+1,kind:'definition',nodeName:'DefinitionList'};
  if(paragraph)return {from:paragraph.from,to:paragraph.to,position:Math.min(state.doc.lineAt(paragraph.from).to,blockContext(state,state.doc.lineAt(paragraph.from).to).contentFrom+1),kind:'text',nodeName:paragraph.name};
  const context=blockContext(state,line.to);
  if(context.protectedBlock)return null;
  return {from:line.from,to:line.to,position:context.contentFrom,kind:'text',nodeName:'Paragraph'};
}

/** A block conversion changes one paragraph, preserving its containers/inline marks.
 * Soft source wraps join with spaces; explicit hard breaks stay explicit inline breaks.
 * Text-selection toolbar commands retain their existing per-line semantics.
 */
export function planBlockHeading(state:EditorState,target:BlockTarget,level:number):StructuralPlan|null {
  if(target.kind!=='text'||level<0||level>6)return null;
  const first=state.doc.lineAt(target.from), last=state.doc.lineAt(target.to);
  const setext=target.nodeName.startsWith('SetextHeading');
  const start=blockContext(state,first.to).contentFrom;
  const to=last.to;
  const parts:string[]=[];
  for(let n=first.number;n<=last.number-(setext?1:0);n++) {
    const line=state.doc.line(n),context=blockContext(state,line.to);
    let text=state.sliceDoc(context.contentFrom,line.to);
    if(n===first.number&&target.nodeName.startsWith('ATXHeading'))text=text.replace(/^#{1,6}(?:[ \t]+|$)/,'').replace(/[ \t]+#+[ \t]*$/,'');
    if(n<last.number-(setext?1:0)) {
      const hard=/ {2,}$/.test(text)||/(^|[^\\])(\\\\)*\\$/.test(text);
      text=hard?text.replace(/(?: {2,}|\\)$/,'')+'<br>':text.trimEnd()+' ';
    }
    parts.push(text);
  }
  // Removing a paragraph style is a no-op. Do not normalize ordinary source wraps.
  if(!level&&!/Heading/.test(target.nodeName))return null;
  const insert=(level?'#'.repeat(level)+' ':'')+parts.join('');
  const expected=state.sliceDoc(start,to);
  if(insert===expected)return null;
  return {patches:[{from:start,to,expected,insert}],selection:{anchor:start+(level?level+1:0)},focus:'body'};
}
