import {parser, GFM} from '@lezer/markdown';
import type {SyntaxNode} from '@lezer/common';
import {parserFor} from './markdownParser';
import type {MarkdownProfile} from './syntaxProfiles';
import {findFrontmatter,findWikiLinks} from './profile';
import {inlineMathAt} from './mathSyntax';
import {readLinkDraft} from './objectDraft';
import {markdownDestination, markdownLabel, markdownTitle} from './htmlToMarkdown';
import type {SourcePatch} from './sourcePatch';
import type {EditorView} from '@codemirror/view';

export type ReferenceDefinition = {
  from:number; to:number; raw:string; key:string; label:string; target:string; title?:string;
  destination:{from:number;to:number}; titleRange?:{from:number;to:number};
};
export type ReferenceOccurrence = {
  from:number; to:number; raw:string; key:string; identifier:string; labelSource:string; label:string;
  kind:'link'|'image'; syntax:'full'|'collapsed'|'shortcut';
};
export type ReferenceLinkIndex = {definitions:ReferenceDefinition[]; occurrences:ReferenceOccurrence[];resolved:Record<string,{href:string;title:string}>};
export type ReferenceLinkContext = {
  source:()=>string;
  /** Absolute definition patches and this child's local label patches are one logical edit. The parent owns commit/cancel. */
  applyShared:(patches:readonly SourcePatch[],localPatches?:readonly SourcePatch[])=>boolean;
};
const contexts=new WeakMap<EditorView,ReferenceLinkContext>();
export function registerReferenceLinkContext(view:EditorView,context:ReferenceLinkContext):()=>void {contexts.set(view,context);return ()=>{if(contexts.get(view)===context)contexts.delete(view);};}
export function referenceLinkContext(view:EditorView):ReferenceLinkContext|undefined {return contexts.get(view);}
export function referenceDocumentSource(view:EditorView):string {return contexts.get(view)?.source()??view.state.doc.toString();}
const referenceParser=parser.configure(GFM);
const directChildren=(node:SyntaxNode)=>{const result:SyntaxNode[]=[];for(let child=node.firstChild;child;child=child.nextSibling)result.push(child);return result;};
/** CommonMark reference matching folds whitespace and Unicode case, not destination URLs. */
export function referenceKey(value:string):string {return parserFor('gfm').utils.normalizeReference(value);}

