import {bindHtmlDetailsDisplay} from './htmlDetailsDisplay';
import {parsedCodeBody} from './codeLiteral';
import {registerRenderedSourceRange,registerRenderedClipboardOpaque,registerRenderedClipboardLiteral,type RenderedSourceRange} from './renderedSourceClipboard';
import {attachDomSemanticClipboard} from './renderedClipboard';
import {projectedSourceRange} from './projectedSource';
import {htmlSourceNodes,type HtmlSourceNode} from './htmlTableEditing';
import {configureMissingFootnotes,readerFootnoteDocument,projectReaderFootnotes} from './readerFootnotes';
import {bindContentScroll} from './contentScroll';
import type {ContentDisplaySession} from "./contentDisplaySession";
import {bindEngines, enginesFor} from "./renderEngines";
import {setUIText, setUILabel} from "./uiContext";
import {type MarkdownProfile} from "./syntaxProfiles";
import { createMetadataPanel, disposeMetadataPanel } from "./metadata";
import {copySource, disposeInteractions, scopeIds, enhanceFigures} from "./renderInteraction";
import {enhanceFootnotes} from "./footnotes";
import { makeHorizontalScrollRegion } from "./localScroll";
import { parserFor, markdownParser as md } from "./markdownParser";
import { enhanceRenderedLinks } from "./renderedLinks";
import { extractFrontmatter } from "./profile";
import {
  syncRenderedCalloutDisplay,
  rebindRenderedCalloutDisplay,
  disposeRenderedCalloutDisplay,
  applySemanticClasses,
  createCodeBlock,
  enhanceCallouts,
  escapeHtml,
  renderClassNames,
  renderDiagram,
  enhanceMathTokens,
  sanitizeRenderedHtml,
} from "./renderKit";

export { extractFrontmatter, parseWikiLink } from "./profile";
export { renderDiagram } from "./renderKit";

export type ReaderContentState = "streaming" | "settled";
export type ReaderEvent =
  | { type: "openLink"; href: string }
  | { type: "copyCode"; language: string; code: string };

export type RenderMarkdownOptions = {
  profile?: MarkdownProfile;
  displaySession?:ContentDisplaySession;
  /** Reuse independently rendered blocks within one document. */
  reuseKey?: string;
  signal?: AbortSignal;
  interactionSignal?: AbortSignal;
  enhancedInteractions?: boolean;
  documentPath?: string;
  resolveImage?: (src: string, documentPath: string) => string;
  contentState?: ReaderContentState;
  onOpenLink?: (href: string) => void;
  /** Hosts can schedule expensive diagrams after the initial readable content. */
  scheduleDiagram?: (target: HTMLElement, source: string, render: () => Promise<void>) => void;
  onEvent?: (event: ReaderEvent) => void;
};

