import {markdownDestination,markdownTitle,markdownLabel} from "./htmlToMarkdown";
import {parserFor} from "./markdownParser";
export type LinkDraft = {label:string;url:string;title?:string};
type LabelToken={type:string;content:string;children?:LabelToken[]|null};
function labelText(tokens:readonly LabelToken[]):string {
  return tokens.map(token=>["text","text_special","code_inline","html_inline"].includes(token.type)?token.content:
    token.type==="image"?labelText(token.children??[]):["softbreak","hardbreak"].includes(token.type)?"\n":"").join("");
}

function labelSource(original:string):string|null {
  const start=original.startsWith("![")?2:original.startsWith("[")?1:-1;if(start<0)return null;
  let depth=1;
  for(let position=start;position<original.length;position++){
    if(original[position]==="\\"){position++;continue;}
    if(original[position]==="`"){
      let end=position;while(original[end]==="`")end++;
      const count=end-position;let close=end;
      while((close=original.indexOf("`",close))>=0){let next=close;while(original[next]==="`")next++;if(next-close===count){position=next-1;break;}close=next;}
      if(close>=0)continue;
    }
    if(original[position]==="[")depth++;
    else if(original[position]==="]"){depth--;if(depth===0)return original[position+1]==="("?original.slice(start,position):null;}
  }
  return null;
}

/** Parse actual Markdown semantics, including entities, balanced destinations and all title delimiters. */
export function readLinkDraft(original:string):LinkDraft|null {
  if(typeof original!=="string"||original.length>65_536||labelSource(original)===null)return null;
  const parser=parserFor("gfm"),tokens=parser.parseInline(original,{})[0]?.children??[];
  if(original.startsWith("!")){
    if(tokens.length!==1||tokens[0].type!=="image")return null;
    const token=tokens[0],title=token.attrGet("title");
    return {label:labelText(token.children??[]),url:token.attrGet("src")??"",...(title!==null?{title}:{})};
  }
  if(tokens[0]?.type!=="link_open"||tokens.at(-1)?.type!=="link_close"||tokens.slice(1,-1).some(token=>token.type==="link_open"||token.type==="link_close"))return null;
  const title=tokens[0].attrGet("title");
  return {label:labelText(tokens.slice(1,-1)),url:tokens[0].attrGet("href")??"",...(title!==null?{title}:{})};
}
function serialize(fields:LinkDraft,image:boolean,original?:string):string {
  if(typeof fields.label!=="string"||typeof fields.url!=="string"||(fields.title!==undefined&&typeof fields.title!=="string"))throw new TypeError("Link fields must be text");
  const previous=original?readLinkDraft(original):null;
  if(original&&(!previous||original.startsWith("!")!==image))throw new Error("Use a source draft for reference-style or unsupported links.");
  if(previous&&previous.label===fields.label&&previous.url===fields.url&&previous.title===fields.title)return original!;
  const label=previous?.label===fields.label?labelSource(original!)!:markdownLabel(fields.label);
  const destination=fields.url===""?"":markdownDestination(fields.url);
  return (image?"!":"")+"["+label+"]("+destination+(fields.title!==undefined?" "+markdownTitle(fields.title):"")+")";
}
export function serializeLinkDraft(fields:LinkDraft,original?:string):string{return serialize(fields,false,original);}
export function serializeImageReference(reference:string,alt:string,title?:string,original?:string):string{return serialize({url:reference,label:alt,...(title!==undefined?{title}:{})},true,original);}
/** Remove only an inline link wrapper; preserve the original label Markdown verbatim. */
export function unwrapLinkDraft(original:string):string|null{return !original.startsWith("!")&&readLinkDraft(original)?labelSource(original):null;}
