import {parser as markdownTree,GFM} from '@lezer/markdown';
import type {SyntaxNode} from '@lezer/common';
import type MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import {createMarkdownParser} from './markdownParser';
import {buildReferenceLinkIndex} from './referenceLinkEditing';
import {findFrontmatter} from './profile';
import {parseCalloutHeader} from './callouts';
import {inlineMathAt} from './mathSyntax';
import {footnoteDocument,footnoteBodyPosition} from './footnoteModel';
import {htmlSourceNodes,type HtmlSourceNode} from './htmlTableEditing';
import {safeHtmlOptions} from './renderKit';
import type {ContentDisplaySession} from './contentDisplaySession';
import type {MarkdownProfile} from './syntaxProfiles';

export type InspectionRange={from:number;to:number};
export type InspectionKind='comment'|'shared-definition'|'anchor'|'unapplied-declaration';
export type InspectionFold=InspectionRange&{kind:'callout'|'html-details';initial:boolean;sessionFrom:number;sessionTo:number;readerSessionFrom:number;readerSessionTo:number};
export type InspectionEntry={id:string;kind:InspectionKind;sourceRange:InspectionRange;raw:string;label:string;ownerRange:InspectionRange;foldPath:readonly InspectionFold[];referenceCount?:number;definitionKind?:'reference'|'footnote';reason?:string};
export type DocumentInspection={source:string;profile:MarkdownProfile;entries:readonly InspectionEntry[];folds:readonly InspectionFold[]};
export type InspectionLocation={ownerRange:InspectionRange;foldsToExpand:readonly (InspectionFold&{keyFrom:number;keyTo:number})[]};
type Pending=Omit<InspectionEntry,'id'|'foldPath'>;
const treeParser=markdownTree.configure(GFM);
const literalNodes=new Set(['FencedCode','CodeBlock','InlineCode','URL','LinkTitle']);
function sameRange(a:InspectionRange,b:InspectionRange){return a.from===b.from&&a.to===b.to;}
function encloses(a:InspectionRange,b:InspectionRange){return a.from<=b.from&&a.to>=b.to;}
function lineMapping(source:string){let normalized='',positions=[0];for(let at=0;at<source.length;){let value=source[at++];if(value==='\r'){if(source[at]==='\n')at++;value='\n';}normalized+=value;positions.push(at);}const lines=[0];for(let at=0;at<normalized.length;at++)if(normalized[at]==='\n')lines.push(at+1);return {normalized,positions,lines};}
function endWithoutNewline(source:string,from:number,to:number){while(to>from&&/[\r\n]/.test(source[to-1]))to--;return to;}
function flatten(nodes:readonly HtmlSourceNode[]):HtmlSourceNode[]{return nodes.flatMap(node=>[node,...flatten(node.children)]);}
function parentOwner(node:SyntaxNode):InspectionRange {let owner=node;for(let item=node.parent;item;item=item.parent){if(['Paragraph','HTMLBlock','Table'].includes(item.name)||/^(?:ATX|Setext)Heading/.test(item.name)){owner=item;break;}}return {from:owner.from,to:owner.to};}
const removedProjectionAttributes=new Set(['srcset','ping','data-tegg-slot','data-tegg-resource-src','data-tegg-resource-poster','data-tegg-ui-text','data-tegg-ui-label']);
const tableContextNames=new Set(['caption','colgroup','col','thead','tbody','tfoot','tr','td','th']);
/** Probe the same table ancestry the browser actually parses, without copying
 * author attributes, text or resource URLs into the sanitizer. An orphan cell
 * must not borrow context from another table elsewhere in the document. */