const sourceNodeRanges=new WeakMap<Node,RenderedSourceRange>();
const sourceCodeBodies=new WeakMap<Node,string>();
const sourceDetailsDisplay=new WeakMap<HTMLDetailsElement,()=>void>();
type ReaderDisplayBinding={kind:'details'|'code';rebind:(session:ContentDisplaySession|undefined,range:{from:number;to:number})=>void;sync:()=>void;dispose:()=>void};
const readerDisplayBindings=new WeakMap<HTMLElement,ReaderDisplayBinding>();
const readerDisplayLifetime=new WeakMap<HTMLElement,{signal:AbortSignal;stop:()=>void}>();
function ownedElements(root:HTMLElement,selector:string){return [...(root.matches(selector)?[root]:[]),...root.querySelectorAll<HTMLElement>(selector)];}
function disposeReaderDisplay(root:HTMLElement){
  disposeRenderedCalloutDisplay(root);
  for(const node of [root,...root.querySelectorAll<HTMLElement>('*')]){readerDisplayBindings.get(node)?.dispose();readerDisplayBindings.delete(node);if(node instanceof HTMLDetailsElement)sourceDetailsDisplay.delete(node);}
}
function bindReaderDisplayLifetime(root:HTMLElement,signal?:AbortSignal){
  const previous=readerDisplayLifetime.get(root);if(previous?.signal===signal)return;previous?.signal.removeEventListener('abort',previous.stop);
  if(signal){const stop=()=>{disposeReaderDisplay(root);readerDisplayLifetime.delete(root);};readerDisplayLifetime.set(root,{signal,stop});signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();}
}
function rebindRetainedDisplay(previous:HTMLElement,next:HTMLElement,source:string,body:string,session?:ContentDisplaySession){
  const quotes=ownedElements(previous,'blockquote.callout'),freshQuotes=ownedElements(next,'blockquote.callout');
  quotes.forEach((quote,index)=>{const fresh=freshQuotes[index];if(fresh)rebindRenderedCalloutDisplay(quote,session,projectedSourceRange(fresh,source,body,Number(fresh.dataset.calloutSourceLine??0),Number(fresh.dataset.calloutSourceToLine??1)));});
  const details=ownedElements(previous,'details').filter(node=>readerDisplayBindings.get(node)?.kind==='details'),freshDetails=ownedElements(next,'details[data-details-source-line]');
  details.forEach((node,index)=>{const fresh=freshDetails[index];if(fresh){const range=projectedSourceRange(fresh,source,body,Number(fresh.dataset.detailsSourceLine),Number(fresh.dataset.detailsSourceToLine),true);readerDisplayBindings.get(node)?.rebind(session,{from:range.from+Number(fresh.dataset.detailsSourceIndex),to:range.to});}});
  const codes=ownedElements(previous,'.code-block').filter(node=>readerDisplayBindings.get(node)?.kind==='code'),freshCodes=ownedElements(next,'pre').filter(node=>!node.closest('.diagram-source,.frontmatter'));
  codes.forEach((node,index)=>{const fresh=freshCodes[index];if(fresh)readerDisplayBindings.get(node)?.rebind(session,projectedSourceRange(fresh,source,body,Number(fresh.dataset.codeSourceLine??0),Number(fresh.dataset.codeSourceToLine??0)));});
}
/** Locate a rendered source owner using renderer registrations, never author attributes. */
export function locateRenderedSourceRange(root:HTMLElement,range:{from:number;to:number}):HTMLElement|null {
  if(!root.isConnected||!Number.isInteger(range.from)||!Number.isInteger(range.to)||range.from<0||range.to<range.from)return null;
  syncRenderedCalloutDisplay(root);
  for(const details of root.querySelectorAll<HTMLDetailsElement>('details'))sourceDetailsDisplay.get(details)?.();
  const visible=(node:HTMLElement)=>{for(let current:HTMLElement|null=node;current&&root.contains(current);current=current.parentElement){
    if(current.hidden||getComputedStyle(current).display==='none'||getComputedStyle(current).visibility==='hidden')return false;
    const parent:HTMLElement|null=current.parentElement;if(parent instanceof HTMLDetailsElement&&!parent.open&&current!==parent.querySelector(':scope > summary'))return false;
  }return true;};
  let candidate:HTMLElement|null=null,best=Infinity;
  for(const node of [root,...root.querySelectorAll<HTMLElement>('*')]){
    const source=sourceNodeRanges.get(node);if(!source||source.calloutTitle||source.from>range.from||source.to<range.to||!visible(node))continue;
    const size=source.to-source.from;if(size<=best){candidate=node;best=size;}
  }
  if(!candidate)return null;
  candidate.scrollIntoView?.({block:'nearest',inline:'nearest'});
  const previous=candidate.getAttribute('tabindex');if(previous===null){candidate.tabIndex=-1;candidate.addEventListener('blur',()=>{if(candidate?.getAttribute('tabindex')==='-1')candidate.removeAttribute('tabindex');},{once:true});}
  candidate.focus({preventScroll:true});return candidate;
}

function sourceNode(node:Node,range:RenderedSourceRange){sourceNodeRanges.set(node,range);registerRenderedSourceRange(node,range);}
function adoptSourceRange(previous:Node,next:Node){const before=sourceNodeRanges.get(previous),after=sourceNodeRanges.get(next);if(!after)return;const delta=after.from-(before?.from??after.from);sourceNode(previous,after);if(delta&&previous instanceof Element)for(const child of previous.querySelectorAll('*')){const range=sourceNodeRanges.get(child);if(range)sourceNode(child,{...range,from:range.from+delta,to:range.to+delta});}}
type ClipboardProjection={id:string;ranges:Map<string,RenderedSourceRange>;codeBodies:Map<string,string>;offsets:number[];source:string;body:string;htmlOwners?:boolean};
/** Only a scoped renderer asks for nested HTML ownership. Match a complete
 * lexical tree to the fresh projection before registering real DOM identities. */
