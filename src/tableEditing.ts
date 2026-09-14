import {parseMarkdownTable, serializeMarkdownTable, tableHasOverflow, type TableAlignment} from './table';
import type {SourcePatch} from './sourcePatch';

export type TablePosition = {row: number; column: number};
export type TableRectangle = {from: TablePosition; to: TablePosition};
export type TableOperation =
  | {type: 'cell'; at: TablePosition; value: string}
  | {type: 'insert-row'; index: number}
  | {type: 'delete-row'; index: number}
  | {type: 'insert-column'; index: number}
  | {type: 'delete-column'; index: number}
  | {type: 'align'; column: number; alignment: TableAlignment}
  | {type: 'paste'; at: TablePosition; cells: readonly (readonly string[])[]}
  | {type: 'delete-table'};
export const tableEditingLimits = Object.freeze({rows: 1000, columns: 100, cells: 10000, inputLength: 1_048_576});
export class TableEditingError extends Error {
  constructor(public readonly code: 'invalid-table' | 'invalid-range' | 'budget' | 'ambiguous-source' | 'delete-table-confirmation' | 'multiline-cell' | 'invalid-data', message: string) {super(message); this.name = 'TableEditingError';}
}
export type TableEditResult = {
  source: string; patches: SourcePatch[]; selection: TablePosition;
  requiresConfirmation: boolean; expansion?: {rows: number; columns: number};
};
function integer(value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) throw new TableEditingError('invalid-range', 'The table selection is no longer valid.');
}
function budget(rows: number, columns: number) {
  if (rows > tableEditingLimits.rows || columns > tableEditingLimits.columns || rows * columns > tableEditingLimits.cells) throw new TableEditingError('budget', 'The table is too large to edit here. The original input is still available.');
}
function cellValue(value: string) {
  if (typeof value !== 'string' || value.length > tableEditingLimits.inputLength) throw new TableEditingError('budget', 'The cell exceeds the editing budget.');
  if (/[\r\n]/.test(value)) throw new TableEditingError('multiline-cell', 'Multiple paragraphs do not fit in a GFM cell. Review a simplified paste first.');
  return value;
}
/** Coordinates include row zero, the header. The returned patches are relative to this table. */
export function applyTableOperation(source: string, operation: TableOperation, options: {allowExpansion?: boolean} = {}): TableEditResult {
  if (source.length > tableEditingLimits.inputLength) throw new TableEditingError('budget', 'The table source exceeds the editing budget.');
  const table = parseMarkdownTable(source);
  if (!table) throw new TableEditingError('invalid-table', 'This source is not a complete GFM table.');
  const rows = [table.headers, ...table.rows], width = table.headers.length;
  budget(rows.length, width);
  let selection: TablePosition = {row: 0, column: 0};
  if (operation.type !== 'cell' && operation.type !== 'align' && operation.type !== 'delete-table' && tableHasOverflow(table)) {
    throw new TableEditingError('ambiguous-source', 'This table contains extra source cells. Edit its source before changing its structure.');
  }
  switch (operation.type) {
    case 'cell': {
      integer(operation.at.row,0,rows.length-1); integer(operation.at.column,0,width-1);
      rows[operation.at.row][operation.at.column] = cellValue(operation.value); selection = operation.at; break;
    }
    case 'align': {
      integer(operation.column,0,width-1);
      if (![null,'left','center','right'].includes(operation.alignment)) throw new TableEditingError('invalid-data','Unknown column alignment.');
      table.alignments[operation.column] = operation.alignment; selection.column = operation.column; break;
    }
    case 'insert-row': {
      integer(operation.index,0,rows.length); budget(rows.length+1,width);
      rows.splice(operation.index,0,Array.from({length:width},()=>'')); selection.row=operation.index; break;
    }
    case 'delete-row': {
      integer(operation.index,0,rows.length-1);
      if (rows.length === 1) throw new TableEditingError('delete-table-confirmation','Deleting the last row requires Delete table.');
      rows.splice(operation.index,1); selection.row=Math.min(operation.index,rows.length-1); break;
    }
    case 'insert-column': {
      integer(operation.index,0,width); budget(rows.length,width+1);
      rows.forEach(row=>row.splice(operation.index,0,'')); table.alignments.splice(operation.index,0,null); selection.column=operation.index; break;
    }
    case 'delete-column': {
      integer(operation.index,0,width-1);
      if (width === 1) throw new TableEditingError('delete-table-confirmation','Deleting the last column requires Delete table.');
      rows.forEach(row=>row.splice(operation.index,1)); table.alignments.splice(operation.index,1); selection.column=Math.min(operation.index,width-2); break;
    }
    case 'paste': {
      integer(operation.at.row,0,rows.length-1); integer(operation.at.column,0,width-1);
      if (!operation.cells.length || !operation.cells.some(row=>row.length)) throw new TableEditingError('invalid-data','There are no table cells to paste.');
      budget(operation.cells.length,1);
      const count = operation.cells.reduce((max,row)=>Math.max(max,row.length),0);
      const nextRows=Math.max(rows.length,operation.at.row+operation.cells.length), nextColumns=Math.max(width,operation.at.column+count);
      budget(nextRows,nextColumns);
      let pastedLength=0;operation.cells.forEach(row=>row.forEach(value=>{cellValue(value);pastedLength+=value.length;if(pastedLength>tableEditingLimits.inputLength)throw new TableEditingError('budget','The pasted table text exceeds the input budget.');}));
      if ((nextRows>rows.length || nextColumns>width) && !options.allowExpansion) {
        return {source,patches:[],selection:operation.at,requiresConfirmation:true,expansion:{rows:nextRows,columns:nextColumns}};
      }
      while(rows.length<nextRows) rows.push(Array.from({length:nextColumns},()=>''));
      rows.forEach(row=>{while(row.length<nextColumns)row.push('');});
      while(table.alignments.length<nextColumns)table.alignments.push(null);
      operation.cells.forEach((row,r)=>{for(let c=0;c<count;c++)rows[operation.at.row+r][operation.at.column+c]=row[c]??'';});
      selection=operation.at; break;
    }
    case 'delete-table': return {source:'',patches:[{from:0,to:source.length,expected:source,insert:''}],selection,requiresConfirmation:false};
  }
  table.headers=rows[0]; table.rows=rows.slice(1);
  const next=serializeMarkdownTable(table);
  if(next.length>tableEditingLimits.inputLength)throw new TableEditingError('budget','The resulting table exceeds the editing budget.');
  let from=0,oldEnd=source.length,newEnd=next.length;
  while(from<oldEnd && from<newEnd && source[from]===next[from])from++;
  while(oldEnd>from && newEnd>from && source[oldEnd-1]===next[newEnd-1]){oldEnd--;newEnd--;}
  return {source:next,patches:source===next?[]:[{from,to:oldEnd,expected:source.slice(from,oldEnd),insert:next.slice(from,newEnd)}],selection,requiresConfirmation:false};
}
export function tableRectangle(source: string, rectangle: TableRectangle): string[][] {
  if(source.length>tableEditingLimits.inputLength)throw new TableEditingError('budget','The table source exceeds the editing budget.');
  const table=parseMarkdownTable(source); if(!table)throw new TableEditingError('invalid-table','The table is no longer available.');
  const rows=[table.headers,...table.rows],top=Math.min(rectangle.from.row,rectangle.to.row),bottom=Math.max(rectangle.from.row,rectangle.to.row),left=Math.min(rectangle.from.column,rectangle.to.column),right=Math.max(rectangle.from.column,rectangle.to.column);
  budget(rows.length,table.headers.length);
  integer(top,0,rows.length-1);integer(bottom,top,rows.length-1);integer(left,0,table.headers.length-1);integer(right,left,table.headers.length-1);
  return rows.slice(top,bottom+1).map(row=>row.slice(left,right+1));
}
export function serializeDelimitedData(cells: readonly (readonly string[])[], delimiter: '\t' | ',' = '\t') {
  return cells.map(row=>row.map(value=>value.includes(delimiter)||/[\r\n"]/.test(value)?'"'+value.replaceAll('"','""')+'"':value).join(delimiter)).join('\n');
}
export function copyTableRectangle(source: string, rectangle: TableRectangle) {return serializeDelimitedData(tableRectangle(source,rectangle));}
/** RFC-style quoted fields; callers must explicitly choose CSV rather than guess commas. */
export function parseDelimitedData(text: string, delimiter: '\t' | ',' = '\t'): string[][] {
  if(text.length>tableEditingLimits.inputLength)throw new TableEditingError('budget','The pasted table exceeds the input budget.');
  const rows:string[][]=[],row:string[]=[];let value='',quoted=false,closed=false;
  const field=()=>{if(row.length>=tableEditingLimits.columns)throw new TableEditingError('budget','The pasted table exceeds the column budget.');row.push(value);value='';closed=false;};
  const line=()=>{field();rows.push(row.splice(0));budget(rows.length,Math.max(...rows.map(r=>r.length)));};
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(quoted){if(ch==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=ch;continue;}
    if(ch==='"' && !value && !closed){quoted=true;continue;}
    if(ch===delimiter){field();continue;}
    if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n')i++;line();continue;}
    if(closed)throw new TableEditingError('invalid-data','Unexpected text after a quoted table field.');
    value+=ch;
  }
  if(quoted)throw new TableEditingError('invalid-data','A quoted table field is incomplete.');
  if(value||row.length||!rows.length||(!text.endsWith('\n')&&!text.endsWith('\r')))line();
  return rows;
}
export function nextTablePosition(source: string, current: TablePosition, direction: 1 | -1): {position: TablePosition; appendRow: boolean; exit: boolean} {
  const table=parseMarkdownTable(source);if(!table)throw new TableEditingError('invalid-table','The table is no longer available.');
  integer(current.row,0,table.rows.length);integer(current.column,0,table.headers.length-1);
  const index=current.row*table.headers.length+current.column+direction;
  if(index<0)return {position:current,appendRow:false,exit:true};
  return {position:{row:Math.floor(index/table.headers.length),column:index%table.headers.length},appendRow:index===(table.rows.length+1)*table.headers.length,exit:false};
}
