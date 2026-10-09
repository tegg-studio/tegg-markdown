import {ChangeSet, EditorSelection, EditorState, StateEffect, StateField, Transaction, type Extension, type SelectionRange, type Text} from '@codemirror/state';
import {ensureSyntaxTree, syntaxTree} from '@codemirror/language';
import {isolateHistory,invertedEffects} from '@codemirror/commands';
import {Decoration, EditorView, type DecorationSet} from '@codemirror/view';
import type {SyntaxNode} from '@lezer/common';
import {codeSource} from './codeStructure';
import {calloutRanges} from './calloutEditing';
import {resourceContext, displaySessionFor} from './editorHost';
import {inlineMathAt} from './mathSyntax';
import {parserFor} from './markdownParser';
import {htmlLiteralContainerEnd} from './htmlLiteralSource';
import {snapLiteralSelection,literalSemanticAtoms,decodeEntity} from './literalEditing';
import {selectionFormatting} from './selectionFormatting';
import {inlineHtmlFormatting} from './inlineHtml';
import {blockContext} from './blockContext';
import {restoreSelection} from './selectionHistory';
import {validateSourcePatches, type SourcePatch} from './sourcePatch';

export type SemanticObjectBoundary = {
  from:number; to:number; kind:'code'|'table'|'image'|'math'|'diagram'|'html'|'callout'|'rule';
  block:boolean; parentFrom:number; parentTo:number; parentName:string;
  /** A collapsed container still permits selecting only its visible title. */
  titleFrom?:number; headerTo?:number;
  /** Structural prefix included by a standalone child, not owned by its contents. */
  prefix?:string;
};
export type SemanticSelectionDeletion = {
  patches:SourcePatch[]; selection:{anchor:number}; originalSelection:EditorSelection;
};
const structuralContainers=new Set(['Document','Blockquote','ListItem']);
const containers=new Set(['Blockquote','ListItem','BulletList','OrderedList']);
const opaqueNodes=new Set(['FencedCode','CodeBlock','HTMLBlock','Table']);
const explicitEmpty=/^<p>\s*<br\s*\/?>\s*<\/p>$/i;
function parsed(state:EditorState){return ensureSyntaxTree(state,state.doc.length,150);}
function sameNode(a:SyntaxNode|null,b:SyntaxNode|null){return !!a&&!!b&&a.name===b.name&&a.from===b.from&&a.to===b.to;}
function parentOf(node:SyntaxNode|null):SyntaxNode|null {for(;node;node=node.parent)if(structuralContainers.has(node.name))return node;return null;}
function owned(state:EditorState,node:SyntaxNode,range:{from:number;to:number},kind:SemanticObjectBoundary['kind'],block=true):SemanticObjectBoundary {
  const parent=parentOf(node.parent)??node;
  return {from:range.from,to:range.to,kind,block,parentFrom:parent.from,parentTo:parent.to,parentName:parent.name,
    prefix:block?state.sliceDoc(state.doc.lineAt(range.from).from,node.from):undefined};
}
const boundaryModels=new WeakMap<Text,{tree:ReturnType<typeof syntaxTree>;profile:string;cell:boolean;objects:SemanticObjectBoundary[]}>();
/** Parse object source boundaries. Child code/cell EditorViews do not install this module. */
export function semanticObjectBoundaries(target:EditorView|EditorState):SemanticObjectBoundary[] {
  const state=target instanceof EditorState?target:target.state,tree=parsed(state);if(!tree)return [];
  const source=state.doc.toString(),context=state.facet(resourceContext),cell=context.editingContext==='table-cell',profile=context.profile??'tegg',out:SemanticObjectBoundary[]=[];
  const excluded:{from:number;to:number}[]=[],inlineParagraphs=inlineHtmlFormatting(state).paragraphs;
  const cached=boundaryModels.get(state.doc);
  if(cached&&cached.tree===tree&&cached.profile===profile&&cached.cell===cell)out.push(...cached.objects);
  else {
  tree.iterate({enter(ref){
    const node=ref.node;
    if(out.some(item=>item.block&&item.from<=node.from&&item.to>=node.to))return false;
    if(ref.name==='FencedCode'||ref.name==='CodeBlock'){
      if(cell)return false;
      const block=codeSource(state,node),range=block??node;
      const raw=block?.plain??state.sliceDoc(node.from,node.to),language=/^\s*[`~]{3,}([^\n]*)/.exec(raw)?.[1].trim().split(/\s/)[0].toLowerCase();
      const kind=profile!=='gfm'&&['mermaid','dot','graphviz'].includes(language??'')?'diagram':profile!=='gfm'&&language==='math'?'math':'code';
      out.push(owned(state,node,range,kind));excluded.push(range);return false;
    }
    if(ref.name==='Table') {if(cell)return false;out.push(owned(state,node,{from:state.doc.lineAt(node.from).from,to:node.to},'table'));excluded.push(node);return false;}
    if(ref.name==='HTMLBlock'){
      if(cell)return false;
      let to=node.to;const end=htmlLiteralContainerEnd(source,node.from);
      if(end!==null&&end>to&&!state.sliceDoc(end,state.doc.lineAt(end).to).trim())to=state.doc.lineAt(end).to;
      if(to>node.from&&source[to-1]==='\n')to--;
      if(!explicitEmpty.test(state.sliceDoc(node.from,to).trim()))out.push(owned(state,node,{from:state.doc.lineAt(node.from).from,to},/^\s*<table\b/i.test(state.sliceDoc(node.from,to))?'table':'html'));
      excluded.push({from:node.from,to});return false;
    }
    if(['InlineCode','URL','LinkTitle'].includes(ref.name)){excluded.push(node);return false;}
    if(!cell&&ref.name==='Paragraph'&&!inlineParagraphs.has(ref.from)){
      const raw=state.sliceDoc(ref.from,ref.to);
      if(parserFor(profile).parseInline(raw,{})[0]?.children?.some(token=>token.type==='html_inline'&&!/^<br\s*\/?>$/i.test(token.content))){out.push(owned(state,node,node,'html'));excluded.push({from:node.from,to:node.to});return false;}
    }
    if(ref.name==='Link'){
      const image=node.getChild('Image');
      if(image&&state.sliceDoc(node.from,image.from)==='['&&state.sliceDoc(image.to,node.to).startsWith('](')){
        const p=node.parent,standalone=!cell&&p?.name==='Paragraph'&&!state.sliceDoc(p.from,node.from).trim()&&!state.sliceDoc(node.to,p.to).trim();
        out.push(owned(state,node,node,'image',standalone));return false;
      }
    }
    if(ref.name==='Image'){
      const p=node.parent,standalone=!cell&&p?.name==='Paragraph'&&!state.sliceDoc(p.from,node.from).trim()&&!state.sliceDoc(node.to,p.to).trim();
      out.push(owned(state,node,node,'image',standalone));return false;
    }
    if(ref.name==='HorizontalRule'){if(cell)return false;out.push(owned(state,node,node,'rule'));return false;}
  }});
  if(profile!=='gfm'){
    // The semantic parser supplies quoted/list-contained math as well as root math.
    if(!cell&&source.includes('$$'))for(const token of parserFor(profile).parse(source,{})){
      if(token.type!=='tegg_math_block'||!token.map)continue;
      const first=state.doc.line(token.map[0]+1),last=state.doc.line(Math.min(state.doc.lines,token.map[1]));
      const range={from:first.from,to:last.to};if(excluded.some(item=>item.from<=range.from&&item.to>=range.to))continue;
      const node=tree.resolve(Math.min(first.to,first.from+blockContext(state,first.to).containerPrefix.length+1),1);
      out.push(owned(state,node,range,'math'));excluded.push(range);
    }
    for(let at=0;at<source.length;at++){
      const match=inlineMathAt(source,at);if(!match)continue;at=match.to-1;
      if(excluded.some(item=>item.from<match.to&&item.to>match.from))continue;
      const node=tree.resolve(match.from,1),p=paragraphAt(state,match.from,1),standalone=!cell&&!!p&&p.from===match.from&&p.to===match.to;
      out.push(owned(state,node,match,'math',standalone));
    }

  }
  if(cell){const inline=inlineCellHtml(source);if(inline)for(const atom of inline.atoms)out.push({from:atom.from,to:atom.to,kind:atom.kind,block:false,parentFrom:0,parentTo:state.doc.length,parentName:'Document'});}
  boundaryModels.set(state.doc,{tree,profile,cell,objects:[...out]});
  }
  if(profile!=='gfm'&&!cell){
    const session=target instanceof EditorState?state.facet(resourceContext).displaySession:displaySessionFor(target);
    for(const item of cell?[]:calloutRanges(state)){
      if(session?.expanded('callout',item.from,item.to,item.fold!=='-')??item.fold!=='-')continue;
      const titleFrom=item.headerFrom+(state.sliceDoc(item.headerFrom,item.headerTo).match(/^\[![\w-]+\][+-]?[ \t]*/)?.[0].length??0);
      const node=tree.resolve(item.from,1);
      out.push({...owned(state,node,item,'callout'),titleFrom,headerTo:item.headerTo});
    }
  }
  return out.sort((a,b)=>a.from-b.from||b.to-a.to).filter((item,index,all)=>!all.slice(0,index).some(prior=>prior.from===item.from&&prior.to===item.to));
}
function titleOnly(range:SelectionRange,item:SemanticObjectBoundary){return item.kind==='callout'&&range.from>=(item.titleFrom??item.from)&&range.to<=(item.headerTo??item.to);}
function snapWith(state:EditorState,selection:EditorSelection,boundaries:readonly SemanticObjectBoundary[]):EditorSelection {
  const literal=snapLiteralSelection(state,selection);
  const ranges=literal.ranges.map(range=>{
    let from=range.from,to=range.to;
    for(const item of boundaries){
      if(titleOnly(range,item))continue;
      if(range.empty){if(from>item.from&&from<item.to){from=to=range.assoc>0?item.to:item.from;}continue;}
      if(from<item.to&&to>item.from){from=Math.min(from,item.from);to=Math.max(to,item.to);}
    }
    return range.empty?EditorSelection.cursor(from,range.assoc):range.anchor<=range.head?EditorSelection.range(from,to):EditorSelection.range(to,from);
  });
  return EditorSelection.create(ranges,selection.mainIndex);
}
/** Snap external endpoints out of nontext source and retain selection direction. */
export function snapSemanticSelectionState(state:EditorState,selection:EditorSelection,boundaries:readonly SemanticObjectBoundary[]=semanticObjectBoundaries(state)):EditorSelection {return snapWith(state,selection,boundaries);}
export function snapSemanticSelection(view:EditorView,selection:EditorSelection):EditorSelection {return snapWith(view.state,selection,semanticObjectBoundaries(view));}
type SemanticSelectionIntent={source:string;selection:EditorSelection;context:unknown};
const setSemanticSelectionIntent=StateEffect.define<SemanticSelectionIntent|null>();
const semanticSelectionIntent=StateField.define<SemanticSelectionIntent|null>({
  create:()=>null,
  update(value,tr){
    for(const effect of tr.effects)if(effect.is(setSemanticSelectionIntent))return effect.value;
    if(tr.docChanged||tr.selection&&(!value||!tr.newSelection.eq(value.selection)))return null;
    return value;
  },
});
/** Explicit main-document Select All selects container ownership, unlike A6 selecting a sole child. */
export function semanticSelectAll(view:EditorView):boolean {
  if(view.composing)return false;
  const selection=EditorSelection.single(0,view.state.doc.length);
  view.dispatch({selection,effects:setSemanticSelectionIntent.of({source:view.state.doc.toString(),selection,context:view.state.facet(resourceContext)}),scrollIntoView:true,userEvent:'select'});return true;
}
const selectedObjects=StateField.define<DecorationSet>({
  create:state=>objectSelectionDecorations(state),
  update:(_value,tr)=>objectSelectionDecorations(tr.state),
  provide:field=>EditorView.decorations.from(field),
});
function objectSelectionDecorations(state:EditorState):DecorationSet {
  const ranges=semanticObjectBoundaries(state).filter(item=>state.selection.ranges.some(range=>!range.empty&&!titleOnly(range,item)&&range.from<=item.from&&range.to>=item.to))
    .map(item=>Decoration.mark({class:'cm-live-object-selected',attributes:{'data-semantic-kind':item.kind}}).range(item.from,item.to));
  return Decoration.set(ranges,true);
}
/** Install only in the Live Edit main document, never in Source or a code/cell child. */
export const semanticSelectionExtension:Extension=[
  EditorState.transactionFilter.of(tr=>{
    if(!tr.selection||tr.docChanged||tr.isUserEvent('input.type.compose'))return tr;
    const selection=snapSemanticSelectionState(tr.state,tr.newSelection);
    return selection.eq(tr.newSelection)?tr:[tr,{selection,filter:false,annotations:Transaction.addToHistory.of(false)}];
  }),semanticSelectionIntent,invertedEffects.of(tr=>tr.docChanged?[setSemanticSelectionIntent.of(tr.startState.field(semanticSelectionIntent,false)??null)]:[]),selectedObjects,
  EditorView.atomicRanges.of(view=>Decoration.set([...semanticObjectBoundaries(view).map(item=>{
    const from=item.kind==='callout'?(item.headerTo??item.from):item.from;
    return Decoration.mark({}).range(from,item.to);
  }),...literalSemanticAtoms(view.state).map(atom=>Decoration.mark({}).range(atom.from,atom.to))].filter(range=>range.from<range.to),true)),
];
function paragraphAt(state:EditorState,at:number,bias:-1|1):SyntaxNode|null {
  for(let node:SyntaxNode|null=(parsed(state)??syntaxTree(state)).resolve(Math.max(0,Math.min(at,state.doc.length)),bias);node;node=node.parent)
    if(node.name==='Paragraph')return node;
  return null;
}
function normalParagraph(state:EditorState,node:SyntaxNode|null){return !!node&&node.name==='Paragraph'&&!calloutRanges(state).some(item=>item.headerFrom>=node.from&&item.headerFrom<node.to)&&!node.getChild('Task');}
function visibleNodeFrom(state:EditorState,node:SyntaxNode){
  let from=Math.max(node.from,blockContext(state,node.from).contentFrom);
  if(/Heading/.test(node.name)){const mark=node.getChild('HeaderMark');if(mark&&mark.from===node.from){from=mark.to;while(/[ \t]/.test(state.sliceDoc(from,from+1)))from++;}}
  const callout=calloutRanges(state).find(item=>item.headerFrom===node.from);
  if(callout)from=callout.headerFrom+(state.sliceDoc(callout.headerFrom,callout.headerTo).match(/^\[![\w-]+\][+-]?[ \t]*/)?.[0].length??0);
  return from;
}
type InlinePair={from:number;to:number;start:number;end:number};
const inlinePairModels=new WeakMap<Text,{tree:ReturnType<typeof syntaxTree>;pairs:InlinePair[]}>();
function inlinePairs(state:EditorState):InlinePair[]{
  const tree=parsed(state)??syntaxTree(state),cached=inlinePairModels.get(state.doc);if(cached?.tree===tree)return cached.pairs;
  const pairs:InlinePair[]=[...selectionFormatting(state).pairs];
  tree.iterate({enter(ref){
    if(opaqueNodes.has(ref.name))return false;
    if(ref.name==='InlineCode'){const a=ref.node.firstChild,b=ref.node.lastChild;if(a&&b&&a!==b)pairs.push({from:ref.from,to:ref.to,start:a.to,end:b.from});return false;}
    if(ref.name==='Link'&&ref.node.getChild('URL')){const a=ref.node.firstChild;let close=a?.nextSibling;while(close&&close.name!=='LinkMark')close=close.nextSibling;if(a&&close)pairs.push({from:ref.from,to:ref.to,start:a.to,end:close.from});}
  }});
  const unique=pairs.filter((pair,index)=>!pairs.slice(0,index).some(p=>p.from===pair.from&&p.to===pair.to));inlinePairModels.set(state.doc,{tree,pairs:unique});return unique;
}
/** Delete visible runs, retaining balanced wrappers around unselected content. */
function repairedPatch(state:EditorState,input:{from:number;to:number},pairs:readonly InlinePair[]):SourcePatch {
  let {from,to}=input,changed=true;
  while(changed){changed=false;for(const pair of pairs)if(pair.start>=from&&pair.end<=to&&pair.from<to&&pair.to>from){const a=Math.min(from,pair.from),b=Math.max(to,pair.to);if(a!==from||b!==to){from=a;to=b;changed=true;}}}
  const closing=pairs.filter(p=>from>p.start&&from<=p.end&&to>=p.to).sort((a,b)=>(a.to-a.from)-(b.to-b.from));
  const opening=pairs.filter(p=>from<=p.from&&to>=p.start&&to<p.end).sort((a,b)=>(b.to-b.from)-(a.to-a.from));
  // Equal surviving wrappers join naturally without an ambiguous **** seam.
  while(closing.length&&opening.length&&state.sliceDoc(closing.at(-1)!.from,closing.at(-1)!.start)===state.sliceDoc(opening[0].from,opening[0].start)&&state.sliceDoc(closing.at(-1)!.end,closing.at(-1)!.to)===state.sliceDoc(opening[0].end,opening[0].to)){closing.pop();opening.shift();}
  const insert=closing.map(p=>state.sliceDoc(p.end,p.to)).join('')+opening.map(p=>state.sliceDoc(p.from,p.start)).join('');
  return {from,to,insert,expected:state.sliceDoc(from,to)};
}
function objectPatch(state:EditorState,item:SemanticObjectBoundary):SourcePatch {
  // Removing a child keeps its quote rail, including a middle child: an
  // unquoted blank line would split the surrounding quote/Callout in two.
  const insert=item.kind!=='callout'&&item.parentName==='Blockquote'&&!!item.prefix?.includes('>')?(item.prefix??'').trimEnd():'';
  return {from:item.from,to:item.to,insert,expected:state.sliceDoc(item.from,item.to)};
}
type InlineCellHtml={pairs:InlinePair[];tags:{from:number;to:number}[];atoms:{from:number;to:number;kind:'image'|'html'}[]};
function inlineCellHtml(source:string):InlineCellHtml|null {
  const pairs:InlinePair[]=[],tags:{from:number;to:number}[]=[],atoms:InlineCellHtml['atoms']=[],stack:{name:string;from:number;start:number}[]=[];
  const allowed=new Set(['strong','b','em','i','del','s','u','mark','sub','sup','span','a','code','br','img']);
  for(const match of source.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][\w:-]*(?:[^<>"']|"[^"]*"|'[^']*')*>/gi)){
    const raw=match[0],name=/^<\/?([\w:-]+)/.exec(raw)?.[1].toLowerCase(),from=match.index!,to=from+raw.length;
    if(!name||!allowed.has(name))return null;tags.push({from,to});
    if(raw.startsWith('</')){const open=stack.pop();if(!open||open.name!==name)return null;pairs.push({from:open.from,to,start:open.start,end:from});}
    else if(name==='br'||name==='img'||raw.endsWith('/>'))atoms.push({from,to,kind:name==='img'?'image':'html'});
    else stack.push({name,from,start:to});
  }
  if(stack.length)return null;
  // A malformed tag is not silently interpreted as an editable attribute string.
  for(const match of source.matchAll(/<\/?[a-z!]/gi))if(!tags.some(tag=>tag.from<=match.index!&&tag.to>match.index!))return null;
  return {pairs,tags,atoms};
}
/** A cell owns inline text only. Never reinterpret a cell's inline HTML as a document block. */
export function planInlineSelectionDeletion(state:EditorState,selection:EditorSelection=state.selection):SemanticSelectionDeletion|null {
  if(state.readOnly||selection.ranges.length!==1||selection.main.empty)return null;
  const html=inlineCellHtml(state.doc.toString());if(!html)return null;
  const boundaries=semanticObjectBoundaries(state).filter(item=>!item.block),originalSelection=snapWith(state,selection,boundaries),range=originalSelection.main;
  if(html.tags.some(tag=>(range.from>tag.from&&range.from<tag.to)||(range.to>tag.from&&range.to<tag.to)))return null;
  const patch=repairedPatch(state,range,[...inlinePairs(state),...html.pairs]);
  let patches:SourcePatch[];try{patches=validateSourcePatches(state.doc.toString(),[patch]);}catch{return null;}
  const changes=ChangeSet.of(patches,state.doc.length);
  return {patches,selection:{anchor:changes.mapPos(range.from,-1)},originalSelection};
}
/** S17 separator deletion stays a guarded Live transaction, so the existing
 * preserveCodeStructure filter can retain code and its container in one Undo.
 * This is not permission to delete arbitrary hidden prefixes or object source. */
function codeGapPatch(state:EditorState,range:{from:number;to:number},boundaries:readonly SemanticObjectBoundary[]):SourcePatch|null {
  const raw=state.sliceDoc(range.from,range.to);
  if(!/[\r\n]/.test(raw)||!/^[ \t\r\n>]+$/.test(raw)||boundaries.some(item=>item.from<range.to&&item.to>range.from))return null;
  let adjacent=false;
  parsed(state)!.iterate({enter(ref){
    if(!['CodeBlock','FencedCode'].includes(ref.name))return;
    const block=codeSource(state,ref.node);if(!block)return false;
    const before=range.to<=block.from&&/^[ \t\r\n>]*$/.test(state.sliceDoc(range.to,block.from));
    const after=range.from>=block.to&&/^[ \t\r\n>]*$/.test(state.sliceDoc(block.to,range.from));
    if(!before&&!after)return false;
    // Any selected > must be a complete empty row of this quote, rather than
    // visible punctuation, a partial rail or another container's prefix.
    const rail=block.prefix.replace(/[ \t]/g,'');
    for(let at=range.from;at<range.to;){
      const row=state.doc.lineAt(at),end=Math.min(row.to,range.to),selected=state.sliceDoc(at,end);
      if(selected.includes('>')&&(at!==row.from||end!==row.to||!/^([ \t]*>)+[ \t]*$/.test(row.text)||row.text.replace(/[ \t]/g,'')!==rail))return false;
      at=row.to+1;
    }
    adjacent=true;return false;
  }});
  return adjacent?{from:range.from,to:range.to,insert:'',expected:raw}:null;
}
/** Source-captured A7 plan for keyboard deletion and acknowledged clipboard cut. */
export function planSemanticSelectionDeletion(state:EditorState,selection:EditorSelection=state.selection,boundaries:readonly SemanticObjectBoundary[]=semanticObjectBoundaries(state)):SemanticSelectionDeletion|null {
  if(state.facet(resourceContext).editingContext==='table-cell')return planInlineSelectionDeletion(state,selection);
  if(state.readOnly||selection.ranges.length!==1||selection.main.empty||!parsed(state))return null;
  const originalSelection=snapWith(state,selection,boundaries),range=originalSelection.main;
  const intent=state.field(semanticSelectionIntent,false),wholeContainer=!!intent&&intent.context===state.facet(resourceContext)&&intent.source===state.doc.toString()&&intent.selection.eq(selection);
  const exact=!wholeContainer&&boundaries.find(item=>item.from===range.from&&item.to===range.to);
  let patches:SourcePatch[]=[];
  if(exact)patches=[objectPatch(state,exact)];
  else {
    if(boundaries.some(item=>!titleOnly(range,item)&&item.from<range.to&&item.to>range.from&&(range.from>item.from||range.to<item.to)))return null;
    const a=paragraphAt(state,range.from,1),b=paragraphAt(state,range.to,-1),pairs=inlinePairs(state),gap=codeGapPatch(state,range,boundaries);
    if(gap)patches=[gap];
    else if(sameNode(a,b)||(normalParagraph(state,a)&&normalParagraph(state,b)&&sameNode(a!.parent,b!.parent)))patches=[repairedPatch(state,range,pairs)];
    else {
      const intervals:{from:number;to:number}[]=[];
      for(const item of boundaries)if(item.from>=range.from&&item.to<=range.to)intervals.push(item);
      parsed(state)!.iterate({enter(ref){
        if(ref.to<=range.from||ref.from>=range.to)return false;
        if(containers.has(ref.name)&&ref.from>=range.from&&ref.to<=range.to){intervals.push({from:ref.from,to:ref.to});return false;}
        if(opaqueNodes.has(ref.name))return false;
        if(ref.name==='Paragraph'||/^(?:ATX|Setext)Heading[1-6]$/.test(ref.name)||ref.name==='LinkReference'){
          const from=Math.max(range.from,visibleNodeFrom(state,ref.node)),to=Math.min(range.to,ref.to);
          if(from<to)intervals.push({from,to});return false;
        }
      }});
      intervals.sort((x,y)=>x.from-y.from||x.to-y.to);
      const merged:{from:number;to:number}[]=[];
      for(const interval of intervals){const last=merged.at(-1);if(last&&interval.from<=last.to)last.to=Math.max(last.to,interval.to);else merged.push({...interval});}
      patches=merged.map(interval=>repairedPatch(state,interval,pairs));
    }
  }
  if(!patches.length)return null;
  try{patches=validateSourcePatches(state.doc.toString(),patches);}catch{return null;}
  const changes=ChangeSet.of(patches,state.doc.length);
  return {patches,selection:{anchor:changes.mapPos(range.from,-1)},originalSelection};
}
function applyDeletion(view:EditorView,plan:SemanticSelectionDeletion){
  view.dispatch({changes:plan.patches,selection:plan.selection,effects:restoreSelection.of(EditorSelection.single(plan.selection.anchor)),annotations:isolateHistory.of('full'),scrollIntoView:true,userEvent:'delete.selection'});
}
/** Consume a refused main-document selection too, so native raw deletion cannot corrupt it. */
export function deleteSemanticSelection(view:EditorView):boolean {
  if(view.composing||view.state.readOnly||view.state.selection.ranges.length!==1||view.state.selection.main.empty)return false;
  const selection=snapSemanticSelection(view,view.state.selection);
  if(!selection.eq(view.state.selection))view.dispatch({selection});
  const plan=planSemanticSelectionDeletion(view.state,selection,semanticObjectBoundaries(view));
  if(plan)applyDeletion(view,plan);
  else view.dom.dispatchEvent(new CustomEvent('tegg-editing-error',{bubbles:true,detail:{reason:'The selection cannot be deleted without changing unselected structure.'}}));
  return true;
}
function visibleParagraphEdges(state:EditorState,node:SyntaxNode):{from:number;to:number} {
  let from=visibleNodeFrom(state,node),to=node.to,changed=true;
  const pairs=inlinePairs(state);
  while(changed){changed=false;for(const pair of pairs){if(pair.from===from&&pair.start>from){from=pair.start;changed=true;}if(pair.to===to&&pair.end<to){to=pair.end;changed=true;}}}
  return {from,to};
}
function explicitEmptyAt(state:EditorState,head:number):SyntaxNode|null {
  let result:SyntaxNode|null=null;
  parsed(state)?.iterate({enter(ref){if(ref.name!=='HTMLBlock')return;let to=ref.to;if(state.sliceDoc(to-1,to)==='\n')to--;if(head>=ref.from&&head<=to&&explicitEmpty.test(state.sliceDoc(ref.from,to).trim()))result=ref.node;return false;}});
  return result;
}
function ordinaryParagraphs(state:EditorState,parent:{from:number;to:number}):SyntaxNode[] {
  const objects=semanticObjectBoundaries(state),out:SyntaxNode[]=[];
  parsed(state)?.iterate({enter(ref){if(ref.name!=='Paragraph'||!normalParagraph(state,ref.node))return;const ownedParent=parentOf(ref.node.parent);if(ownedParent?.from===parent.from&&ownedParent.to===parent.to&&!objects.some(item=>item.block&&item.from<=ref.from&&item.to>=ref.to))out.push(ref.node);}});
  return out;
}
type SelectionOrigin={source:string;context:unknown;origin:EditorSelection;selection:EditorSelection;object:SemanticObjectBoundary};
const origins=new WeakMap<EditorView,SelectionOrigin>();
function gapAllowed(state:EditorState,from:number,to:number){return /^[ \t\r\n>]*$/.test(state.sliceDoc(from,to));}
/** A6: outside a nontext block first selects, without changing its surrounding paragraphs. */
export function selectSemanticBoundary(view:EditorView,backwards:boolean):boolean {
  const {state}=view;if(state.readOnly||view.composing||state.selection.ranges.length!==1||!state.selection.main.empty)return false;
  const head=state.selection.main.head,empty=explicitEmptyAt(state,head),paragraph=paragraphAt(state,head,backwards?1:-1);
  const edges=paragraph?visibleParagraphEdges(state,paragraph):null;
  const logicalHead=empty?(backwards?empty.from:empty.to):(edges&&head===(backwards?edges.from:edges.to)?backwards?paragraph!.from:paragraph!.to:head);
  const objects=semanticObjectBoundaries(view).filter(item=>item.block&&item.kind!=='callout'&&item.kind!=='rule');
  const object=objects.filter(item=>backwards?item.to<=logicalHead&&gapAllowed(state,item.to,logicalHead):item.from>=logicalHead&&gapAllowed(state,logicalHead,item.from)).sort((a,b)=>backwards?b.to-a.to:a.from-b.from)[0];
  if(!object)return false;
  // Do not reach across a container exit or enter a different list item.
  const parent=parentOf((paragraph??empty)?.parent??null);
  if(parent&&(parent.from!==object.parentFrom||parent.to!==object.parentTo))return false;
  if(empty){
    // An explicitly saved blank paragraph is text structure, not an empty object.
    // Remove this paragraph first and land in an existing ordinary paragraph.
    let to=empty.to;if(state.sliceDoc(to-1,to)==='\n')to--;
    const paragraphs=ordinaryParagraphs(state,{from:object.parentFrom,to:object.parentTo});
    const next=paragraphs.filter(p=>backwards?p.from>=to:p.to<=empty.from).sort((a,b)=>backwards?a.from-b.from:b.to-a.to)[0];
    const changes=ChangeSet.of({from:empty.from,to,insert:''},state.doc.length),at=changes.mapPos(next?(backwards?visibleParagraphEdges(state,next).from:visibleParagraphEdges(state,next).to):empty.from,-1);
    view.dispatch({changes,selection:{anchor:at},effects:restoreSelection.of(EditorSelection.single(at)),annotations:isolateHistory.of('full'),scrollIntoView:true,userEvent:'delete'});return true;
  }
  const selection=EditorSelection.single(object.from,object.to);
  origins.set(view,{source:state.doc.toString(),context:state.facet(resourceContext),origin:state.selection,selection,object});
  view.dispatch({selection,effects:setSemanticSelectionIntent.of(null),scrollIntoView:true,userEvent:'select'});return true;
}
/** Escape returns to the triggering caret. Arrows leave to the same parent without writing empty paragraphs. */
export function leaveSemanticObjectSelection(view:EditorView,direction:-1|0|1):boolean {
  if(view.composing||view.state.selection.ranges.length!==1||view.state.selection.main.empty)return false;
  const origin=origins.get(view),valid=!!origin&&origin.source===view.state.doc.toString()&&origin.context===view.state.facet(resourceContext)&&origin.selection.eq(view.state.selection);
  if(direction===0){if(!valid)return false;view.dispatch({selection:origin!.origin,scrollIntoView:true,userEvent:'select'});origins.delete(view);return true;}
  const object=valid?origin!.object:semanticObjectBoundaries(view).find(item=>item.from===view.state.selection.main.from&&item.to===view.state.selection.main.to);if(!object)return false;
  const edge=direction<0?object.from:object.to;let at=edge;
  if(object.block){const tree=parsed(view.state),paragraphs:SyntaxNode[]=[];tree?.iterate({enter(ref){if(ref.name==='Paragraph'&&normalParagraph(view.state,ref.node)){const parent=parentOf(ref.node.parent);if(parent&&parent.from===object.parentFrom&&parent.to===object.parentTo)paragraphs.push(ref.node);}}});
    const p=paragraphs.filter(p=>direction<0?p.to<=edge:p.from>=edge).sort((a,b)=>direction<0?b.to-a.to:a.from-b.from)[0];if(p&&gapAllowed(view.state,Math.min(edge,direction<0?p.to:p.from),Math.max(edge,direction<0?p.to:p.from)))at=direction<0?p.to:p.from;
  }
  view.dispatch({selection:EditorSelection.cursor(at,direction),scrollIntoView:true,userEvent:'select'});origins.delete(view);return true;
}
/** C8-6: only adjacent ordinary paragraphs in one parsed parent may merge. */
export function mergeSemanticParagraphBoundary(view:EditorView,backwards:boolean):boolean {
  const {state}=view;if(state.readOnly||view.composing||state.selection.ranges.length!==1||!state.selection.main.empty)return false;
  const head=state.selection.main.head,p=paragraphAt(state,head,backwards?1:-1);
  if(!p){
    // A heading endpoint may never fall through to a raw newline deletion.
    let node:SyntaxNode|null=(parsed(state)??syntaxTree(state)).resolve(head,backwards?1:-1);
    for(;node;node=node.parent)if(/^(?:ATX|Setext)Heading[1-6]$/.test(node.name)){const edge=visibleParagraphEdges(state,node);return head===(backwards?edge.from:edge.to);}
    return false;
  }
  const edges=visibleParagraphEdges(state,p);
  if(head!==(backwards?edges.from:edges.to)&&head!==(backwards?p.from:p.to)||!normalParagraph(state,p))return false;
  // The established quote outdent, Callout title and list退层 handlers win.
  if(backwards&&parentOf(p.parent)?.name!=='Document')return false;
  const sibling=backwards?p.prevSibling:p.nextSibling;
  if(!sibling)return false;
  const objects=semanticObjectBoundaries(view);
  if(!normalParagraph(state,sibling)||!sameNode(p.parent,sibling.parent)||objects.some(item=>item.block&&((item.from<=p.from&&item.to>=p.to)||(item.from<=sibling.from&&item.to>=sibling.to))))return true;
  const from=backwards?sibling.to:p.to,to=backwards?p.from:sibling.from;
  if(!gapAllowed(state,from,to))return true;
  view.dispatch({changes:{from,to,insert:''},selection:{anchor:from},effects:restoreSelection.of(EditorSelection.single(from)),annotations:isolateHistory.of('full'),scrollIntoView:true,userEvent:'delete'});return true;
}

/** Map system word boundaries over visible characters, keeping original source ownership. */
function visibleWordTarget(state:EditorState,head:number,forward:boolean):number|null {
  let paragraph=paragraphAt(state,head,forward?-1:1)??paragraphAt(state,head,forward?1:-1);
  if(!paragraph)for(let node:SyntaxNode|null=(parsed(state)??syntaxTree(state)).resolve(head,head===0?1:-1);node;node=node.parent)if(/^(?:ATX|Setext)Heading[1-6]$/.test(node.name)){paragraph=node;break;}
  if(!paragraph)return null;
  const pairs=inlinePairs(state),formatting=selectionFormatting(state),atoms=literalSemanticAtoms(state),objects=semanticObjectBoundaries(state).filter(item=>!item.block),source=state.doc.toString();
  const units:{from:number;to:number;start:number;end:number}[]=[];let text='';
  const append=(from:number,to:number,value:string)=>{const start=text.length;text+=value;units.push({from,to,start,end:text.length});};
  const edge=visibleNodeFrom(state,paragraph);
  for(let at=edge;at<paragraph.to;){
    const object=objects.find(item=>item.from===at);if(object){append(at,object.to,'\uFFFC');at=object.to;continue;}
    const hidden=pairs.find(pair=>at>=pair.from&&at<pair.start||at>=pair.end&&at<pair.to);
    if(hidden){at=at<hidden.start?hidden.start:hidden.to;continue;}
    const br=/^<br\s*\/?>/i.exec(source.slice(at));if(br){append(at,at+br[0].length,'\n');at+=br[0].length;continue;}
    if(formatting.structuralBits[at]){at++;continue;}
    const atom=atoms.find(item=>item.from===at);if(atom){const raw=source.slice(atom.from,atom.to);let visible=raw;
      if(raw.startsWith('&'))visible=decodeEntity(raw);else if(raw.startsWith('\\'))visible=raw.slice(1);else if(/^\[\^/.test(raw))visible='\uFFFC';else if(/^:[^:]+:$/.test(raw))visible=parserFor(state.facet(resourceContext).profile??'tegg').parseInline(raw,{})[0]?.children?.find(token=>token.type==='emoji')?.content??raw;
      append(atom.from,atom.to,visible);at=atom.to;continue;}
    append(at,at+1,source[at]);at++;
  }
  if(!units.length)return null;let offset=0;
  for(const unit of units){if(head>=unit.to)offset=unit.end;else if(head>unit.from){offset=forward?unit.end:unit.start;break;}else break;}
  const segments=Array.from(new Intl.Segmenter(undefined,{granularity:'word'}).segment(text));
  const meaningful=(segment:typeof segments[number])=>segment.isWordLike||segment.segment.includes('\uFFFC')||/\p{Extended_Pictographic}/u.test(segment.segment);
  const next=forward?segments.find(item=>item.index+item.segment.length>offset&&meaningful(item)):segments.filter(item=>item.index<offset&&meaningful(item)).at(-1);
  const target=next?(forward?next.index+next.segment.length:next.index):(forward?text.length:0);
  if(target===0)return units[0].from;if(target===text.length)return units.at(-1)!.to;
  const unit=units.find(item=>target>=item.start&&target<=item.end);if(!unit)return null;
  return target===unit.start?unit.from:target===unit.end?unit.to:forward?unit.to:unit.from;
}
/** Host keymap: Alt-arrow on macOS, Ctrl-arrow on other desktop systems. */
export function moveSemanticWord(view:EditorView,forward:boolean,extend=false):boolean {
  if(view.composing||view.state.selection.ranges.length!==1)return false;
  if(!extend&&leaveSemanticObjectSelection(view,forward?1:-1))return true;
  const range=view.state.selection.main,target=visibleWordTarget(view.state,range.head,forward);if(target===null||target===range.head)return false;
  const selection=snapSemanticSelection(view,extend?EditorSelection.single(range.anchor,target):EditorSelection.single(target));
  view.dispatch({selection,scrollIntoView:true,userEvent:'select'});return true;
}
/** A native word deletion uses the same structural repair as acknowledged Cut. */
export function deleteSemanticWord(view:EditorView,backwards:boolean):boolean {
  if(view.composing||view.state.readOnly||view.state.selection.ranges.length!==1)return false;
  if(!view.state.selection.main.empty)return deleteSemanticSelection(view);
  const head=view.state.selection.main.head,target=visibleWordTarget(view.state,head,!backwards);
  if(target===null||target===head)return selectSemanticBoundary(view,backwards)||mergeSemanticParagraphBoundary(view,backwards);
  const selection=EditorSelection.single(head,target),plan=planSemanticSelectionDeletion(view.state,selection,semanticObjectBoundaries(view));
  if(plan)applyDeletion(view,plan);else view.dom.dispatchEvent(new CustomEvent('tegg-editing-error',{bubbles:true,detail:{reason:'This word cannot be deleted without changing unselected structure.'}}));
  return true;
}