function scopedHtmlOwners(rendered:string,raw:string,first:number,context:ClipboardProjection){
  const lines=raw.split('\n'),sourceLines=context.source.split('\n'),positions=[0];for(const line of lines)positions.push(positions.at(-1)!+line.length+1);
  const position=(at:number)=>{let row=0;while(row+1<positions.length&&positions[row+1]<=at)row++;const text=lines[row]??'',original=sourceLines[first+row];if(original===undefined||!original.endsWith(text))throw new Error('Unmapped HTML line');return (context.offsets[first+row]??context.source.length)+original.length-text.length+at-positions[row];};
  try{
    const nodes=htmlSourceNodes(raw),template=document.createElement('template');template.innerHTML=rendered;
    const matches=(source:readonly HtmlSourceNode[],elements:readonly Element[]):boolean=>source.length===elements.length&&source.every((node,index)=>node.name===elements[index].tagName.toLowerCase()&&matches(node.children,[...elements[index].children]));
    if(!matches(nodes,[...template.content.children]))return rendered;
    const register=(source:readonly HtmlSourceNode[],elements:readonly Element[])=>source.forEach((node,index)=>{const element=elements[index],key=context.id+'-html-'+context.ranges.size;context.ranges.set(key,{from:position(node.from),to:position(node.to)});element.setAttribute('data-tegg-copy-key',key);register(node.children,[...element.children]);});
    register(nodes,[...template.content.children]);return template.innerHTML;
  }catch{return rendered;}
}
const configured = new WeakSet<object>();
const clipboardBindings=new WeakMap<HTMLElement,()=>void>();
function rendererFor(profile: MarkdownProfile = "tegg") {
  const parser = parserFor(profile);
  if (configured.has(parser)) return parser;
  configured.add(parser);if(profile!=='gfm')configureMissingFootnotes(parser);
  const tableFallback=parser.renderer.rules.table_open;
  parser.renderer.rules.table_open=(tokens,index,options,env,self)=>{const token=tokens[index];if(token.map){token.attrSet('data-content-source-line',String(token.map[0]));token.attrSet('data-content-source-to-line',String(token.map[1]));}return tableFallback?tableFallback(tokens,index,options,env,self):self.renderToken(tokens,index,options);};
  const htmlFallback=parser.renderer.rules.html_block;
  parser.renderer.rules.html_block=(tokens,index,options,env,self)=>{const token=tokens[index],rendered=htmlFallback?htmlFallback(tokens,index,options,env,self):token.content;if(!token.map)return rendered;let detailsIndex=0;return rendered.replace(/<table\b/i,'<table data-content-source-line="'+token.map[0]+'" data-content-source-to-line="'+token.map[1]+'"').replace(/<details\b/gi,()=>'<details data-details-source-line="'+token.map![0]+'" data-details-source-to-line="'+token.map![1]+'" data-details-source-index="'+(detailsIndex++)+'"');};
  const mathFallback=parser.renderer.rules.tegg_math_block;
  if(mathFallback)parser.renderer.rules.tegg_math_block=(tokens,index,options,env,self)=>{const token=tokens[index],rendered=mathFallback(tokens,index,options,env,self);return token.map?rendered.replace('<div','<div data-content-source-line="'+token.map[0]+'" data-content-source-to-line="'+token.map[1]+'"'):rendered;};
  const fallback = parser.renderer.rules.fence?.bind(parser.renderer.rules);
  parser.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index], language = token.info.trim().split(/\s+/)[0].toLowerCase();
    const sourceAttrs=token.map?` data-content-source-line="${token.map[0]}" data-content-source-to-line="${token.map[1]}"`:"";
    if (profile !== "gfm" && (language === "mermaid" || (profile === "tegg" && ["dot", "graphviz"].includes(language)))) {
      return `<figure${sourceAttrs} class="diagram ${renderClassNames.block} ${renderClassNames.diagram}" data-diagram="${language}"><pre class="diagram-source"><code>${escapeHtml(token.content)}</code></pre><div class="diagram-canvas ${renderClassNames.canvas}" role="img" aria-label="${language} diagram"></div></figure>`;
    }
    if (profile !== "gfm" && language === "math") return `<div${sourceAttrs} data-tegg-math="block" data-tex="${parser.utils.escapeHtml(token.content)}"></div>`;
    const rendered=fallback ? fallback(tokens, index, options, env, self) : "";
    return token.map?rendered.replace('<pre','<pre data-code-source-line="'+token.map[0]+'" data-code-source-to-line="'+token.map[1]+'" data-code-language="'+parser.utils.escapeHtml(token.info.trim().split(/\s+/)[0]??'')+'"'):rendered;
  };
  // Only a Reader render supplies this private token registry. Original author
  // attributes never authorize a source copy; temporary keys are removed before
  // the DOM is exposed or cached.
  for(const kind of ['paragraph_open','heading_open','blockquote_open','bullet_list_open','ordered_list_open','list_item_open','table_open','hr','fence','code_block','tegg_math_block','html_block']){
    const render=parser.renderer.rules[kind];
    parser.renderer.rules[kind]=(tokens,index,settings,env,self)=>{
      let rendered=render?render(tokens,index,settings,env,self):self.renderToken(tokens,index,settings);
      const context=env?.teggClipboardProjection as ClipboardProjection|undefined,token=tokens[index];
      if(!context||!token.map||!/<[a-z]/i.test(rendered))return rendered;
      if(kind==='html_block'){if(context.htmlOwners)rendered=scopedHtmlOwners(rendered,token.content,token.map[0],context);const template=document.createElement('template');template.innerHTML=rendered;if(template.content.children.length!==1||Array.from(template.content.childNodes).some(node=>node instanceof Text&&node.data.trim()))return rendered;}
      const from=context.offsets[token.map[0]]??context.source.length;let to=context.offsets[token.map[1]]??context.source.length;while(to>from&&/[\r\n]/.test(context.source[to-1]))to--;
      if(to<=from)return rendered;const next=tokens[index+1],children=next?.type==='inline'?next.children??[]:[],imageOnly=kind==='paragraph_open'&&children.filter(child=>child.type==='image').length===1&&children.every(child=>child.type==='image'||child.type==='link_open'||child.type==='link_close'||child.type==='text'&&!child.content.trim());
      const object=['table_open','fence','code_block','tegg_math_block','hr'].includes(kind)||!!token.attrGet('data-callout')||imageOnly||kind==='html_block'&&/^\s*<(?:table|figure|details)(?:\s|>)/i.test(token.content);
      const key=context.id+'-'+index;context.ranges.set(key,{from,to,object});
      if(kind==='fence'||kind==='code_block'){
        const lastFrom=context.offsets[token.map[1]-1]??context.source.length,lastTo=context.offsets[token.map[1]]??context.source.length;
        context.codeBodies.set(key,parsedCodeBody(token.content,kind==='fence'?token.markup:'',context.source.slice(lastFrom,lastTo),lastTo===context.source.length));
      }
      rendered=rendered.replace(/<([a-z][\w:-]*)\b/i,'<$1 data-tegg-copy-key="'+key+'"');
      if(kind==='code_block')rendered=rendered.replace('<pre','<pre data-code-source-line="'+token.map[0]+'" data-code-source-to-line="'+token.map[1]+'"');
      return rendered;
    };
  }
  return parser;
}
rendererFor();


