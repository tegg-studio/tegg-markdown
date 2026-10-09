import {sanitizeRenderedHtml} from './renderKit';
import {serializeDelimitedData} from './tableEditing';
import type {MarkdownProfile} from './syntaxProfiles';
export type ContentClipboard={version:1;kind:'content';format:MarkdownProfile|'html';source:string;definitions?:string[]};
const budget=1_048_576;
export function readContentClipboard(raw:string):ContentClipboard {
 if(raw.length>budget)throw new Error('The semantic copy exceeds the input budget.');
 const value=JSON.parse(raw) as ContentClipboard;
 if(value?.version!==1||value.kind!=='content'||!['tegg','github','gfm','html'].includes(value.format)||typeof value.source!=='string'||value.source.length>budget)throw new Error('This semantic copy is damaged. Choose Paste plain text explicitly.');if(value.definitions!==undefined&&(!Array.isArray(value.definitions)||value.definitions.some(item=>typeof item!=='string'||!/^ {0,3}\[[^\]\n]+\]:/.test(item))||value.definitions.reduce((count,item)=>count+item.length,0)>budget))throw new Error('This semantic copy has damaged shared definitions. Choose Paste plain text explicitly.');return value;
}
export function controlledClipboardHtml(html:string){return sanitizeRenderedHtml(html,'',source=>source);}
/** No resource fetching or inferred object descriptions. */
export function readableClipboardText(root:ParentNode):string {
 const block=/^(P|DIV|SECTION|BLOCKQUOTE|H[1-6]|UL|OL|LI|FIGURE|DETAILS|SUMMARY|PRE|TABLE)$/;
 const read=(node:Node):string=>{
  if(node instanceof Text)return node.data;if(!(node instanceof Element))return '';
  if(node.matches('[data-tex-source],[data-tex]'))return node.getAttribute('data-tex-source')??node.getAttribute('data-tex')??'';
  if(node.tagName==='IMG')return node.getAttribute('alt')??'';if(node.tagName==='BR')return '\n';if(node.tagName==='PRE')return node.textContent??'';
  if(node.tagName==='TABLE'){const rows=Array.from(node.querySelectorAll('tr')).filter(row=>row.closest('table')===node);return serializeDelimitedData(rows.map(row=>Array.from(row.children).filter(cell=>cell.tagName==='TD'||cell.tagName==='TH').map(cell=>children(cell))));}
  return children(node);
 };
 const children=(node:ParentNode):string=>{
  const nodes=Array.from(node.childNodes),hasBlocks=nodes.some(node=>node instanceof Element&&block.test(node.tagName));let result='',previousBlock=false;
  for(const node of nodes){if(hasBlocks&&node instanceof Text&&!node.data.trim())continue;const nextBlock=node instanceof Element&&block.test(node.tagName),value=read(node);if(!value&&!(node instanceof Element&&node.tagName==='P'))continue;if(result&&(previousBlock||nextBlock)&&!result.endsWith('\n')&&!value.startsWith('\n'))result+='\n'+(node instanceof Element&&node.tagName==='LI'?'':'\n');result+=value;previousBlock=nextBlock;}return result;
 };return children(root);
}
