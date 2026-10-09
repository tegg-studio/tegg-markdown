import {parserFor} from "./markdownParser";
import {htmlSourceNodes} from './htmlTableEditing';
import {applySourcePatches,type SourcePatch} from './sourcePatch';
import {readLinkDraft,serializeImageReference,serializeLinkDraft,type LinkDraft} from './objectDraft';
export type HtmlReferenceDraft=LinkDraft&{html:boolean;richLabel?:boolean;width?:string;height?:string};
const decoded=(value:string)=>{const node=document.createElement('textarea');node.innerHTML=value;return node.value;};
const escaped=(value:string,quote='"')=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll(quote,quote==='"'?'&quot;':'&#39;');
export function controlledImageSize(value:string){return /^(?:\d+(?:\.\d+)?%?)$/.test(value)&&Number.parseFloat(value)>0&&Number.parseFloat(value)<=100000;}
export function readReferenceObject(source:string,image:boolean):HtmlReferenceDraft|null{
 const markdown=readLinkDraft(source);if(markdown){const children=parserFor("gfm").parseInline(source,{})[0]?.children??[],rich=!image&&children.slice(1,-1).some(token=>!["text","text_special","softbreak"].includes(token.type));return {...markdown,html:false,...(rich?{richLabel:true}: {})};}
 try{const roots=htmlSourceNodes(source),node=roots[0];if(roots.length!==1||node.name!==(image?'img':'a')||node.from!==0||node.to!==source.length)return null;
 const template=document.createElement('template');template.innerHTML=source;const element=template.content.firstElementChild!;
 return {html:true,url:element.getAttribute(image?'src':'href')??'',label:image?element.getAttribute('alt')??'':element.textContent??'',...(element.hasAttribute('title')?{title:element.getAttribute('title')!}:{}),...(!image&&element.children.length?{richLabel:true}:{}),...(image&&element.hasAttribute('width')&&controlledImageSize(element.getAttribute('width')!)?{width:element.getAttribute('width')!}:{}),...(image&&element.hasAttribute('height')&&controlledImageSize(element.getAttribute('height')!)?{height:element.getAttribute('height')!}:{})};
 }catch{return null;}
}
/** Change an explicitly addressed attribute, retaining all other author bytes and quote style. */
export function changeHtmlAttribute(source:string,name:string,value:string|undefined):string{
 const node=htmlSourceNodes(source)[0];if(!node||node.from!==0||node.to!==source.length)throw new Error('This HTML object cannot be mapped safely.');
 const opening=source.slice(0,node.openTo),pattern=/\s+([^\s=<>\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s<>]+))?/g;let found:RegExpMatchArray|undefined;
 for(const match of opening.matchAll(pattern))if(match[1].toLowerCase()===name.toLowerCase()){if(found)throw new Error('Duplicate attributes need a source repair.');found=match;}
 if(found){const raw=found[2]??'',old=decoded(raw.replace(/^(["'])([\s\S]*)\1$/,'$2'));if(value===old)return source;if(value===undefined)return applySourcePatches(source,[{from:found.index!,to:found.index!+found[0].length,expected:found[0],insert:''}]);const quote=raw[0]==="'"?"'":'"',prefix=found[0].slice(0,found[0].length-raw.length),replacement=raw?prefix+quote+escaped(value,quote)+quote:found[0]+'='+quote+escaped(value,quote)+quote;return applySourcePatches(source,[{from:found.index!,to:found.index!+found[0].length,expected:found[0],insert:replacement}]);}
 if(value===undefined)return source;const at=opening.search(/\/?\s*>$/);if(at<0)throw new Error('This HTML opening cannot be mapped safely.');return applySourcePatches(source,[{from:at,to:at,insert:' '+name+'="'+escaped(value)+'"'}]);
}
export function serializeReferenceObject(fields:HtmlReferenceDraft,image:boolean,original:string):string{
 const previous=readReferenceObject(original,image);if(!previous)throw new Error('This reference cannot be edited safely.');if(!previous.html){if(!image&&previous.richLabel&&fields.label!==previous.label)throw new Error('Edit rich display text in the document to preserve its formatting.');return image?serializeImageReference(fields.url,fields.label,fields.title,original):serializeLinkDraft(fields,original);}
 if(!fields.url||/[\u0000-\u001f\u007f]/.test(fields.url)||/^(?:javascript|vbscript):/i.test(fields.url))throw new Error('Enter a supported destination.');
 let next=original;if(fields.url!==previous.url)next=changeHtmlAttribute(next,image?'src':'href',fields.url);if(fields.title!==previous.title)next=changeHtmlAttribute(next,'title',fields.title);
 if(image){if(fields.label!==previous.label)next=changeHtmlAttribute(next,'alt',fields.label);for(const name of ['width','height'] as const)if(fields[name]!==previous[name]){if(previous[name]===undefined||fields[name]===undefined||!controlledImageSize(fields[name]!))throw new Error('Change only an existing controlled image size.');next=changeHtmlAttribute(next,name,fields[name]);}}
 else if(fields.label!==previous.label){if(previous.richLabel)throw new Error('Edit rich display text in the document to preserve its formatting.');const node=htmlSourceNodes(next)[0],escapeText=(text:string)=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');next=applySourcePatches(next,[{from:node.openTo,to:node.closeFrom,expected:next.slice(node.openTo,node.closeFrom),insert:escapeText(fields.label)}]);}
 return next;
}
