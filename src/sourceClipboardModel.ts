import type MarkdownIt from 'markdown-it';
import {createMarkdownParser} from './markdownParser';
import {controlledClipboardHtml,readableClipboardText,type ContentClipboard} from './contentClipboardText';
import type {SemanticClipboardData} from './clipboardTransport';
import type {MarkdownProfile} from './syntaxProfiles';

type Span={from:number;to:number};
type Definition=Span&{kind:'reference'|'footnote';key:string;raw:string;portable:boolean};
type References=Record<string,{href:string;title:string}>;
type BlockRule=Parameters<MarkdownIt['block']['ruler']['before']>[2];
type InlineRule=Parameters<MarkdownIt['inline']['ruler']['before']>[2];

/** Markdown-it normalizes line endings before tokenizing. Keep the original
 * offset for every normalized boundary rather than rewriting clipboard source. */
function normalizedPositions(source:string){
 let normalized='',positions=[0];
 for(let at=0;at<source.length;){let char=source[at++];if(char==='\r'){if(source[at]==='\n')at++;char='\n';}if(char==='\0')char='\ufffd';normalized+=char;positions.push(at);}
 const lines=[0];for(let at=0;at<normalized.length;at++)if(normalized[at]==='\n')lines.push(at+1);
 return {normalized,positions,lines};
}

/** Full registered Reader blocks already have source boundaries. This model
 * preserves that exact slice and obtains dependencies from successful parser
 * rules, never from brackets found in code, TeX, wiki labels or author HTML. */
