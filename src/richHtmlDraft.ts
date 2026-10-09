import {isRenderedClipboardOpaque,registerRenderedClipboardOpaque} from './renderedSourceClipboard';
import {htmlSourceNodes,type HtmlSourceNode} from './htmlTableEditing';
import {sanitizeRenderedHtml} from './renderKit';

type Origin={raw:string;text?:string;open?:string;close?:string;atomic?:boolean;kind?:'image'|'link'|'math'};
const editableTags=new Set(['p','div','span','strong','b','em','i','u','s','del','mark','sub','sup','code','pre','br','ul','ol','li','blockquote','h1','h2','h3','h4','h5','h6','a','details','summary','figure','figcaption']);
const escapeText=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
/** Keep source tags, attributes, entities and invisible comments while editing rendered text. */
export function sourcePreservingHtmlDraft(root:HTMLElement,source:string) {
  const origins=new WeakMap<Node,Origin>();let changed=false;
  const decoded=(raw:string)=>{const template=document.createElement('template');template.innerHTML=raw;return template.content.textContent??'';};
  function contents(parent:HTMLElement,nodes:HtmlSourceNode[],from:number,to:number) {
    let cursor:ChildNode|null=parent.firstChild,offset=from;
    const text=(end:number)=>{
      while(cursor instanceof HTMLElement&&isRenderedClipboardOpaque(cursor))cursor=cursor.nextSibling;
      const raw=source.slice(offset,end);if(!raw)return;
      for(const part of raw.match(/<!--[\s\S]*?-->|[\s\S]+?(?=<!--|$)/g)??[]) {
        if(part.startsWith('<!--')) {const marker=document.createComment('source-comment');origins.set(marker,{raw:part,atomic:true});parent.insertBefore(marker,cursor);continue;}
        const value=decoded(part);if(!value)continue;
        while(cursor instanceof HTMLElement&&isRenderedClipboardOpaque(cursor))cursor=cursor.nextSibling;
        if(!(cursor instanceof Text)||!cursor.data.startsWith(value))throw new Error('This rich cell contains an unsupported projection. Its source is preserved.');
        if(cursor.data.length>value.length)cursor.splitText(value.length);
        origins.set(cursor,{raw:part,text:cursor.data});cursor=cursor.nextSibling;
      }
    };
    for(const node of nodes) {
      text(node.from);
      while(cursor instanceof HTMLElement&&isRenderedClipboardOpaque(cursor))cursor=cursor.nextSibling;
      const raw=source.slice(node.from,node.to);
      if(!(cursor instanceof HTMLElement)||cursor.tagName.toLowerCase()!==node.name){
        // Sanitization can remove an opaque object or unwrap it. Keep its exact
        // original bytes at this boundary; adjacent mapped text stays editable.
        const template=document.createElement('template');template.innerHTML=sanitizeRenderedHtml(raw);
        const projected=Array.from(template.content.childNodes);let next=cursor;
        const matches=projected.every(expected=>{const actual=next;if(!actual)return false;const same=expected instanceof HTMLElement?actual instanceof HTMLElement&&expected.tagName===actual.tagName&&expected.textContent===actual.textContent:expected.nodeType===actual.nodeType&&expected.textContent===actual.textContent;if(same)next=actual.nextSibling;return same;});
        if(!matches)throw new Error('This rich cell contains an unsupported projection. Its source is preserved.');
        if(projected.length){const opaque=document.createElement('span');opaque.setAttribute('contenteditable','false');opaque.style.display='contents';origins.set(opaque,{raw,atomic:true});parent.insertBefore(opaque,cursor);while(cursor!==next){const current=cursor!;cursor=current.nextSibling;opaque.append(current);}}
        else{const marker=document.createComment('source-opaque');origins.set(marker,{raw,atomic:true});parent.insertBefore(marker,cursor);}
        cursor=next;offset=node.to;continue;
      }
      const element=cursor,atomic=!editableTags.has(node.name)||Object.hasOwn(node.attributes,'data-tegg-math');const kind=node.name==='img'?'image':node.name==='a'?'link':Object.hasOwn(node.attributes,'data-tegg-math')?'math':undefined;
      origins.set(element,{raw,open:source.slice(node.from,node.openTo),close:source.slice(node.closeFrom,node.to),atomic,kind});
      if(atomic)element.contentEditable='false';else contents(element,node.children,node.openTo,node.closeFrom);
      cursor=element.nextSibling;offset=node.to;
    }
    text(to);
    while(cursor instanceof HTMLElement&&isRenderedClipboardOpaque(cursor))cursor=cursor.nextSibling;
    if(cursor)throw new Error('This rich cell has a projection that cannot be written back safely.');
  }
  contents(root,htmlSourceNodes(source),0,source.length);
  // Native contenteditable may turn an untouched ordinary space next to an edit
  // into NBSP. Match only the unchanged prefix/suffix against the author text;
  // retain their original entity/whitespace bytes, including authored NBSP.
  function changedText(origin:Origin,value:string){
    const old=origin.text??'',equivalent=(a:string,b:string)=>a===b||a===' '&&b==='\u00a0';let first=0,last=0;
    while(first<old.length&&first<value.length&&equivalent(old[first],value[first]))first++;
    while(last<old.length-first&&last<value.length-first&&equivalent(old[old.length-last-1],value[value.length-last-1]))last++;
    const boundaries=new Map<number,number>([[0,0]]);let rawAt=0,decodedAt=0;
    while(rawAt<origin.raw.length){const entity=origin.raw[rawAt]==='&'?/^&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i.exec(origin.raw.slice(rawAt)):null,raw=entity?.[0]??(origin.raw.startsWith('\r\n',rawAt)?'\r\n':origin.raw[rawAt]),text=entity?decoded(raw):raw==='\r\n'?'\n':raw;rawAt+=raw.length;decodedAt+=text.length;boundaries.set(decodedAt,rawAt);}
    while(first&&!boundaries.has(first))first--;while(last&&!boundaries.has(old.length-last))last--;
    const before=boundaries.get(first)??0,after=boundaries.get(old.length-last)??origin.raw.length;
    return origin.raw.slice(0,before)+escapeText(value.slice(first,value.length-last))+origin.raw.slice(after);
  }
  function serialize(node:Node):string {
    const origin=origins.get(node);
    if(origin?.atomic)return origin.raw;
    if(node instanceof Text)return origin?.text!==undefined?changedText(origin,node.data):escapeText(node.data);
    if(node instanceof Comment)return origin?.raw??'';
    if(!(node instanceof HTMLElement))throw new Error('Unsupported cell input.');
    if(!origin&&isRenderedClipboardOpaque(node))return '';
    if(!origin&&node.dataset.teggTemporary==='true'&&!node.textContent&&!node.querySelector('img,pre,table,[data-tegg-math]'))return '';
    const name=node.tagName.toLowerCase();if(!editableTags.has(name)&&!origin)throw new Error('This inserted object needs an explicit source-aware operation.');
    const children=Array.from(node.childNodes).map(serialize).join('');
    if(origin)return origin.open+children+origin.close;
    // New rich-text markup is semantic only; no event handlers, fonts or styles.
    if(name==='br')return '<br>';
    let attributes='';if(name==='a') {const href=node.getAttribute('href')??'';if(!/^(?:https?:|mailto:|#|\.\.?\/)/i.test(href))throw new Error('This inserted link is not supported.');attributes=` href="${escapeText(href).replaceAll('"','&quot;')}"`;}
    return `<${name}${attributes}>${children}</${name}>`;
  }
  /** Replace explicit ordinary text input before a browser rewrites adjacent author spaces. */
  function insertMappedText(range:Range,value:string):boolean {
    const node=range.startContainer;if(!(node instanceof Text)||node!==range.endContainer||!root.contains(node)||origins.get(node)?.text===undefined)return false;
    for(let parent=node.parentElement;parent&&parent!==root;parent=parent.parentElement)if(origins.get(parent)?.atomic||isRenderedClipboardOpaque(parent))return false;
    const start=range.startOffset,end=range.endOffset;if(start<0||end<start||end>node.length)return false;
    node.replaceData(start,end-start,value);const selection=root.ownerDocument.getSelection(),caret=document.createRange();caret.setStart(node,start+value.length);caret.collapse(true);selection?.removeAllRanges();selection?.addRange(caret);changed=true;return true;
  }
  const sourceFor=(node:HTMLElement)=>origins.has(node)?serialize(node):undefined;
  function validateReplacement(node:HTMLElement,next:string){const origin=origins.get(node);if(!origin?.kind)throw new Error('This object has no safe source mapping.');const nodes=htmlSourceNodes(next),mapped=nodes[0];if(nodes.length!==1||mapped.from!==0||mapped.to!==next.length||mapped.name!==node.tagName.toLowerCase())throw new Error('The changed object must keep its mapped wrapper.');
    if(!origin.atomic&&next.slice(mapped.openTo,mapped.closeFrom)!==Array.from(node.childNodes).map(serialize).join(''))throw new Error('Edit rich display text in the document to preserve its formatting.');
    const template=document.createElement('template');template.innerHTML=sanitizeRenderedHtml(next,'',source=>source);const safe=template.content.firstElementChild;if(!safe||safe.tagName!==node.tagName)throw new Error('This changed object cannot be rendered safely.');return {origin,mapped,safe};
  }
  function replaceSource(node:HTMLElement,next:string){const {origin,mapped,safe}=validateReplacement(node,next);
    origin.raw=next;origin.open=next.slice(0,mapped.openTo);origin.close=next.slice(mapped.closeFrom);changed=true;
    for(const attribute of Array.from(node.attributes))if(!['class','contenteditable','tabindex','data-tex-source','data-render-state'].includes(attribute.name))node.removeAttribute(attribute.name);for(const attribute of Array.from(safe.attributes))node.setAttribute(attribute.name,attribute.value);
  }
  const objects=()=>Array.from(root.querySelectorAll<HTMLElement>('img,a,[data-tex-source],[data-tegg-math]')).filter(element=>!!origins.get(element)?.kind).map(element=>({element,kind:origins.get(element)!.kind!,source:sourceFor(element)!}));
  /** Preserve source attributes/entities in the partial clones made by a structural Range split. */
  function extractContents(range:Range){
    const starts=range.startContainer instanceof Text?{node:range.startContainer,offset:range.startOffset,raw:serialize(range.startContainer)}:undefined,ends=range.endContainer instanceof Text?{node:range.endContainer,offset:range.endOffset,raw:serialize(range.endContainer)}:undefined;
    const firstRaw=starts?rawOffset(starts.raw,starts.offset):undefined,lastRaw=ends?rawOffset(ends.raw,ends.offset):undefined;
    const key='data-tegg-draft-extract-'+crypto.randomUUID(),mapped=new Map<string,Origin>(),marked:HTMLElement[]=[];let serial=0;
    const common=range.commonAncestorContainer,container=common instanceof HTMLElement?common:common.parentElement;
    for(const node of container?[container,...container.querySelectorAll<HTMLElement>('*')]:[]){const origin=origins.get(node);if(!origin)continue;const id=String(serial++);mapped.set(id,origin);node.setAttribute(key,id);marked.push(node);}
    let fragment:DocumentFragment;try{fragment=range.extractContents();}finally{for(const node of marked)node.removeAttribute(key);}
    for(const node of fragment.querySelectorAll<HTMLElement>('['+key+']')){const origin=mapped.get(node.getAttribute(key)!);if(origin)origins.set(node,{...origin});node.removeAttribute(key);}
    const texts:Text[]=[],walker=document.createTreeWalker(fragment,NodeFilter.SHOW_TEXT);while(walker.nextNode())texts.push(walker.currentNode as Text);
    function rawOffset(raw:string,offset:number){let at=0,length=0;while(at<raw.length&&length<offset){const entity=raw[at]==='&'?/^&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i.exec(raw.slice(at)):null,value=entity?.[0]??(raw.startsWith('\r\n',at)?'\r\n':raw[at]);at+=value.length;length+=(entity?decoded(value):value==='\r\n'?'\n':value).length;}if(length!==offset)throw new Error('This structural split would divide a source entity.');return at;}
    if(starts&&ends?.node===starts.node){const node=texts.find(item=>!origins.has(item));if(node)origins.set(node,{raw:starts.raw.slice(firstRaw,lastRaw),text:node.data});}
    else{if(starts){const node=texts[0];if(node&&!origins.has(node))origins.set(node,{raw:starts.raw.slice(firstRaw),text:node.data});}if(ends){const node=texts.at(-1);if(node&&!origins.has(node))origins.set(node,{raw:ends.raw.slice(0,lastRaw),text:node.data});}}
    return fragment;
  }
  function cloneMapped(node:Node):Node {const copy=node.cloneNode(false),origin=origins.get(node);if(isRenderedClipboardOpaque(node))registerRenderedClipboardOpaque(copy);if(origin)origins.set(copy,{...origin});for(const child of node.childNodes)copy.appendChild(cloneMapped(child));return copy;}
  return {sourceFor,insertMappedText,validateReplacement,replaceSource,objects,extractContents,markChanged:()=>{changed=true;},serialize:()=>changed?Array.from(root.childNodes).map(serialize).join(''):source,
    snapshot:()=>{const children=Array.from(root.childNodes).map(cloneMapped),wasChanged=changed;return ()=>{root.replaceChildren(...children.map(cloneMapped));changed=wasChanged;};}};
}