async function enhanceDiagrams(root: HTMLElement, contentState: ReaderContentState, schedule?: RenderMarkdownOptions["scheduleDiagram"], signal?: AbortSignal, selected?: HTMLElement[]) {
  const figures = selected ?? Array.from(root.querySelectorAll<HTMLElement>(".diagram"));
  for (const figure of figures) {
    const pre = figure.querySelector<HTMLElement>(".diagram-source");
    if (!pre) continue;
    const details = document.createElement("details");
    details.className = "md-diagram-source";
    const summary = document.createElement("summary");
    registerRenderedClipboardOpaque(summary);setUIText(summary, "Diagram source");
    pre.tabIndex = 0;
    details.append(summary, pre); figure.append(details);
  }
  if (contentState === "streaming") {
    for (const figure of figures) {
      const canvas = figure.querySelector<HTMLElement>(".diagram-canvas");
      if (canvas) {
        canvas.classList.add("diagram-pending");
        setUIText(canvas, "Content is still being generated. The diagram will render when it is complete.");
      }
    }
    return;
  }
  await Promise.all(figures.map(async (figure) => {
    const kind = figure.dataset.diagram ?? "mermaid";
    const source = figure.querySelector("code")?.textContent ?? "";
    const canvas = figure.querySelector<HTMLElement>(".diagram-canvas");
    if (!canvas) return;
    const render = () => renderDiagram({
      kind: "diagram",
      engine: kind === "dot" || kind === "graphviz" ? kind : "mermaid",
      source,
    }, canvas, () => !signal?.aborted && root.contains(canvas));
    if (schedule) schedule(canvas, source, render);
    else await render();
  }));
}