/** All ranges refer to the original source. Code, HTML blocks, Wiki syntax and footnotes are not references. */
export function buildReferenceLinkIndex(source:string,profile:MarkdownProfile='tegg',definitionSource=source):ReferenceLinkIndex {
  const tree=referenceParser.parse(source), md=parserFor(profile), definitions:ReferenceDefinition[]=[],occurrences:ReferenceOccurrence[]=[];
  const frontmatter=profile==='tegg'?findFrontmatter(source):{to:0};
  const excluded:{from:number;to:number}[]=[];
  if(frontmatter.to)excluded.push({from:0,to:frontmatter.to});
  if(profile==='tegg')excluded.push(...findWikiLinks(source));
  tree.iterate({enter(node){if(frontmatter.to&&node.to<=frontmatter.to)return false;
    if(['FencedCode','CodeBlock','InlineCode','HTMLBlock','HTMLTag'].includes(node.name)){excluded.push({from:node.from,to:node.to});return false;}
    if(node.name==='LinkReference'){
      const children=directChildren(node.node),label=children.find(child=>child.name==='LinkLabel'),url=children.find(child=>child.name==='URL'),title=children.find(child=>child.name==='LinkTitle');
      if(!label||!url)return false;
      const identifier=source.slice(label.from+1,label.to-1);if(identifier.startsWith('^')){excluded.push({from:node.from,to:label.to+1});return false;}
      excluded.push({from:node.from,to:node.to});
      const to=node.to-(source[node.to-1]==='\r'?1:0),raw=source.slice(node.from,to),parsed=readLinkDraft('[reference]('+source.slice(url.from,url.to)+(title?' '+source.slice(title.from,title.to):'')+')');
      if(parsed)definitions.push({from:node.from,to,raw,key:referenceKey(identifier),label:identifier,target:parsed.url,...(parsed.title!==undefined?{title:parsed.title}:{}),destination:{from:url.from,to:url.to},...(title?{titleRange:{from:title.from,to:title.to}}:{})});
      return false;
    }
    if(node.name==='Link'||node.name==='Image'){
      if(directChildren(node.node).some(child=>child.name==='URL')){excluded.push({from:node.from,to:node.to});return false;}
    }
  }});
  const env:{references?:Record<string,{href:string;title:string}>}={};md.parse(definitionSource,env);const active=env.references??{};
  const first=new Set<string>();for(const definition of definitions){if(first.has(definition.key))continue;first.add(definition.key);const resolved=active[definition.key];if(!resolved)continue;definition.target=resolved.href;definition.title=definition.titleRange?resolved.title:resolved.title||undefined;}
  if(profile!=='gfm'){
    const lineOffsets=[0];for(let i=0;i<source.length;i++)if(source[i]==='\n')lineOffsets.push(i+1);lineOffsets.push(source.length);
    for(const token of md.parse(source,{}))if(token.type==='tegg_math_block'&&token.map)excluded.push({from:lineOffsets[token.map[0]],to:lineOffsets[token.map[1]]});
    for(let i=0;i<source.length;i++){if(excluded.some(range=>i>=range.from&&i<range.to))continue;const math=inlineMathAt(source,i);if(math){excluded.push(math);i=math.to-1;}}
  }
  if(profile==='tegg')for(const match of source.matchAll(/^[ \t]*(?:>[ \t]*)+\[![A-Za-z][A-Za-z0-9_-]*\][+-]?(?=[ \t]|$)/gm))excluded.push({from:match.index!,to:match.index!+match[0].length});
  const outside=(position:number)=>!excluded.some(range=>position>=range.from&&position<range.to);
  const escaped=(position:number)=>{let slashes=0;while(source[--position]==='\\')slashes++;return slashes%2===1;};
  // Lezer does not keep nested bracket labels as one Link. Read balanced source
  // candidates, then validate their identity using the document's Markdown parser.
  const closeLabel=(start:number)=>{let depth=1;for(let pos=start;pos<source.length;pos++){
    if(source[pos]==='\\'){pos++;continue;}
    if(source[pos]==='`'){let end=pos;while(source[end]==='`')end++;const run=source.slice(pos,end);let close=end;
      while((close=source.indexOf(run,close))>=0){if(source[close-1]!=='`'&&source[close+run.length]!=='`'){pos=close+run.length-1;break;}close+=run.length;}if(close>=0)continue;
    }
    if(source[pos]==='[')depth++;else if(source[pos]===']'&&--depth===0)return pos;
    if(source[pos]==='\n'&&/^\r?\n[ \t]*\r?\n/.test(source.slice(pos)))return -1;
  }return -1;};
  for(let position=0;position<source.length;position++){
    if(source[position]!=='['||escaped(position)||!outside(position))continue;
    const from=position>0&&source[position-1]==='!'&&!escaped(position-1)?position-1:position,close=closeLabel(position+1);if(close<0)continue;
    const labelSource=source.slice(position+1,close);if(labelSource.startsWith('^')||source[close+1]==='(')continue;
    let to=close+1,explicit:string|null=null;
    if(source[to]==='['){const end=closeLabel(to+1);if(end<0)continue;explicit=source.slice(to+1,end);if(/[\[\]]/.test(explicit))continue;to=end+1;}
    const identifier=explicit||labelSource,key=referenceKey(identifier);if(!key||identifier.startsWith('^')||(explicit===null&&!active[key]))continue;
    const raw=source.slice(from,to),probe=active[key]?env:{references:{...active,[key]:{href:'https://reference.invalid/',title:''}}},tokens=md.parseInline(raw,probe)[0]?.children??[];
    const image=from<position,valid=image?tokens.length===1&&tokens[0].type==='image':tokens[0]?.type==='link_open'&&tokens.at(-1)?.type==='link_close';if(!valid)continue;
    const parsed=readLinkDraft('['+labelSource+']()');
    occurrences.push({from,to,raw,key,identifier,labelSource,label:parsed?.label??labelSource,kind:image?'image':'link',syntax:explicit===null?'shortcut':explicit?'full':'collapsed'});position=to-1;
  }

  return {definitions,occurrences:occurrences.filter(item=>item.syntax!=='shortcut'||active[item.key]!==undefined),resolved:active};
}
export function referenceAt(index:ReferenceLinkIndex,position:number):ReferenceOccurrence|null {return index.occurrences.find(item=>position>=item.from&&position<=item.to)??null;}
export function referenceDefinitions(index:ReferenceLinkIndex,key:string):ReferenceDefinition[]{return index.definitions.filter(item=>item.key===key);}
export function referenceOccurrences(index:ReferenceLinkIndex,key:string):ReferenceOccurrence[]{return index.occurrences.filter(item=>item.key===key);}
/** A label edit remains a reference. Collapsed and shortcut syntax become full references to the existing key. */
export function referenceLabelReplacement(occurrence:ReferenceOccurrence,label:string):string {
  if(label===occurrence.label)return occurrence.raw;
  if(/[\r\n]/.test(label))throw new Error('Display text must be on one line.');
  const suffix=occurrence.syntax==='full'?occurrence.raw.slice(occurrence.raw.length-(occurrence.identifier.length+2)):'['+occurrence.identifier+']';
  return (occurrence.kind==='image'?'!':'')+'['+markdownLabel(label)+']'+suffix;
}
export function validateLinkDestination(target:string):void {
  if(!target.trim()||/[\r\n<>]/.test(target)||/^(?:javascript|data|vbscript):/i.test(target.trim()))throw new Error('Enter a supported link destination.');
}
/** One patch changes the definition alone, preserving its label, indentation, separators and untouched title bytes. */
export function referenceDefinitionPatch(definition:ReferenceDefinition,target:string,title?:string):SourcePatch {
  validateLinkDestination(target);
  const edits:{from:number;to:number;insert:string}[]=[];
  if(target!==definition.target)edits.push({...definition.destination,insert:markdownDestination(target)});
  if(title!==definition.title){
    if(definition.titleRange)edits.push({...definition.titleRange,insert:title===undefined?'':markdownTitle(title)});
    else if(title!==undefined)edits.push({from:definition.destination.to,to:definition.destination.to,insert:' '+markdownTitle(title)});
  }
  let insert=definition.raw;for(const edit of edits.sort((a,b)=>b.from-a.from))insert=insert.slice(0,edit.from-definition.from)+edit.insert+insert.slice(edit.to-definition.from);
  return {from:definition.from,to:definition.to,expected:definition.raw,insert};
}
/** Creation is used only after the user has entered the explicit shared scope and seen every affected occurrence. */
export function createReferenceDefinitionPatch(source:string,identifier:string,target:string,title?:string):SourcePatch {
  validateLinkDestination(target);
  if(!identifier||/[\[\]\r\n]/.test(identifier))throw new Error('This reference label cannot be created safely here.');
  const eol=source.includes('\r\n')?'\r\n':'\n';
  const separator=source.endsWith(eol+eol)?'':source.endsWith(eol)?eol:eol+eol;
  return {from:source.length,to:source.length,expected:'',insert:separator+'['+identifier+']: '+markdownDestination(target)+(title!==undefined?' '+markdownTitle(title):'')};
}

