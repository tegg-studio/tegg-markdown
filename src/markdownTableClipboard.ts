import {parseMarkdownTable,tableHasOverflow} from './table';
import {parserFor} from './markdownParser';
import {htmlToMarkdown,imageMarkdown} from './htmlToMarkdown';
import {controlledClipboardHtml} from './contentClipboard';
import {parseHtmlTable,applyHtmlTableOperation} from './htmlTableEditing';
import {htmlTableCopy,readHtmlTablePaste,prepareHtmlTablePaste,type HtmlTableClipboardData} from './htmlTableClipboard';
import {applyTableOperation,tableRectangle,type TableRectangle,type TablePosition} from './tableEditing';
export function markdownTableHtml(source:string,documentSource=source){
 const table=parseMarkdownTable(source);if(!table||tableHasOverflow(table))throw new Error('This table has ambiguous source cells. Check its source before converting it.');const parser=parserFor('tegg'),env={};parser.parse(documentSource,env);
 return '<table>\n'+[table.headers,...table.rows].map((row,index)=>'<tr>'+row.map((value,c)=>{const tag=index===0?'th':'td',align=table.alignments[c];return '<'+tag+(align?' align="'+align+'"':'')+'>'+controlledClipboardHtml(parser.renderInline(value,env))+'</'+tag+'>';}).join('')+'</tr>').join('\n')+'\n</table>';
}
export function markdownTableCopy(source:string,range:TableRectangle,documentSource=source){return htmlTableCopy(parseHtmlTable(markdownTableHtml(source,documentSource)),range);}
export type MarkdownTablePastePlan={source:string;requiresConfirmation:boolean;message?:string};
export function prepareMarkdownTablePaste(source:string,range:TableRectangle,data:HtmlTableClipboardData&{plain?:boolean},documentSource=source):MarkdownTablePastePlan{
 const table=parseMarkdownTable(source);if(!table)throw new Error('The table source changed. Paste again.');
 const matrix=readHtmlTablePaste(data),rows=matrix.rows,columns=matrix.columns;
 const rich=matrix.cells.some(cell=>cell.rowspan!==1||cell.colspan!==1||/<(?:p|div|ul|ol|li|blockquote|pre|h[1-6]|figure|details|table)\b/i.test(cell.html));
 if(rich){const conversion=prepareHtmlTablePaste(markdownTableHtml(source,documentSource),range,matrix);return {source:conversion.source,requiresConfirmation:true,message:'This content requires converting the entire GFM table to HTML. Existing rows, columns, header roles, alignment and cell formatting are retained. Conversion and paste form one Undo step.'};}
 const html='<table>'+Array.from({length:rows},(_,r)=>'<tr>'+matrix.cells.filter(cell=>cell.row===r).sort((a,b)=>a.column-b.column).map(cell=>'<td>'+cell.html+'</td>').join('')+'</tr>').join('')+'</table>',converted=htmlToMarkdown(html);
 if(converted.issues.some(issue=>issue.requiresReview&&issue.code!=='table-header')||!converted.cells)throw new Error('This content cannot be inserted without a reviewed conversion. Choose Paste plain text explicitly.');
 const selected=tableRectangle(source,range),height=selected.length,width=selected[0].length,anchor={row:Math.min(range.from.row,range.to.row),column:Math.min(range.from.column,range.to.column)};
 let cells=converted.cells;
 for(const image of converted.images){if(/^(?:data:|blob:|file:)/i.test(image.source))throw new Error('This image needs a persistent resource reference before pasting. The original table is retained.');const value=imageMarkdown(image.source,image.alt,image.title);cells=cells.map(row=>row.map(cell=>cell.replaceAll(image.token,value)));}
 if(rows===1&&columns===1)cells=Array.from({length:height},()=>Array.from({length:width},()=>cells[0][0]));
 else if(height*width>1&&(height!==rows||width!==columns))throw new Error('The selected range and clipboard matrix have different dimensions.');
 const plan=applyTableOperation(source,{type:'paste',at:anchor,cells}),result=plan.requiresConfirmation?applyTableOperation(source,{type:'paste',at:anchor,cells},{allowExpansion:true}):plan;
 return {source:result.source,requiresConfirmation:plan.requiresConfirmation,...(plan.requiresConfirmation?{message:'This paste expands the table to '+plan.expansion!.rows+' rows and '+plan.expansion!.columns+' columns. '+Math.min(rows,table.rows.length+1-anchor.row)*Math.min(columns,table.headers.length-anchor.column)+' existing cells will be overwritten. Review the resulting table before applying it.'}:{})};
}
export function convertMarkdownTable(source:string,operation:{type:'merge';rectangle:TableRectangle}|{type:'paragraph';at:TablePosition;before:string;after:string;empty?:boolean},documentSource=source){
 const html=markdownTableHtml(source,documentSource);
 if(operation.type==='merge')return applyHtmlTableOperation(html,{type:'merge',range:operation.rectangle}).source;
 const parser=parserFor('tegg'),env={};parser.parse(documentSource,env);
 const render=(text:string)=>controlledClipboardHtml(parser.renderInline(text,env));
 const content=(operation.before?'<p>'+render(operation.before)+'</p>':'')+(operation.empty?'<p><br></p>':'')+(operation.after?'<p>'+render(operation.after)+'</p>':operation.empty?'':'<p><br></p>');
 return applyHtmlTableOperation(html,{type:'cell',at:operation.at,html:content}).source;
}