function secureLinks(root: HTMLElement, options: RenderMarkdownOptions) {
  enhanceRenderedLinks(root, href => {
    options.onOpenLink?.(href);
    options.onEvent?.({type: "openLink", href});
  }, interactionRoots.get(root) ?? root);
}

function enhanceCodeBlocks(root: HTMLElement, options: RenderMarkdownOptions,source:string,body:string) {
  source=source.replace(/\r\n/g,"\n");body=body.replace(/\r\n/g,"\n");
  for (const pre of root.querySelectorAll<HTMLPreElement>("pre")) {
    if (pre.closest(".diagram-source, .frontmatter")) continue;
    const code = sourceCodeBodies.get(pre) ?? pre.querySelector("code")?.textContent ?? "";
    const languageClass = pre.querySelector("code")?.className.match(/language-([\w+-]+)/)?.[1] ?? "text";
    const wrapper = createCodeBlock({ kind: "code", source: sourceCodeBodies.has(pre)&&code.endsWith("\n")?code+"\n":code, language: pre.dataset.codeLanguage??languageClass }, {
      label: "Copy",
      run: async () => {
        const copy = wrapper.querySelector<HTMLButtonElement>(".md-code-copy");
        const copied=await copySource(code, wrapper);
        if (copied!==true || !wrapper.isConnected || options.interactionSignal?.aborted) return;
        if (copy) {
          const previous=copy.innerHTML;copy.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';copy.title="Copied";
          const timer = window.setTimeout(() => {if(copy.isConnected){copy.innerHTML=previous;copy.title="Copy code";}}, 1200);
          options.interactionSignal?.addEventListener("abort",()=>window.clearTimeout(timer),{once:true});
        }
        options.onEvent?.({ type: "copyCode", language: languageClass, code });
      },
    }, enginesFor(root));
    wrapper.classList.add("code-block");
    const copyRange=sourceNodeRanges.get(pre);if(copyRange)sourceNode(wrapper,copyRange);registerRenderedClipboardLiteral(wrapper.querySelector("pre > code")??wrapper.querySelector("pre")!);
    wrapper.querySelector(`.${renderClassNames.toolbar}`)?.classList.add("code-toolbar");
    const {from,to}=projectedSourceRange(pre,source,body,Number(pre.dataset.codeSourceLine??0),Number(pre.dataset.codeSourceToLine??0));
    wrapper.dataset.sourceFrom=String(from);wrapper.dataset.sourceTo=String(to);
    const wrap=wrapper.querySelector<HTMLButtonElement>('.md-code-wrap-action')!;
    let session=options.displaySession,range={from,to},objectId:string|undefined,alive=true,stop:(()=>void)|undefined;
    const sync=()=>{if(!alive)return;const wrapping=session&&objectId?session.expandedById(objectId):(wrap.getAttribute('aria-pressed')==='true');if(wrapping===undefined)return;wrapper.dataset.sourceFrom=String(range.from);wrapper.dataset.sourceTo=String(range.to);wrapper.classList.toggle('md-code-wrap',wrapping);wrap.setAttribute('aria-pressed',String(wrapping));wrapper.querySelector('pre')!.style.whiteSpace=wrapping?'pre-wrap':'pre';};
    const write=()=>{if(alive&&session&&objectId)session.setExpandedById(objectId,wrap.getAttribute('aria-pressed')==='true');};
    const rebind=(nextSession:ContentDisplaySession|undefined,nextRange:{from:number;to:number})=>{stop?.();session=nextSession;range={...nextRange};session?.expanded('code-wrap',range.from,range.to,false);objectId=session?.objectId('code-wrap',range.from,range.to);sync();stop=session?.subscribe(sync);};
    readerDisplayBindings.set(wrapper,{kind:'code',sync,rebind,dispose:()=>{alive=false;stop?.();wrap.removeEventListener('click',write);}});wrap.addEventListener('click',write);rebind(session,range);
    pre.replaceWith(wrapper);
  }
}

