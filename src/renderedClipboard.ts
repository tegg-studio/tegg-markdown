import {mapRenderedClipboardRange,isRenderedClipboardOpaque} from './renderedSourceClipboard';
import {sourceSpanClipboard} from './sourceClipboardModel';
import {controlledClipboardHtml,readableClipboardText,type ContentClipboard} from './contentClipboardText';
import {writeSemanticClipboard,type SemanticClipboardData} from './clipboardTransport';
import type {MarkdownProfile} from './syntaxProfiles';
function report(root:HTMLElement,error:unknown){root.dispatchEvent(new CustomEvent('tegg-clipboard-error',{bubbles:true,detail:error instanceof Error?error.message:String(error)}));let notice=root.querySelector<HTMLElement>(':scope > .md-clipboard-status');if(!notice){notice=document.createElement('span');notice.className='md-clipboard-status';notice.setAttribute('role','status');root.append(notice);}notice.textContent=error instanceof Error?error.message:String(error);}
/** Clone only the actual selected author nodes. Generated UI ownership is kept
 * outside the document; author classes or data attributes never authorize removal. */
function clipboardRangeContents(range:Range):DocumentFragment {
 const doc=range.startContainer.ownerDocument!,fragment=doc.createDocumentFragment();
 const clone=(node:Node):Node|null=>{
  if(isRenderedClipboardOpaque(node)||!range.intersectsNode(node))return null;
  if(node instanceof Text){const from=node===range.startContainer?range.startOffset:0,to=node===range.endContainer?range.endOffset:node.length;return to>from?doc.createTextNode(node.data.slice(from,to)):null;}
  const copy=node.cloneNode(false);for(const child of node.childNodes){const selected=clone(child);if(selected)copy.appendChild(selected);}return copy;
 };
 const common=range.commonAncestorContainer;
 if(common instanceof Text){const selected=clone(common);if(selected)fragment.append(selected);}
 else if(!isRenderedClipboardOpaque(common))for(const child of common.childNodes){const selected=clone(child);if(selected)fragment.append(selected);}
 return fragment;
}
export function attachDomSemanticClipboard(root:HTMLElement,options:{readOnly?:()=>boolean;composing?:()=>boolean;current?:()=>boolean;changed?:()=>void;source?:()=>string;profile?:MarkdownProfile}={}):()=>void {
 let alive=true,version=0;const bump=()=>version++;root.addEventListener('input',bump,true);
 const handler=(event:ClipboardEvent)=>{
  if(event.target instanceof Element&&event.target.closest("input,textarea"))return;
  const selection=root.ownerDocument.getSelection();if(!selection?.rangeCount||selection.isCollapsed||!selection.anchorNode||!selection.focusNode||!root.contains(selection.anchorNode)||!root.contains(selection.focusNode))return;
  if(options.composing?.()){event.preventDefault();event.stopPropagation();return;}
  const cut=event.type==='cut';event.preventDefault();event.stopPropagation();if(cut&&options.readOnly?.())return;
  const range=selection.getRangeAt(0).cloneRange(),atVersion=version,original=root.innerHTML,clone=document.createElement('div');
  const generatedEndpoint=(node:Node)=>{for(let current:Node|null=node;current&&current!==root;current=current.parentNode)if(isRenderedClipboardOpaque(current))return true;return false;};if(generatedEndpoint(range.startContainer)||generatedEndpoint(range.endContainer))return;
  clone.append(clipboardRangeContents(range));
  // cloneContents excludes the common inline ancestor. Keep its real semantic
  // wrapper when the range stays inside it, including links and literal code.
  const common=range.commonAncestorContainer;for(let node=common instanceof Element?common:common.parentElement;node&&node!==root&&/^(?:STRONG|B|EM|I|U|S|DEL|MARK|SUB|SUP|CODE|A|SPAN)$/.test(node.tagName);node=node.parentElement){const copy=node.cloneNode(false) as HTMLElement;copy.append(...Array.from(clone.childNodes));clone.append(copy);}
  const start=range.startContainer instanceof Element?range.startContainer:range.startContainer.parentElement,pre=start?.closest('pre');if(pre&&root.contains(pre)&&pre.contains(range.endContainer)){const literal=document.createElement('pre'),code=document.createElement('code');code.textContent=range.toString();literal.append(code);clone.replaceChildren(literal);}
  const html=controlledClipboardHtml(clone.innerHTML);clone.innerHTML=html;let data:SemanticClipboardData={text:readableClipboardText(clone),html,structured:JSON.stringify({version:1,kind:'content',format:'html',source:html} satisfies ContentClipboard)};
  if(options.source){const source=options.source(),full=range.startContainer===root&&range.startOffset===0&&range.endContainer===root&&range.endOffset===root.childNodes.length,span=full?{from:0,to:source.length}:mapRenderedClipboardRange(root,range,source);if(source.length&&span)try{data=sourceSpanClipboard(source,span,options.profile??'tegg');}catch(error){report(root,error);return;}}
  void writeSemanticClipboard(root,data,'content',event.clipboardData??undefined).then(()=>{
   if(!cut)return;const current=root.ownerDocument.getSelection();if(!alive||version!==atVersion||root.innerHTML!==original||options.readOnly?.()||options.composing?.()||options.current?.()===false||!current?.rangeCount){report(root,'Copied, but not cut: the original selection changed or is no longer writable.');return;}
   const now=current.getRangeAt(0);if(now.startContainer!==range.startContainer||now.startOffset!==range.startOffset||now.endContainer!==range.endContainer||now.endOffset!==range.endOffset){report(root,'Copied, but not cut: the original selection changed.');return;}
   range.deleteContents();selection.removeAllRanges();selection.addRange(range);options.changed?.();root.dispatchEvent(new Event('input',{bubbles:true}));
  }).catch(error=>report(root,error));
 };root.addEventListener('copy',handler);root.addEventListener('cut',handler);return()=>{alive=false;root.removeEventListener('input',bump,true);root.removeEventListener('copy',handler);root.removeEventListener('cut',handler);};
}