function appliedElementProbe(node:HtmlSourceNode):string {
  const names=[node.name];
  if(tableContextNames.has(node.name)){
    for(let parent=node.parent;parent;parent=parent.parent){names.unshift(parent.name);if(parent.name==='table')break;}
    if(names[0]!=='table')names.splice(0,names.length-1);
  }
  return names.reduceRight((contents,name)=>'<'+name+'>'+contents+(name==='col'?'':'</'+name+'>'),'');
}
function decodeHtmlAttribute(value:string,parser:MarkdownIt){return value.replace(/&(?:#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]+);/g,entity=>parser.utils.unescapeAll(entity));}
/** Lexical declaration fallback is scoped to parser-owned HTML. It does not
 * invent a DOM tree for incomplete/implicitly closed HTML; raw-text element
 * contents are skipped and incomplete owners remain the containing boundary. */
function scanHtmlDeclarations(source:string):HtmlSourceNode[]{
  const nodes:HtmlSourceNode[]=[],stack:HtmlSourceNode[]=[];const token=/<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][\w:-]*(?:[^<>"']|"[^"]*"|'[^']*')*>/g;
  for(let match=token.exec(source);match;match=token.exec(source)){
    const tag=match[0];if(tag.startsWith('<!'))continue;const name=/^<\/?([\w:-]+)/.exec(tag)![1].toLowerCase();
    if(tag.startsWith('</')){const index=stack.map(node=>node.name).lastIndexOf(name);if(index>=0){const node=stack[index];node.closeFrom=match.index;node.to=match.index+tag.length;stack.splice(index);}continue;}
    const attributes:Record<string,string>={};for(const attribute of tag.replace(/^<[\w:-]+/,'').replace(/\/?\s*>$/,'').matchAll(/([^\s=<>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>]+)))?/g))attributes[attribute[1].toLowerCase()]=attribute[2]??attribute[3]??attribute[4]??'';
    const node:HtmlSourceNode={name,from:match.index,openTo:match.index+tag.length,closeFrom:match.index+tag.length,to:match.index+tag.length,attributes,children:[],parent:stack.at(-1)};nodes.push(node);
    if(['pre','code','script','style','textarea'].includes(name)){const end=new RegExp('</'+name+'\\s*>','ig');end.lastIndex=node.openTo;const close=end.exec(source);node.closeFrom=close?.index??source.length;node.to=close?close.index+close[0].length:source.length;token.lastIndex=node.to;}
    else if(!tag.endsWith('/>')&&!new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']).has(name))stack.push(node);
  }return nodes;
}
/** Optional inspection model: parser-owned source ranges; no editing or resource access. */
export function inspectDocument(source:string,profile:MarkdownProfile='tegg'):DocumentInspection {
  const mapping=lineMapping(source),normalizedAt=(position:number)=>{let low=0,high=mapping.positions.length-1;while(low<high){const middle=(low+high)>>1;if(mapping.positions[middle]<position)low=middle+1;else high=middle;}return low;},frontmatter=profile==='tegg'?findFrontmatter(source).to:0;
  // Maintain source line/offset identity while excluding metadata from Markdown syntax.
  const parseSource=source.slice(0,frontmatter).replace(/[^\r\n]/g,' ')+source.slice(frontmatter),normalizedParseSource=mapping.normalized.slice(0,normalizedAt(frontmatter)).replace(/[^\n]/g,' ')+mapping.normalized.slice(normalizedAt(frontmatter)),tree=treeParser.parse(normalizedParseSource),parser=createMarkdownParser(profile),originalRange=(range:InspectionRange):InspectionRange=>({from:mapping.positions[range.from],to:mapping.positions[range.to]});
  const pending:Pending[]=[],folds:InspectionFold[]=[],excluded:InspectionRange[]=frontmatter?[{from:0,to:frontmatter}]:[],blocks:InspectionRange[]=[],html:InspectionRange[]=[];
  const add=(kind:InspectionKind,range:InspectionRange,label:string,owner:InspectionRange,extra:Partial<Pending>={})=>{if(range.from<0||range.to>source.length||range.from>=range.to)return;pending.push({kind,sourceRange:range,raw:source.slice(range.from,range.to),label,ownerRange:{from:owner.from,to:endWithoutNewline(source,owner.from,owner.to)},...extra});};
  const noteDefinitions:{label:string;range:InspectionRange}[]=[];
  if(profile!=='gfm'){
    type BlockRule=Parameters<MarkdownIt['block']['ruler']['before']>[2];let original!:BlockRule;
    const capture:BlockRule=(state,start,end,silent)=>{const count=state.tokens.length,accepted=original(state,start,end,silent);if(!accepted||silent)return accepted;const label=state.tokens.slice(count).find(token=>token.type==='footnote_reference_open')?.meta?.label;if(typeof label!=='string')return accepted;const from=mapping.positions[mapping.lines[start]],to=endWithoutNewline(source,from,mapping.positions[mapping.lines[state.line]??mapping.normalized.length]);if(from>=frontmatter)noteDefinitions.push({label,range:{from,to}});return accepted;};
    parser.block.ruler.before('footnote_def','inspection_footnote_definition',capture);const rules=parser.block.ruler.getRules('');original=rules[rules.indexOf(capture)+1];
  }
  const environment:{profile:MarkdownProfile;footnotes?:{list?:{label?:string;count?:number}[]}}={profile};const tokens=parser.parse(parseSource,environment);
  // Inspect only accepted definitions that also own the actual Reader/Live
  // footnote-body projection. Its header/continuation rails are source, not
  // part of the child editor's HTML/Markdown parsing context.
  const projectedNotes=footnoteDocument(mapping.normalized).definitions.filter(note=>noteDefinitions.some(definition=>definition.label===note.label&&normalizedAt(definition.range.from)===note.from&&normalizedAt(definition.range.to)>=note.to));
  const projectedRanges=projectedNotes.map(note=>originalRange(note));
  const inProjectedNote=(range:InspectionRange)=>projectedRanges.some(note=>encloses(note,range));
  for(const token of tokens)if(token.type==='tegg_math_block'&&token.map){const from=mapping.positions[mapping.lines[token.map[0]]],to=mapping.positions[mapping.lines[token.map[1]]??mapping.normalized.length];excluded.push({from,to});}
  tree.iterate({enter(ref){const range=originalRange(ref);if(range.to<=frontmatter||inProjectedNote(range))return false;if(literalNodes.has(ref.name)){excluded.push(range);return false;}if(ref.name==='HTMLBlock'){html.push(range);return false;}if(ref.name==='Paragraph'||ref.name==='Table'||/^(?:ATX|Setext)Heading/.test(ref.name))blocks.push({...range,to:endWithoutNewline(source,range.from,range.to)});}});
  for(const block of blocks){const children=parser.parseInline(source.slice(block.from,block.to),{}).flatMap(token=>token.children??[]);if(children.some(token=>token.type==='html_inline'))html.push(block);}
  for(const range of html){const raw=source.slice(range.from,range.to);let nodes:HtmlSourceNode[];try{nodes=flatten(htmlSourceNodes(raw));}catch{nodes=scanHtmlDeclarations(raw);}for(const node of nodes)if(['pre','code','script','style','textarea'].includes(node.name))excluded.push({from:range.from+node.openTo,to:range.from+node.closeFrom});}
  if(profile!=='gfm')for(let at=frontmatter;at<source.length;at++){if(excluded.some(range=>at>=range.from&&at<range.to)||html.some(range=>at>=range.from&&at<range.to))continue;const math=inlineMathAt(source,at);if(math){excluded.push(math);at=math.to-1;}}
  const allowed=(range:InspectionRange)=>!excluded.some(item=>encloses(item,range));
  tree.iterate({enter(ref){const range=originalRange(ref);if(range.to<=frontmatter||inProjectedNote(range)||literalNodes.has(ref.name)||ref.name==='HTMLBlock')return false;if((ref.name==='Comment'||ref.name==='CommentBlock')&&allowed(range))add('comment',{...range,to:endWithoutNewline(source,range.from,range.to)},decodeHtmlAttribute(source.slice(range.from,endWithoutNewline(source,range.from,range.to)).replace(/^<!--|-->$/g,'').trim(),parser),originalRange(parentOwner(ref.node)));if(ref.name==='Blockquote'&&profile!=='gfm'){
    let first=ref.node.firstChild;while(first&&first.name!=='Paragraph')first=first.nextSibling;if(!first)return;
    const firstRange=originalRange(first),headerTo=source.indexOf('\n',firstRange.from)<0?firstRange.to:source.indexOf('\n',firstRange.from),header=parseCalloutHeader(source.slice(firstRange.from,headerTo).replace(/\r$/,''));
    if(!header||profile==='github'&&(!/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/.test(source.slice(firstRange.from,headerTo).trim())||ref.node.parent?.name!=='Document'))return;
    const row=mapping.normalized.lastIndexOf('\n',Math.max(0,ref.from-1))+1;
    folds.push({kind:'callout',...range,initial:header.fold!=='-',sessionFrom:ref.from,sessionTo:ref.to,readerSessionFrom:row,readerSessionTo:endWithoutNewline(mapping.normalized,row,ref.to)});
  }}});
  const referenceIndex=buildReferenceLinkIndex(mapping.normalized,profile,normalizedParseSource),references={...referenceIndex,definitions:referenceIndex.definitions.map(def=>({...def,...originalRange(def)})),occurrences:referenceIndex.occurrences.map(item=>({...item,...originalRange(item)}))};
  for(const definition of references.definitions){if(!allowed(definition)||!references.resolved[definition.key])continue;const occurrences=references.occurrences.filter(item=>item.key===definition.key&&allowed(item)),owner=occurrences[0]??{from:definition.from,to:definition.to};const lineStart=source.lastIndexOf('\n',definition.from-1)+1,from=/^[ \t]*$/.test(source.slice(lineStart,definition.from))?lineStart:definition.from;add('shared-definition',{from,to:definition.to},definition.label,{from:owner.from,to:owner.to},{referenceCount:occurrences.length,definitionKind:'reference'});}
  for(const definition of noteDefinitions){const notes=environment.footnotes?.list??[],count=notes.find(item=>item.label===definition.label)?.count??0;const occurrence=tokens.find(token=>token.type==='inline'&&token.map&&token.children?.some(child=>child.type==='footnote_ref'&&notes[child.meta?.id]?.label===definition.label));const owner=occurrence?.map?{from:mapping.positions[mapping.lines[occurrence.map[0]]],to:endWithoutNewline(source,mapping.positions[mapping.lines[occurrence.map[0]]],mapping.positions[mapping.lines[occurrence.map[1]]??mapping.normalized.length])}:definition.range;add('shared-definition',definition.range,definition.label,owner,{referenceCount:count,definitionKind:'footnote'});}
  for(const token of tokens)if(token.type==='heading_open'&&token.map&&token.attrGet('id')){const from=mapping.positions[mapping.lines[token.map[0]]],to=endWithoutNewline(source,from,mapping.positions[mapping.lines[token.map[1]]??mapping.normalized.length]),raw=source.slice(from,to),id=token.attrGet('id')!,match=raw.lastIndexOf('{#'+id+'}');if(match>=0)add('anchor',{from:from+match,to:from+match+id.length+3},id,{from,to});}
  // Inline HTML is inspected only inside a real parsed paragraph, never by a
  // global tag/definition regex over code, wiki labels or TeX.
  for(const range of html){
    const raw=source.slice(range.from,range.to);let nodes:HtmlSourceNode[]=[];try{nodes=flatten(htmlSourceNodes(raw));}catch{nodes=scanHtmlDeclarations(raw);}
    const literal=nodes.filter(node=>['pre','code','script','style','textarea'].includes(node.name)).map(node=>({from:range.from+node.openTo,to:range.from+node.closeFrom}));
    const owner=(from:number,to:number)=>{const node=nodes.filter(item=>item.openTo<=from-range.from&&item.closeFrom>=to-range.from).sort((a,b)=>(a.to-a.from)-(b.to-b.from))[0];return node?{from:range.from+node.from,to:range.from+node.to}:range;};
    for(const match of raw.matchAll(/<!--[\s\S]*?-->/g)){const span={from:range.from+match.index!,to:range.from+match.index!+match[0].length};if(allowed(span)&&!literal.some(item=>encloses(item,span))&&!pending.some(item=>item.kind==='comment'&&sameRange(item.sourceRange,span)))add('comment',span,decodeHtmlAttribute(match[0].slice(4,-3).trim(),parser),owner(span.from,span.to));}
    for(const match of raw.matchAll(/<!DOCTYPE\s+[^>]*>|<\?[\s\S]*?\?>/ig)){const span={from:range.from+match.index!,to:range.from+match.index!+match[0].length};if(allowed(span)&&!literal.some(item=>encloses(item,span)))add('unapplied-declaration',span,'HTML declaration',owner(span.from,span.to),{reason:'This HTML declaration is preserved in source and is not applied by the safe projection.'});}
    const details=nodes.filter(node=>node.name==='details'&&node.to>node.openTo&&allowed({from:range.from+node.from,to:range.from+node.to}));details.forEach((node,index)=>{const from=range.from+node.from,to=range.from+node.to,normalizedBase=normalizedAt(range.from),normalizedTo=normalizedAt(range.to);folds.push({kind:'html-details',from,to,initial:Object.hasOwn(node.attributes,'open'),sessionFrom:normalizedBase+index,sessionTo:normalizedTo,readerSessionFrom:normalizedBase+index,readerSessionTo:endWithoutNewline(mapping.normalized,normalizedBase,normalizedTo<0?mapping.normalized.length:normalizedTo)});});
    for(const node of nodes){const nodeRange={from:range.from+node.from,to:range.from+node.to};if(!allowed(nodeRange)||literal.some(item=>item.from<=nodeRange.from&&item.to>=nodeRange.to))continue;const opening=raw.slice(node.from,node.openTo);
      // Name-only ancestry preserves parser context without author resources.
      const clean=DOMPurify.sanitize(appliedElementProbe(node),safeHtmlOptions),kept=clean.toLowerCase().includes('<'+node.name);
      if(!kept){add('unapplied-declaration',nodeRange,node.name,nodeRange,{reason:'This HTML element is preserved in source and is not applied by the safe projection.'});continue;}
      const attributeStart=/^<[\w:-]+/.exec(opening)?.[0].length??opening.length,body=opening.slice(attributeStart).replace(/\/?\s*>$/,'');
      for(const match of body.matchAll(/([^\s=<>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>]+)))?/g)){const name=match[1].toLowerCase(),value=match[2]??match[3]??match[4]??'',span={from:range.from+node.from+attributeStart+match.index!,to:range.from+node.from+attributeStart+match.index!+match[0].length};
        if(name==='id'||name==='name'&&node.name==='a')add('anchor',span,decodeHtmlAttribute(value,parser),nodeRange);
        if(removedProjectionAttributes.has(name)||safeHtmlOptions.FORBID_ATTR.includes(name)||!DOMPurify.isValidAttribute(node.name,name,decodeHtmlAttribute(value,parser)))add('unapplied-declaration',span,node.name+' '+name,nodeRange,{reason:'This HTML attribute is preserved in source and is not applied by the safe projection.'});
      }
    }
  }
  for(const note of projectedNotes){
    const body=inspectDocument(note.value,profile),raw=mapping.normalized.slice(note.from,note.to),rootPosition=(at:number)=>note.from+footnoteBodyPosition(raw,at),sourceRange=(range:InspectionRange)=>({from:mapping.positions[rootPosition(range.from)],to:mapping.positions[rootPosition(range.to)]});
    for(const fold of body.folds)folds.push({...fold,...sourceRange(fold),sessionFrom:rootPosition(fold.sessionFrom),sessionTo:rootPosition(fold.sessionTo),readerSessionFrom:rootPosition(fold.readerSessionFrom),readerSessionTo:rootPosition(fold.readerSessionTo)});
    for(const entry of body.entries){const range=sourceRange(entry.sourceRange);if(pending.some(existing=>existing.kind===entry.kind&&sameRange(existing.sourceRange,range)))continue;const {id:_,foldPath:__,...value}=entry;pending.push({...value,sourceRange:range,raw:source.slice(range.from,range.to),ownerRange:sourceRange(entry.ownerRange)});}
  }
  const visible=blocks.filter(range=>!references.definitions.some(def=>encloses(def,range))).concat(html.filter(range=>source.slice(range.from,range.to).replace(/<!--[\s\S]*?-->/g,'').trim())).sort((a,b)=>a.from-b.from);
  // A standalone hidden comment belongs to the nearest existing visible
  // boundary; locating it must not manufacture a paragraph or reveal Source.
  for(const entry of pending)if(entry.kind==='shared-definition'&&entry.referenceCount===0||entry.kind==='comment'&&(sameRange(entry.ownerRange,entry.sourceRange)||!source.slice(entry.ownerRange.from,entry.ownerRange.to).replace(/<!--[\s\S]*?-->/g,'').trim())){const container=folds.filter(fold=>encloses(fold,entry.sourceRange)).sort((a,b)=>(a.to-a.from)-(b.to-b.from))[0];const candidates=container?visible.filter(range=>encloses(container,range)):visible;const next=candidates.find(range=>range.from>=entry.sourceRange.to),previous=candidates.filter(range=>range.to<=entry.sourceRange.from).at(-1);entry.ownerRange=next??previous??container??{from:0,to:0};}
  folds.sort((a,b)=>a.from-b.from||b.to-a.to);
  const entries=pending.sort((a,b)=>a.sourceRange.from-b.sourceRange.from||a.kind.localeCompare(b.kind)).map((entry,index)=>({...entry,id:entry.kind+':'+entry.sourceRange.from+':'+index,foldPath:folds.filter(fold=>encloses(fold,entry.ownerRange))}));
  return {source,profile,entries,folds};
}
export function queryInspection(model:DocumentInspection,query:{kind?:InspectionKind;search?:string}={}):readonly InspectionEntry[]{const search=query.search?.trim().toLocaleLowerCase()??'';return model.entries.filter(entry=>(!query.kind||entry.kind===query.kind)&&(!search||(entry.label+'\n'+entry.raw+'\n'+(entry.reason??'')).toLocaleLowerCase().includes(search)));}
/** A changed source invalidates the inventory, never silently retargets it. */
export function inspectionLocation(model:DocumentInspection,entry:InspectionEntry,currentSource:string,session:ContentDisplaySession,options:{projection?:'reader'|'live'|'source'}={}):InspectionLocation {
  if(currentSource!==model.source||!model.entries.includes(entry))throw new Error('The document changed. Reopen document inspection.');
  const foldsToExpand=options.projection==='source'?[]:entry.foldPath.map(fold=>({...fold,keyFrom:options.projection==='reader'?fold.readerSessionFrom:fold.sessionFrom,keyTo:options.projection==='reader'?fold.readerSessionTo:fold.sessionTo})).filter(fold=>!session.expanded(fold.kind,fold.keyFrom,fold.keyTo,fold.initial));
  return {ownerRange:entry.ownerRange,foldsToExpand};
}
/** One explicit Locate action expands only current collapsed ancestors. */
export function expandInspectionLocation(location:InspectionLocation,session:ContentDisplaySession){for(const fold of location.foldsToExpand)session.setExpanded(fold.kind,fold.keyFrom,fold.keyTo,true);}
