import {serializeMarkdownTable} from './table';
import {tableEditingLimits} from './tableEditing';

export type PasteIssue = {code: string; message: string; requiresReview: boolean};
export type HTMLImage = {id: string; token: string; source: string; alt: string; title?: string};
export type HTMLConversion = {markdown: string; plainText: string; images: HTMLImage[]; cells?: string[][]; issues: PasteIssue[]};
export const htmlPasteLimits = Object.freeze({characters:1_048_576,nodes:20_000,depth:64});
export function markdownDestination(value: string) {
  const text=value.trim();
  if(!text || /[\u0000-\u0020\u007f]/.test(text.replaceAll(' ',''))) throw new Error('The link destination contains invalid characters.');
  if(/^(?:javascript|vbscript|data):/i.test(text))throw new Error('This link scheme cannot be pasted.');
  return '<'+text.replaceAll('&','&amp;').replaceAll('\\','%5C').replaceAll('<','%3C').replaceAll('>','%3E').replaceAll(' ','%20')+'>';
}
/** Entity encoding preserves title characters without JSON-only escapes or entity double decoding. */
export function markdownTitle(value: string) {
  return '"'+value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('\\','&#92;').replaceAll('\r','&#13;').replaceAll('\n','&#10;').replaceAll('\t','&#9;')+'"';
}
function escapeText(text: string) {return text.replaceAll('&','&amp;').replace(/([\\`*_\[\]<>~$=:^])/g,'\\$1').replace(/(^|\n)([ \t]*)([#>+\-]|\d+[.)])(?=\s)/g,'$1$2\\$3');}
/** Serialize a plain label without turning its punctuation or entity-like text into Markdown formatting. */
export function markdownLabel(value: string) {return escapeText(value.replace(/[\r\n]/g,' '));}
export function imageMarkdown(source: string, alt: string, title?: string) {
  return '!['+markdownLabel(alt)+']('+markdownDestination(source)+(title?' '+markdownTitle(title):'')+')';
}
/** Parses an inert template and never attaches external HTML to the live document. */
export function htmlToMarkdown(html: string): HTMLConversion {
  if(html.length>htmlPasteLimits.characters) return {markdown:'',plainText:html,images:[],issues:[{code:'html-budget',message:'HTML exceeds the conversion budget. Use the retained text or cancel.',requiresReview:true}]};
  if(typeof document==='undefined')throw new Error('HTML conversion requires a browser DOM.');
  const template=document.createElement('template');template.innerHTML=html;
  const images:HTMLImage[]=[],issues:PasteIssue[]=[];let count=0;
  const tableMatrices=new WeakMap<Element,string[][]>();
  const issue=(code:string,message:string,requiresReview=true)=>{if(!issues.some(item=>item.code===code))issues.push({code,message,requiresReview});};
  const active=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','LINK','META','BASE','NOSCRIPT']);
  const blocks=new Set(['P','DIV','SECTION','ARTICLE','HEADER','FOOTER','MAIN','ASIDE','ADDRESS','FIGURE','FIGCAPTION','DETAILS','SUMMARY']);
  const plain=(root:Node):string=>{
    // Use an explicit stack: deeply nested untrusted HTML must never overflow the JS call stack.
    const pending:(Node|string)[]=[root],parts:string[]=[];
    while(pending.length){
      const node=pending.pop()!;
      if(typeof node==='string'){parts.push(node);continue;}
      if(node.nodeType===3){parts.push(node.textContent??'');continue;}
      if(!(node instanceof Element||node.nodeType===11))continue;
      if(node instanceof Element){
        if(active.has(node.tagName))continue;
        if(node.tagName==='IMG'){parts.push(node.getAttribute('alt')??'');continue;}
        if(node.tagName==='BR'){parts.push('\n');continue;}
        if(blocks.has(node.tagName)||['TR','LI'].includes(node.tagName))pending.push('\n');
        else if(['TD','TH'].includes(node.tagName))pending.push('\t');
      }
      for(let child=node.lastChild;child;child=child.previousSibling)pending.push(child);
    }
    return parts.join('');
  };
  const rawText=plain(template.content).replace(/\n{3,}/g,'\n\n').trim();
  const walk=(node:Node,depth=0):string=>{
    if(++count>htmlPasteLimits.nodes||depth>htmlPasteLimits.depth)throw new Error('budget');
    if(node.nodeType===3)return escapeText((node.textContent??'').replace(/[\t\r\n ]+/g,' '));
    if(!(node instanceof Element))return '';
    const tag=node.tagName;
    if(active.has(tag)){issue('removed-active-content','Executable or styling elements were omitted.',false);return '';}
    const children=()=>Array.from(node.childNodes).map(child=>walk(child,depth+1)).join('');
    if(tag==='INPUT'&&node.getAttribute('type')?.toLowerCase()==='checkbox')return node.hasAttribute('checked')?'[x] ':'[ ] ';
    if(tag==='BR')return '  \n';
    if(tag==='HR')return '\n\n---\n\n';
    if(/^H[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+children().trim()+'\n\n';
    if(tag==='STRONG'||tag==='B')return '**'+children()+'**';
    if(tag==='EM'||tag==='I')return '*'+children()+'*';
    if(tag==='DEL'||tag==='S'||tag==='STRIKE')return '~~'+children()+'~~';
    if(tag==='U')return '<u>'+children()+'</u>';
    if(tag==='PRE'){
      const code=node.querySelector(':scope > code'),body=(code??node).textContent??'';
      const language=code?.className.match(/(?:^|\s)language-([\w+-]+)/)?.[1]??'';
      const fence='`'.repeat(Math.max(3,...(body.match(/`+/g)??[]).map(run=>run.length+1)));
      return '\n\n'+fence+language+'\n'+body.replace(/\n$/,'')+'\n'+fence+'\n\n';
    }
    if(tag==='CODE'){
      const body=(node.textContent??'').replace(/[\r\n]/g,' '),fence='`'.repeat(Math.max(1,...(body.match(/`+/g)??[]).map(run=>run.length+1)));
      const pad=body.startsWith('`')||body.endsWith('`')||(/^ .* $/.test(body)&&body.trim())?' ':'';
      return fence+pad+body+pad+fence;
    }
    if(tag==='A'){
      const label=children(),href=node.getAttribute('href');
      if(!href)return label;
      try{return '['+label+']('+markdownDestination(href)+(node.getAttribute('title')?' '+markdownTitle(node.getAttribute('title')!):'')+')';}
      catch{issue('unsafe-link','An unsupported link was retained as text.',false);return label;}
    }
    if(tag==='IMG'){
      const source=node.getAttribute('src')??'',alt=node.getAttribute('alt')??'',title=node.getAttribute('title')??undefined;
      if(!source){issue('missing-image','An image without a source was retained as its alternative text.');return escapeText(alt);}
      const id='html-image-'+crypto.randomUUID(),token='tegg-paste-resource-'+crypto.randomUUID();
      images.push({id,token,source,alt,title});return token;
    }
    if(tag==='BLOCKQUOTE')return '\n\n'+children().trim().split('\n').map(line=>'> '+line).join('\n')+'\n\n';
    if(tag==='UL'||tag==='OL'){
      let index=Number(node.getAttribute('start')??'1');if(!Number.isSafeInteger(index)||index<0)index=1;
      const lines=Array.from(node.children).filter(child=>child.tagName==='LI').map(li=>{
        const marker=tag==='UL'?'- ':String(index++)+'. ';
        const content=Array.from(li.childNodes).map(child=>walk(child,depth+1)).join('').trim();
        return marker+content.split('\n').map((line,i)=>i?' '.repeat(marker.length)+line:line).join('\n');
      });return '\n\n'+lines.join('\n')+'\n\n';
    }
    if(tag==='TABLE'){
      if(node.querySelector('table'))issue('nested-table','Nested tables are simplified and retain their text.');
      if(node.querySelector('[rowspan]:not([rowspan="1"]), [colspan]:not([colspan="1"])'))issue('merged-cells','Merged cells are simplified; their text is retained in the first cell.');
      const htmlRows=Array.from(node.querySelectorAll('tr')).filter(row=>row.closest('table')===node);
      if(htmlRows.length>tableEditingLimits.rows)throw new Error('budget');
      let cellCount=0;
      const rows=htmlRows.map(row=>{
        const htmlCells=Array.from(row.children).filter(cell=>cell.tagName==='TD'||cell.tagName==='TH');
        cellCount+=htmlCells.length;if(htmlCells.length>tableEditingLimits.columns||cellCount>tableEditingLimits.cells)throw new Error('budget');
        return htmlCells.map(cell=>{
        const value=Array.from(cell.childNodes).map(child=>walk(child,depth+1)).join('').trim();
        if(/[\r\n]/.test(value))issue('multiline-cells','Multiple lines in table cells are simplified to spaces.');
        return value.replace(/[\r\n]+/g,' ');
      });});
      if(!rows.length)return '';
      const width=Math.max(...rows.map(row=>row.length));rows.forEach(row=>{while(row.length<width)row.push('');});
      if(!width)return '';
      tableMatrices.set(node,rows);
      const firstRow=node.querySelector('tr'),hasHeader=!!firstRow?.querySelector('th');
      if(!hasHeader)issue('table-header','The first table row becomes the GFM header.');
      return '\n\n'+serializeMarkdownTable({headers:rows[0],rows:rows.slice(1),alignments:Array.from({length:width},()=>null)})+'\n\n';
    }
    if(['SVG','MATH','CANVAS','VIDEO','AUDIO','INPUT','TEXTAREA','SELECT'].includes(tag)){
      issue('unsupported-object','An object cannot be represented as portable Markdown. Review the retained text.');return escapeText(plain(node));
    }
    if(node.hasAttribute('style') && /(?:grid|flex|absolute|fixed|float\s*:)/i.test(node.getAttribute('style')??''))issue('layout','Page layout is simplified to document order.');
    if(!blocks.has(tag)&&!['SPAN','LI','SMALL','MARK','SUB','SUP','FONT','CENTER'].includes(tag))issue('unknown-element','Unsupported formatting is simplified to text.');
    const content=children();return blocks.has(tag)?'\n\n'+content.trim()+'\n\n':content;
  };
  let markdown='';
  try{markdown=Array.from(template.content.childNodes).map(node=>walk(node)).join('').replace(/[ \t]+\n/g,match=>match.includes('  ')?'  \n':'\n').replace(/\n{3,}/g,'\n\n').trim();}
  catch{issue('html-budget','HTML is too complex to convert. Use the retained text or cancel.');images.length=0;markdown=escapeText(rawText);}
  const onlyTable=template.content.children.length===1&&template.content.firstElementChild?.tagName==='TABLE';
  let cells:string[][]|undefined;
  if(onlyTable)cells=tableMatrices.get(template.content.firstElementChild!);
  return {markdown,plainText:rawText,images,cells,issues};
}
