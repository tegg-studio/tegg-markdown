import {writeSemanticClipboard,readSemanticClipboard,tableClipboardType} from './clipboardTransport';
import {applySourcePatches,type SourcePatch} from './sourcePatch';
import {HtmlTableEditingError,applyHtmlTableOperation,parseHtmlTable,htmlTableRectangle,htmlTableSelectedCells,type HtmlTableModel} from './htmlTableEditing';
import {parseDelimitedData,serializeDelimitedData,tableEditingLimits,type TableRectangle} from './tableEditing';
import {sanitizeRenderedHtml} from './renderKit';
export const htmlTableClipboardType=tableClipboardType;
export type HtmlTableClipboardData={text:string;html?:string;structured?:string};
export type HtmlTableMatrix={version:1;rows:number;columns:number;cells:Array<{row:number;column:number;rowspan:number;colspan:number;kind:'td'|'th';html:string;attributes?:Record<string,string>}>};
export type HtmlTablePastePlan={source:string;patches:SourcePatch[];requiresConfirmation:boolean;expansion?:{rows:number;columns:number;addedRows:number;addedColumns:number;overwritten:TableRectangle}};
const escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function readable(html:string){const root=document.createElement('div');root.innerHTML=sanitizeRenderedHtml(html,'',source=>source);root.querySelectorAll('br').forEach(node=>node.replaceWith('\n'));root.querySelectorAll('p,li,pre,blockquote,h1,h2,h3,h4,h5,h6').forEach(node=>node.append('\n'));root.querySelectorAll('img').forEach(node=>node.replaceWith(node.getAttribute('alt')??''));return (root.textContent??'').replace(/\n$/,'');}
export function htmlTableCopy(model:HtmlTableModel,selection:TableRectangle){
 const range=htmlTableRectangle(model,selection),cells=htmlTableSelectedCells(model,range),rows=range.to.row-range.from.row+1,columns=range.to.column-range.from.column+1;
 const matrix:HtmlTableMatrix={version:1,rows,columns,cells:cells.map(cell=>({row:cell.row-range.from.row,column:cell.column-range.from.column,rowspan:cell.rowspan,colspan:cell.colspan,kind:cell.kind,html:cell.content,attributes:{...cell.attributes}}))};
 validMatrix(matrix);
 const values=Array.from({length:rows},()=>Array.from({length:columns},()=>''));for(const cell of matrix.cells)values[cell.row][cell.column]=readable(cell.html);
 const html='<table>'+Array.from({length:rows},(_,row)=>'<tr>'+matrix.cells.filter(cell=>cell.row===row).map(cell=>'<'+cell.kind+(cell.rowspan>1?' rowspan="'+cell.rowspan+'"':'')+(cell.colspan>1?' colspan="'+cell.colspan+'"':'')+'>'+sanitizeRenderedHtml(cell.html,'',source=>source)+'</'+cell.kind+'>').join('')+'</tr>').join('')+'</table>';
 return {text:serializeDelimitedData(values),html,structured:JSON.stringify(matrix)};
}
function validMatrix(value:unknown):HtmlTableMatrix{
 if(!value||typeof value!=='object')throw new Error('The structured table copy is damaged. Choose Paste plain text explicitly to use its text representation.');
 const m=value as HtmlTableMatrix;if(m.version!==1||!Number.isInteger(m.rows)||!Number.isInteger(m.columns)||m.rows<1||m.columns<1||m.rows>tableEditingLimits.rows||m.columns>tableEditingLimits.columns||m.rows*m.columns>tableEditingLimits.cells||!Array.isArray(m.cells))throw new Error('Invalid table matrix dimensions. Choose Paste plain text explicitly to use its text representation.');
 const grid=Array.from({length:m.rows},()=>Array.from({length:m.columns},()=>false));let total=0;
 for(const cell of m.cells){if(!cell||!['row','column','rowspan','colspan'].every(key=>Number.isInteger(cell[key as 'row'])&&cell[key as 'row']>=(key.endsWith('span')?1:0))||!['td','th'].includes(cell.kind)||typeof cell.html!=='string'||cell.row+cell.rowspan>m.rows||cell.column+cell.colspan>m.columns)throw new Error('Invalid structured table cell.');
  total+=cell.html.length;if(total>tableEditingLimits.inputLength)throw new Error('The clipboard exceeds the table editing budget.');
  for(let r=cell.row;r<cell.row+cell.rowspan;r++)for(let c=cell.column;c<cell.column+cell.colspan;c++){if(grid[r][c])throw new Error('Overlapping structured cells.');grid[r][c]=true;}
  if(/<(?:script|iframe|object|embed|style)\b|\son[a-z]+\s*=|(?:javascript|vbscript)\s*:/i.test(cell.html))throw new Error('This cell requires a reviewed content conversion.');
  if(cell.attributes!==undefined){if(!cell.attributes||typeof cell.attributes!=='object'||Array.isArray(cell.attributes)||Object.entries(cell.attributes).some(([name,value])=>typeof value!=='string'||/^on/i.test(name)||name==='srcdoc'))throw new Error('This cell has unsupported structured attributes.');}
 }
 if(grid.some(row=>row.some(value=>!value)))throw new Error('The structured table matrix contains uncovered slots.');return m;
}
export function readHtmlTablePaste(data:HtmlTableClipboardData&{plain?:boolean}):HtmlTableMatrix{
 if(!data.plain&&data.structured){if(data.structured.length>tableEditingLimits.inputLength)throw new Error('The clipboard exceeds the table editing budget.');return validMatrix(JSON.parse(data.structured));}
 if(!data.plain&&data.html){
  if(data.html.length>tableEditingLimits.inputLength)throw new Error('The clipboard exceeds the table editing budget.');
  const template=document.createElement('template');template.innerHTML=data.html;const table=template.content.querySelector('table');
  if(table){
   if(template.content.querySelectorAll('table').length!==1||[...template.content.childNodes].some(node=>node!==table&&!(node instanceof Text&&!node.textContent?.trim())&&!(node instanceof Comment)))throw new Error('This clipboard contains content outside the table. Review it before pasting.');
   const model=parseHtmlTable(table.outerHTML);return validMatrix({version:1,rows:model.rows.length,columns:model.columns,cells:model.cells.map(cell=>({row:cell.row,column:cell.column,rowspan:cell.rowspan,colspan:cell.colspan,kind:cell.kind,html:cell.content,attributes:{...cell.attributes}}))});
  }else if(template.content.childNodes.length){
   if(/<(?:script|iframe|object|embed|style)\b|\son[a-z]+\s*=|(?:javascript|vbscript)\s*:/i.test(data.html))throw new Error('This cell requires a reviewed content conversion.');
   const controlled=sanitizeRenderedHtml(data.html,'',source=>source),candidate=document.createElement('div');candidate.innerHTML=controlled;
   if(candidate.textContent!==template.content.textContent||template.content.querySelector('img')&&candidate.querySelectorAll('img').length!==template.content.querySelectorAll('img').length)throw new Error('This paste requires an explicit content conversion. Choose Paste plain text explicitly.');
   return validMatrix({version:1,rows:1,columns:1,cells:[{row:0,column:0,rowspan:1,colspan:1,kind:'td',html:controlled}]});
  }
 }
 const values=parseDelimitedData(data.text);const columns=values[0]?.length??1;if(values.some(row=>row.length!==columns))throw new Error('Clipboard rows have different lengths. Review missing cells before pasting.');
 return validMatrix({version:1,rows:values.length,columns,cells:values.flatMap((row,r)=>row.map((text,c)=>({row:r,column:c,rowspan:1,colspan:1,kind:'td' as const,html:escape(text).replace(/\r\n?|\n/g,'<br>')})))});
}
/** Existing tracks keep their roles, spans and source attributes; new tracks use the source-faithful model. */
export function prepareHtmlTablePaste(source:string,selection:TableRectangle,input:HtmlTableMatrix):HtmlTablePastePlan{
 const matrix=validMatrix(input),model=parseHtmlTable(source),range=htmlTableRectangle(model,selection),selected=htmlTableSelectedCells(model,range);
 const scalar=matrix.rows===1&&matrix.columns===1&&matrix.cells.length===1&&matrix.cells[0].rowspan===1&&matrix.cells[0].colspan===1;
 const rows=range.to.row-range.from.row+1,columns=range.to.column-range.from.column+1;
 if(!scalar&&selected.length>1&&(rows!==matrix.rows||columns!==matrix.columns))throw new HtmlTableEditingError('invalid-range','The selected range and clipboard matrix have different dimensions.');
 const finalRows=scalar?model.rows.length:Math.max(model.rows.length,range.from.row+matrix.rows),finalColumns=scalar?model.columns:Math.max(model.columns,range.from.column+matrix.columns);
 if(finalRows>tableEditingLimits.rows||finalColumns>tableEditingLimits.columns||finalRows*finalColumns>tableEditingLimits.cells)throw new HtmlTableEditingError('budget','The resulting table exceeds the editing budget.');
 let expanded=source;
 for(let c=model.columns;c<finalColumns;c++)expanded=applyHtmlTableOperation(expanded,{type:'insert-column',index:c}).source;
 for(let r=model.rows.length;r<finalRows;r++)expanded=applyHtmlTableOperation(expanded,{type:'insert-row',index:r}).source;
 const targetModel=parseHtmlTable(expanded),patches:SourcePatch[]=[];
 const replace=(target:typeof selected[number],html:string)=>{if(target.content!==html)patches.push({from:target.openTo,to:target.closeFrom,expected:target.content,insert:html});};
 if(scalar){selected.forEach(cell=>replace(cell,matrix.cells[0].html));}
 else{
  const anchor=range.from;
  for(const cell of matrix.cells){const target=targetModel.grid[anchor.row+cell.row][anchor.column+cell.column];if(target.row!==anchor.row+cell.row||target.column!==anchor.column+cell.column||target.rowspan!==cell.rowspan||target.colspan!==cell.colspan)throw new HtmlTableEditingError('invalid-range','Clipboard spans conflict with the target. Unmerge explicitly or review a structure conversion first.');replace(target,cell.html);}
  const final=htmlTableRectangle(targetModel,{from:anchor,to:{row:anchor.row+matrix.rows-1,column:anchor.column+matrix.columns-1}});
  if(final.from.row!==anchor.row||final.from.column!==anchor.column||final.to.row!==anchor.row+matrix.rows-1||final.to.column!==anchor.column+matrix.columns-1)throw new HtmlTableEditingError('invalid-range','The paste would cover only part of a merged cell.');
 }
 const result=applySourcePatches(expanded,patches),after=parseHtmlTable(result);
 if(after.rows.length!==targetModel.rows.length||after.columns!==targetModel.columns||after.cells.length!==targetModel.cells.length)throw new HtmlTableEditingError('invalid-table','Clipboard content must not alter surrounding table structure.');
 const requiresConfirmation=expanded!==source;
 return {source:result,patches:requiresConfirmation?[{from:0,to:source.length,expected:source,insert:result}]:patches,requiresConfirmation,...(requiresConfirmation?{expansion:{rows:finalRows,columns:finalColumns,addedRows:finalRows-model.rows.length,addedColumns:finalColumns-model.columns,overwritten:{from:range.from,to:{row:Math.min(model.rows.length-1,range.from.row+matrix.rows-1),column:Math.min(model.columns-1,range.from.column+matrix.columns-1)}}}}:{})};
}
export function htmlTablePaste(source:string,selection:TableRectangle,input:HtmlTableMatrix,options:{expand?:boolean}={}){
 const result=prepareHtmlTablePaste(source,selection,input);
 if(result.requiresConfirmation&&!options.expand)throw new HtmlTableEditingError('unsupported-structure','This paste extends beyond the table. Review the final tracks and span changes before expanding.');
 return {source:result.source,patches:result.patches};
}
export function writeHtmlTableClipboard(trigger:HTMLElement,data:ReturnType<typeof htmlTableCopy>,eventData?:Pick<DataTransfer,'setData'>){return writeSemanticClipboard(trigger,data,'table',eventData);}
export function readHtmlTableClipboard(trigger:HTMLElement,fallback?:HtmlTableClipboardData):Promise<HtmlTableClipboardData>{return readSemanticClipboard(trigger,'table',fallback);}