function secureTaskInputs(root: HTMLElement) {
  for (const input of root.querySelectorAll<HTMLInputElement>("input")) {
    if (input.type !== "checkbox") {
      input.remove();
      continue;
    }
    input.disabled = true;
    input.tabIndex = -1;
    input.removeAttribute("aria-hidden");
    input.setAttribute("aria-label", input.closest("li")?.textContent?.trim() || "Task");
  }
}

const interactionRoots = new WeakMap<HTMLElement, HTMLElement>();
const blockCaches = new WeakMap<HTMLElement, {key: string; blocks: Array<{raw: string; node: Node}>}>();
/** Reuse is deliberately limited to blocks without cross-block IDs, resources or custom ownership. */
function independentBlock(node: Node) {
  if (!(node instanceof HTMLElement)) return true;
  if(node.tagName === "P" && !node.attributes.length && !node.childElementCount) return true;
  return !node.matches(".frontmatter, .footnotes, [id], [src], [poster]") && !node.querySelector('[id], [src], [poster], [href^="#"], [data-tegg-math], .footnote-ref');
}
export async function renderMarkdown(source: string, root: HTMLElement, options: RenderMarkdownOptions = {}) {
  if (options.signal?.aborted) return;
  if (new TextEncoder().encode(source).byteLength >= 1024 * 1024) {
    disposeReaderDisplay(root);disposeInteractions(root); root.querySelectorAll<HTMLElement>(".frontmatter").forEach(disposeMetadataPanel);
    blockCaches.delete(root); const status=document.createElement("p"), pre=document.createElement("pre");
    setUIText(status,"Large document: source preview is shown to keep the interface responsive."); status.setAttribute("role","status"); pre.textContent=source; pre.className="tegg-source-fallback"; makeHorizontalScrollRegion(pre,"Markdown source. Scroll to read the complete document.");
    root.replaceChildren(status,pre); root.dataset.renderState="source-fallback"; return;
  }
  bindReaderDisplayLifetime(root,options.interactionSignal);
  delete root.dataset.renderState;
  root.dataset.enhancements = String(options.enhancedInteractions !== false);
  const {metadata, body} = options.profile && options.profile !== "tegg" ? {metadata: null, body: source} : extractFrontmatter(source);
  const parser=rendererFor(options.profile),notes=options.profile==='gfm'?undefined:readerFootnoteDocument(parser,body.replace(/\r\n/g,'\n'));
  const base=source.length-body.length,offsets=[base];for(const line of body.match(/[^\n]*\n|[^\n]+$/g)??[])offsets.push(offsets.at(-1)!+line.length);
  const projection={id:crypto.randomUUID(),ranges:new Map<string,RenderedSourceRange>(),codeBodies:new Map<string,string>(),offsets,source,body};
  const raw = parser.render(body, {outline: true, profile: options.profile ?? 'tegg',teggFootnotes:notes,teggClipboardProjection:projection});
  const work = document.createElement("div"); work.className = root.className; work.dataset.enhancements = root.dataset.enhancements;
  const stopEngines = bindEngines(work, enginesFor(root)); interactionRoots.set(work, root);
  work.innerHTML = sanitizeRenderedHtml(raw, options.documentPath, options.resolveImage);
  for(const node of work.querySelectorAll<HTMLElement>('[data-tegg-copy-key]')){const key=node.dataset.teggCopyKey!,range=projection.ranges.get(key),codeBody=projection.codeBodies.get(key);if(codeBody!==undefined)sourceCodeBodies.set(node,codeBody);node.removeAttribute('data-tegg-copy-key');if(range)sourceNode(node,range);}
  const crlfPositions:number[]=[];for(let at=0,normalized=0;at<body.length;at++,normalized++)if(body[at]==='\r'&&body[at+1]==='\n'){crlfPositions.push(normalized);at++;}const bodySourcePosition=(offset:number)=>{let low=0,high=crlfPositions.length;while(low<high){const mid=(low+high)>>>1;if(crlfPositions[mid]<offset)low=mid+1;else high=mid;}return base+offset+low;};
  if(notes){const normalizedBase=source.replace(/\r\n/g,'\n').length-body.replace(/\r\n/g,'\n').length;projectReaderFootnotes(work,notes,parser,options.documentPath,options.resolveImage,source,body,(root,value,position)=>{
    const offsets=[0];for(const line of value.split('\n'))offsets.push(offsets.at(-1)!+line.length+1);const scoped:ClipboardProjection={id:crypto.randomUUID(),ranges:new Map(),codeBodies:new Map(),offsets,source:value,body:value,htmlOwners:true};
    root.innerHTML=sanitizeRenderedHtml(parser.render(value,{teggClipboardProjection:scoped}),options.documentPath,options.resolveImage);
    for(const node of root.querySelectorAll<HTMLElement>('[data-tegg-copy-key]')){const key=node.dataset.teggCopyKey!,range=scoped.ranges.get(key),code=scoped.codeBodies.get(key);node.removeAttribute('data-tegg-copy-key');if(code!==undefined)sourceCodeBodies.set(node,code);if(range)sourceNode(node,{...range,from:bodySourcePosition(position(range.from)-normalizedBase),to:bodySourcePosition(position(range.to)-normalizedBase)});}
  });}
  if (metadata){const panel=createMetadataPanel(metadata);sourceNode(panel,{from:0,to:base,object:true});work.prepend(panel);}
  const key = `${options.reuseKey ?? ""}:${options.profile ?? "tegg"}:${options.enhancedInteractions}`;
  const previous = options.reuseKey !== undefined && blockCaches.get(root)?.key === key ? blockCaches.get(root)!.blocks : [];
  const candidates = new Map<string,{nodes:Node[]; index:number}>();
  for(const item of previous) {let group=candidates.get(item.raw); if(!group) candidates.set(item.raw,group={nodes:[],index:0});group.nodes.push(item.node);}
  const entries = Array.from(work.childNodes, node => {
    const raw = node instanceof HTMLElement ? node.tagName === "P" && !node.attributes.length && !node.childElementCount ? "plain-paragraph:" + node.textContent : node.outerHTML : node.textContent ?? "";
    const reusable = independentBlock(node) && !(node instanceof HTMLElement && node.matches(".diagram") && options.contentState === "streaming");
    const group = reusable ? candidates.get(raw) : undefined;
    let old: Node | undefined;
    while(group && group.index < group.nodes.length) {
      const candidate=group.nodes[group.index++];
      if(candidate.parentNode === root && !(candidate instanceof HTMLElement && candidate.childElementCount && candidate.querySelector('[data-render-state="pending"], .diagram-pending'))) {old=candidate;break;}
    }
    if(old) {adoptSourceRange(old,node);if(old instanceof HTMLElement&&node instanceof HTMLElement)rebindRetainedDisplay(old,node,source,body,options.displaySession);const placeholder=document.createComment("retained block");node.replaceWith(placeholder);return {raw,node:old,placeholder,reusable};}
    return {raw, node, placeholder: undefined, reusable};
  });
  scopeIds(work); applySemanticClasses(work); enhanceCallouts(work,options.displaySession,source,body); enhanceMathTokens(work); enhanceFigures(work); enhanceCodeBlocks(work, options,source,body);
  for (const table of work.querySelectorAll("table")) {
    const region = document.createElement("div"); region.className = "md-table-scroll";
    makeHorizontalScrollRegion(region, "Table. Scroll horizontally for more columns.");const copyRange=sourceNodeRanges.get(table);if(copyRange)sourceNode(region,copyRange);for(const cell of table.querySelectorAll("td,th"))registerRenderedClipboardLiteral(cell); table.replaceWith(region); region.append(table);
  }
  if(options.displaySession){const normalized=source.replace(/\r\n/g,'\n'),normalizedBody=body.replace(/\r\n/g,'\n'),lines=normalizedBody.split('\n'),base=Math.max(0,normalized.indexOf(normalizedBody)),offsets=[base];for(const line of lines)offsets.push(offsets.at(-1)!+line.length+1);
    for(const node of work.querySelectorAll<HTMLElement>('[data-content-source-line]')){const {from,to}=projectedSourceRange(node,source,body,Number(node.dataset.contentSourceLine),Number(node.dataset.contentSourceToLine),true);const kind=node.tagName==='TABLE'?'table':node.matches('.diagram')?'diagram':'math';const scroll=kind==='table'?node.parentElement!:kind==='diagram'?node.querySelector<HTMLElement>('.diagram-canvas')!:node;bindContentScroll(scroll,options.displaySession,kind,{from,to});}
  }
  for(const details of work.querySelectorAll<HTMLDetailsElement>('details[data-details-source-line]')){const {from,to}=projectedSourceRange(details,source,body,Number(details.dataset.detailsSourceLine),Number(details.dataset.detailsSourceToLine),true),index=Number(details.dataset.detailsSourceIndex),session=options.displaySession;if(!details.querySelector(':scope > summary')){const summary=document.createElement('summary');summary.className='md-details-fallback';registerRenderedClipboardOpaque(summary);setUIText(summary,'Details');details.prepend(summary);}{let currentSession=session,range={from:from+index,to},objectId:string|undefined,binding:ReturnType<typeof bindHtmlDetailsDisplay>|undefined,alive=true;
    const sync=()=>{if(alive)binding?.sync();};const rebind=(nextSession:ContentDisplaySession|undefined,nextRange:{from:number;to:number})=>{binding?.dispose();currentSession=nextSession;range={...nextRange};currentSession?.expanded('html-details',range.from,range.to,details.open);objectId=currentSession?.objectId('html-details',range.from,range.to);binding=currentSession?bindHtmlDetailsDisplay(currentSession,()=>alive?[{element:details,...range,id:objectId}]:[]):undefined;};
    readerDisplayBindings.set(details,{kind:'details',sync,rebind,dispose:()=>{alive=false;binding?.dispose();}});sourceDetailsDisplay.set(details,sync);rebind(session,range);}}
  for(const quote of work.querySelectorAll<HTMLElement>('blockquote.callout')){const range=sourceNodeRanges.get(quote),title=quote.querySelector('.callout-title');if(range){const updateCopy=()=>{const current=sourceNodeRanges.get(quote);if(current)sourceNode(quote,{...current,object:quote.dataset.calloutExpanded==='false'});};updateCopy();rebindRenderedCalloutDisplay(quote,options.displaySession,{from:Number(quote.dataset.sourceFrom),to:Number(quote.dataset.sourceTo)},updateCopy);if(title)sourceNode(title,{...range,object:false,calloutTitle:true});}}
  for(const note of notes?.definitions??[]){const node=Array.from(work.querySelectorAll<HTMLElement>('.footnote-item')).find(item=>item.dataset.footnoteKey===note.key);if(node)sourceNode(node,{from:bodySourcePosition(note.from),to:bodySourcePosition(note.to)});}
  secureTaskInputs(work); enhanceFootnotes(work, href => options.onOpenLink?.(href), options.enhancedInteractions !== false); secureLinks(work, options);
  const diagrams = Array.from(work.querySelectorAll<HTMLElement>(".diagram"));
  const enhanced = Array.from(work.childNodes);
  const next = entries.map((entry,index) => ({...entry, node: entry.placeholder ? entry.node : enhanced[index]}));
  // Keep retained nodes in place: moving through a detached staging tree loses focus.
  const keep = new Set(next.map(entry => entry.node));
  for (const node of Array.from(root.childNodes)) if (!keep.has(node)) {
    if (node instanceof HTMLElement) {disposeReaderDisplay(node);disposeInteractions(node); if(node.matches(".frontmatter")) disposeMetadataPanel(node);}
    node.remove();
  }
  if (!root.hasChildNodes()) {
    // Transfer the staging subtree in one native operation, retaining listeners.
    const range = document.createRange(); range.selectNodeContents(work);
    root.append(range.extractContents());
  } else {
    let cursor = root.firstChild;
    for (const entry of next) {if (entry.node === cursor) cursor = cursor.nextSibling; else root.insertBefore(entry.node,cursor);}
  }
  stopEngines();
  blockCaches.set(root, {key, blocks: next.filter(entry => entry.reusable).map(({raw,node}) => ({raw,node}))});
  clipboardBindings.get(root)?.();const stopClipboard=attachDomSemanticClipboard(root,{readOnly:()=>true,source:()=>source,profile:options.profile??'tegg'});clipboardBindings.set(root,stopClipboard);options.interactionSignal?.addEventListener('abort',stopClipboard,{once:true});
  sourceNodeRanges.set(root,{from:0,to:source.length});
  await enhanceDiagrams(root, options.contentState ?? "settled", options.scheduleDiagram, options.signal, diagrams);
}