export function sourceSpanClipboard(documentSource:string,span:Span,profile:MarkdownProfile='tegg'):SemanticClipboardData {
 if(!Number.isInteger(span.from)||!Number.isInteger(span.to)||span.from<0||span.to>documentSource.length||span.from>=span.to)throw new Error('Select a valid source range to copy.');
 const selectedSource=documentSource.slice(span.from,span.to),parser=createMarkdownParser(profile),mapping=normalizedPositions(documentSource),definitions:Definition[]=[];
 const usedReferences=new Set<string>(),usedFootnotes=new Set<string>();let phase:'document'|'selection'='document';

 const observeBlock=(name:string,kind:Definition['kind'])=>{
  let original!:BlockRule;
  const capture:BlockRule=(state,start,end,silent)=>{
   if(silent||phase!=='document')return original(state,start,end,silent);
   const header=state.bMarks[start]+state.tShift[start],lineFrom=mapping.lines[start]??header,tokenCount=state.tokens.length,keys=new Set<string>();
   const env=state.env as {references?:References;footnotes?:{refs?:Record<string,number>}};
   const refs=env.references??{};
   const proxy=new Proxy(refs,{get(target,key,receiver){if(typeof key==='string')keys.add(key);return Reflect.get(target,key,receiver);},set(target,key,value,receiver){if(typeof key==='string')keys.add(key);return Reflect.set(target,key,value,receiver);}});
   if(kind==='reference')env.references=proxy;
   let accepted:boolean;
   try{accepted=original(state,start,end,silent);}finally{if(kind==='reference')env.references=refs;}
   if(!accepted)return false;
   const key=kind==='footnote'?state.tokens.slice(tokenCount).find(token=>token.type==='footnote_reference_open')?.meta?.label:keys.values().next().value;
   if(typeof key!=='string')throw new Error('The parsed definition has no reliable source identity.');
   let normalizedTo=mapping.lines[state.line]??mapping.normalized.length;
   while(normalizedTo>lineFrom&&mapping.normalized[normalizedTo-1]==='\n')normalizedTo--;
   const from=mapping.positions[lineFrom],to=mapping.positions[normalizedTo];
   const portable=!mapping.normalized.slice(lineFrom,header).trim();
   definitions.push({kind,key,from,to,raw:documentSource.slice(from,to),portable});
   return true;
  };
  // The public rule list supplies the actual rule immediately after our hook;
  // function names can be minified, so they never identify syntax authority.
  parser.block.ruler.before(name,'clipboard_capture_'+name,capture);
  const rules=parser.block.ruler.getRules('');original=rules[rules.indexOf(capture)+1];
  if(!original)throw new Error('The definition parser is unavailable.');
 };
 observeBlock('reference','reference');if(profile!=='gfm')observeBlock('footnote_def','footnote');

 const observeInline=(name:string,footnote=false)=>{
  let original!:InlineRule;
  const capture:InlineRule=(state,silent)=>{
   if(silent||phase==='document')return original(state,silent);
   const keys=new Set<string>(),env=state.env as {references?:References;footnotes?:{refs?:Record<string,number>}};
   const target=footnote?env.footnotes?.refs:env.references;
   if(!target)return original(state,silent);
   const proxy=new Proxy(target,{get(value,key,receiver){if(typeof key==='string')keys.add(key);return Reflect.get(value,key,receiver);}});
   if(footnote)env.footnotes!.refs=proxy as Record<string,number>;else env.references=proxy as References;
   let accepted:boolean;
   try{accepted=original(state,silent);}finally{if(footnote)env.footnotes!.refs=target as Record<string,number>;else env.references=target as References;}
   if(accepted)for(const key of keys)if(Object.prototype.hasOwnProperty.call(target,key))(footnote?usedFootnotes:usedReferences).add(footnote?key.slice(1):key);
   return accepted;
  };
  parser.inline.ruler.before(name,'clipboard_usage_'+name,capture);
  const rules=parser.inline.ruler.getRules('');original=rules[rules.indexOf(capture)+1];
  if(!original)throw new Error('The inline reference parser is unavailable.');
 };
 observeInline('link');observeInline('image');if(profile!=='gfm')observeInline('footnote_ref',true);
 // Back-navigation is parser-generated presentation, not selected author text.
 // Change only its known renderer rule; author elements with the same class stay.
 if(profile!=='gfm')parser.renderer.rules.footnote_anchor=()=>'';
 const documentEnv:{profile:MarkdownProfile;references?:References;footnotes?:{refs?:Record<string,number>}}={profile};
 parser.parse(documentSource,documentEnv);phase='selection';
 const seed=()=>({profile,references:{...documentEnv.references},footnotes:{refs:Object.fromEntries(Object.keys(documentEnv.footnotes?.refs??{}).map(key=>[key,-1]))}});
 parser.parse(selectedSource,seed());
 const included:Definition[]=[],processed=new Set<Definition>();
 // Footnote bodies can themselves use references/notes. Resolve the finite
 // dependency closure through the same parser and preserve each source record.
 for(;;){let added=false;
  for(const definition of definitions){
   if(processed.has(definition)||!(definition.kind==='reference'?usedReferences:usedFootnotes).has(definition.key))continue;
   processed.add(definition);added=true;
   if(definition.from>=span.from&&definition.to<=span.to)continue;
   if(!definition.portable)throw new Error('This selection uses a definition inside another container. Copy the whole container or choose plain text explicitly.');
   included.push(definition);if(definition.kind==='footnote')parser.parse(definition.raw,seed());
  }
  if(!added)break;
 }
 included.sort((a,b)=>a.from-b.from);
 const renderSource=selectedSource+(included.length?'\n\n'+included.map(item=>item.raw).join('\n\n'):'');
 let html=controlledClipboardHtml(parser.render(renderSource,{profile}));const root=document.createElement('div');root.innerHTML=html;
 root.querySelectorAll('[data-tex]').forEach(node=>{if(!node.textContent)node.textContent=node.getAttribute('data-tex')??'';});html=root.innerHTML;
 return {text:readableClipboardText(root),html,structured:JSON.stringify({version:1,kind:'content',format:profile,source:selectedSource,...(included.length?{definitions:included.map(item=>item.raw)}:{})} satisfies ContentClipboard)};
}