/** Change only authored inline fields, retaining untouched delimiters, escapes, URL spelling and title bytes. */
export function inlineLinkReplacement(raw:string,label:string,target:string,title?:string):string {
  const previous=readLinkDraft(raw);if(!previous)throw new Error('This link cannot be edited safely here.');
  if(previous.label===label&&previous.url===target&&previous.title===title)return raw;
  const node=referenceParser.parse(raw).topNode.firstChild?.firstChild;
  if(node?.name!=='Link')throw new Error('This link cannot be edited safely here.');
  const children=directChildren(node),labelEnd=children.find(child=>child.name==='LinkMark'&&raw[child.from]===']'),url=children.find(child=>child.name==='URL'),titleNode=children.find(child=>child.name==='LinkTitle'),opening=children.find(child=>child.name==='LinkMark'&&raw[child.from]==='(');
  if(!labelEnd||!opening)throw new Error('This link cannot be edited safely here.');
  const edits:{from:number;to:number;insert:string}[]=[];
  if(label!==previous.label)edits.push({from:1,to:labelEnd.from,insert:markdownLabel(label)});
  if(target!==previous.url)edits.push({from:url?.from??opening.to,to:url?.to??opening.to,insert:markdownDestination(target)});
  if(title!==previous.title){
    if(titleNode)edits.push({from:titleNode.from,to:titleNode.to,insert:title===undefined?'':markdownTitle(title)});
    else if(title!==undefined)edits.push({from:url?.to??opening.to,to:url?.to??opening.to,insert:' '+markdownTitle(title)});
  }
  let result=raw;for(const edit of edits.sort((a,b)=>b.from-a.from))result=result.slice(0,edit.from)+edit.insert+result.slice(edit.to);return result;
}
