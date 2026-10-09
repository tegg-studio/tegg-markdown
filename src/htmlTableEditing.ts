import {applySourcePatches, type SourcePatch} from './sourcePatch';
import {tableEditingLimits, type TablePosition, type TableRectangle} from './tableEditing';

/** Source offsets refer to the original HTML, never its sanitized rendering. */
export type HtmlTableCell = {row:number; column:number; rowspan:number; colspan:number; kind:'td'|'th'; group:number; from:number; openTo:number; closeFrom:number; to:number; attributes:Record<string,string>; content:string};
export type HtmlTableRow = {from:number; openTo:number; closeFrom:number; to:number; group:number; cells:HtmlTableCell[]};
export type HtmlTableModel = {source:string; rows:HtmlTableRow[]; cells:HtmlTableCell[]; grid:HtmlTableCell[][]; columns:number; hasColumnDeclarations:boolean};
export class HtmlTableEditingError extends Error {
  constructor(public readonly code:'invalid-table'|'invalid-range'|'unsupported-structure'|'attribute-conflict'|'delete-table-confirmation'|'budget', message:string) {super(message);this.name='HtmlTableEditingError';}
}
function fail(code:HtmlTableEditingError['code'],message:string):never {throw new HtmlTableEditingError(code,message);}
export type HtmlSourceNode={name:string;from:number;openTo:number;closeFrom:number;to:number;parent?:HtmlSourceNode;children:HtmlSourceNode[];attributes:Record<string,string>};
const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
function attributes(tag:string) {
  const result:Record<string,string>={};
  const body=tag.replace(/^<\s*[\w:-]+/,'').replace(/\/?\s*>$/,'');
  const pattern=/([^\s=<>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>]+)))?/g;
  for(const match of body.matchAll(pattern)) {const name=match[1].toLowerCase();if(Object.hasOwn(result,name))fail('invalid-table','Duplicate HTML attributes cannot be edited safely.');result[name]=match[2]??match[3]??match[4]??'';}
  return result;
}
export function htmlSourceNodes(source:string):HtmlSourceNode[] {
  const roots:HtmlSourceNode[]=[],stack:HtmlSourceNode[]=[];
  const pattern=/<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][\w:-]*(?:[^<>"']|"[^"]*"|'[^']*')*>/g;
  for(const match of source.matchAll(pattern)) {
    const tag=match[0];if(tag.startsWith('<!'))continue;
    const name=/^<\/?([\w:-]+)/.exec(tag)![1].toLowerCase();
    if(tag.startsWith('</')) {
      const node=stack.pop();if(!node||node.name!==name)fail('invalid-table','This HTML uses implicit or mismatched closing tags. Its original content is preserved.');
      node.closeFrom=match.index!;node.to=match.index!+tag.length;continue;
    }
    const node:HtmlSourceNode={name,from:match.index!,openTo:match.index!+tag.length,closeFrom:match.index!+tag.length,to:match.index!+tag.length,parent:stack.at(-1),children:[],attributes:attributes(tag)};
    if(node.parent)node.parent.children.push(node);else roots.push(node);
    if(!voidTags.has(name)&&!tag.endsWith('/>'))stack.push(node);
  }
  if(stack.length)fail('invalid-table','The HTML table is incomplete.');return roots;
}
function span(cell:HtmlSourceNode,name:string) {
  const value=cell.attributes[name];if(value===undefined)return 1;
  if(!/^[1-9]\d*$/.test(value)||Number(value)>tableEditingLimits.rows)fail('unsupported-structure','Invalid or open-ended table spans need an explicit source repair.');return Number(value);
}
export function parseHtmlTable(source:string):HtmlTableModel {
  if(source.length>tableEditingLimits.inputLength)fail('budget','The HTML table exceeds the editing budget.');
  const roots=htmlSourceNodes(source),table=roots.find(node=>node.name==='table');
  if(!table||roots.length!==1||source.slice(0,table.from).replace(/<!--[\s\S]*?-->/g,'').trim()||source.slice(table.to).trim())fail('invalid-table','Expected one complete HTML table.');
  const rowNodes:HtmlSourceNode[]=table.children.flatMap(child=>child.name==='tr'?[child]:['thead','tbody','tfoot'].includes(child.name)?child.children.filter(node=>node.name==='tr'):[]);
  if(!rowNodes.length||rowNodes.length>tableEditingLimits.rows)fail('budget','The table has no editable rows or exceeds the row budget.');
  const rows:HtmlTableRow[]=rowNodes.map(row=>({from:row.from,openTo:row.openTo,closeFrom:row.closeFrom,to:row.to,group:row.parent!.from,cells:[]}));
  const cells:HtmlTableCell[]=[],grid:HtmlTableCell[][]=Array.from({length:rows.length},()=>[]);
  for(let r=0;r<rows.length;r++) {
    let c=0;
    for(const node of rowNodes[r].children) {
      if(node.name!=='td'&&node.name!=='th')fail('unsupported-structure','Unexpected row content cannot be rewritten as cells.');
      while(grid[r][c])c++;
      const rowspan=span(node,'rowspan'),colspan=span(node,'colspan');
      if(c+colspan>tableEditingLimits.columns||r+rowspan>rows.length)fail('budget','The table span exceeds the available tracks.');
      if(rows[r+rowspan-1].group!==rows[r].group)fail('unsupported-structure','A cell crosses HTML row groups.');
      const cell:HtmlTableCell={row:r,column:c,rowspan,colspan,kind:node.name as 'td'|'th',group:rows[r].group,from:node.from,openTo:node.openTo,closeFrom:node.closeFrom,to:node.to,attributes:node.attributes,content:source.slice(node.openTo,node.closeFrom)};
      for(let y=r;y<r+rowspan;y++)for(let x=c;x<c+colspan;x++){if(grid[y][x])fail('invalid-table','The HTML table contains overlapping cells.');grid[y][x]=cell;}
      rows[r].cells.push(cell);cells.push(cell);c+=colspan;
    }
  }
  const columns=Math.max(...grid.map(row=>row.length));
  if(!columns||rows.length*columns>tableEditingLimits.cells)fail('budget','The HTML table exceeds the cell budget.');
  if(grid.some(row=>row.length!==columns||Array.from({length:columns},(_,c)=>row[c]).some(cell=>!cell)))fail('unsupported-structure','The HTML grid contains uncovered slots.');
  return {source,rows,cells,grid,columns,hasColumnDeclarations:table.children.some(node=>node.name==='col'||node.name==='colgroup')};
}
function position(model:HtmlTableModel,at:TablePosition) {
  if(!Number.isInteger(at.row)||!Number.isInteger(at.column)||at.row<0||at.row>=model.rows.length||at.column<0||at.column>=model.columns)fail('invalid-range','The table selection is no longer valid.');return model.grid[at.row][at.column];
}
/** Recompute from the user's original anchor and endpoint so a range can shrink. */
export function htmlTableRectangle(model:HtmlTableModel,requested:TableRectangle) {
  position(model,requested.from);position(model,requested.to);
  let top=Math.min(requested.from.row,requested.to.row),bottom=Math.max(requested.from.row,requested.to.row),left=Math.min(requested.from.column,requested.to.column),right=Math.max(requested.from.column,requested.to.column),changed=true;
  while(changed){changed=false;for(const cell of model.cells){if(cell.row>bottom||cell.row+cell.rowspan-1<top||cell.column>right||cell.column+cell.colspan-1<left)continue;const next=[Math.min(top,cell.row),Math.max(bottom,cell.row+cell.rowspan-1),Math.min(left,cell.column),Math.max(right,cell.column+cell.colspan-1)];if(next[0]!==top||next[1]!==bottom||next[2]!==left||next[3]!==right){[top,bottom,left,right]=next;changed=true;}}}
  return {from:{row:top,column:left},to:{row:bottom,column:right}};
}
export function htmlTableSelectedCells(model:HtmlTableModel,range:TableRectangle) {
  const rect=htmlTableRectangle(model,range);return model.cells.filter(cell=>cell.row>=rect.from.row&&cell.row<=rect.to.row&&cell.column>=rect.from.column&&cell.column<=rect.to.column);
}
function changeAttribute(tag:string,name:string,value:number) {
  const pattern=new RegExp('\\s+'+name+'\\s*=\\s*(?:"[^\"]*"|\'[^\']*\'|[^\\s>]+)','i');
  if(pattern.test(tag))return tag.replace(pattern,value===1?'':` ${name}="${value}"`);
  return value===1?tag:tag.replace(/(\/?>)$/,` ${name}="${value}"$1`);
}
function structural(model:HtmlTableModel) {
  if(model.cells.some(cell=>Object.hasOwn(cell.attributes,'width')||Object.hasOwn(cell.attributes,'height')||/(?:^|;)\s*(?:width|height)\s*:/i.test(cell.attributes.style??'')))fail('unsupported-structure','Explicit cell dimensions need a reviewed mapping before changing tracks.');
  if(model.hasColumnDeclarations)fail('unsupported-structure','Column declarations need a reviewed dimension mapping before changing tracks.');
  if(model.cells.some(cell=>Object.hasOwn(cell.attributes,'headers')||Object.hasOwn(cell.attributes,'scope')))fail('unsupported-structure','Complex header associations need an explicit semantic mapping.');
}
export type HtmlTableOperation=
 | {type:'delete-table'}
 | {type:'cell';at:TablePosition;html:string}
 | {type:'clear';range:TableRectangle}
 | {type:'merge';range:TableRectangle}
 | {type:'unmerge';at:TablePosition}
 | {type:'insert-row'|'delete-row'|'insert-column'|'delete-column';index:number};
export function applyHtmlTableOperation(source:string,operation:HtmlTableOperation):{source:string;patches:SourcePatch[];selection:TablePosition} {
  const model=parseHtmlTable(source),patches:SourcePatch[]=[],insertions=new Map<number,string[]>();let selection:TablePosition={row:0,column:0};
  if(operation.type==='delete-table')return {source:'',patches:[{from:0,to:source.length,expected:source,insert:''}],selection};
  const patch=(from:number,to:number,insert:string)=>{if(source.slice(from,to)!==insert)patches.push({from,to,expected:source.slice(from,to),insert});};
  const insert=(at:number,value:string)=>{insertions.set(at,[...(insertions.get(at)??[]),value]);};
  const tag=(cell:HtmlTableCell,rowspan=cell.rowspan,colspan=cell.colspan)=>changeAttribute(changeAttribute(source.slice(cell.from,cell.openTo),'rowspan',rowspan),'colspan',colspan);
  const spans=(cell:HtmlTableCell,rowspan=cell.rowspan,colspan=cell.colspan)=>patch(cell.from,cell.openTo,tag(cell,rowspan,colspan));
  const rowInsertion=(row:number,column:number,value:string)=>insert(model.rows[row].cells.find(cell=>cell.column>=column)?.from??model.rows[row].closeFrom,value);
  if(operation.type==='cell') {const cell=position(model,operation.at);patch(cell.openTo,cell.closeFrom,operation.html);selection={row:cell.row,column:cell.column};}
  else if(operation.type==='clear'){const cells=htmlTableSelectedCells(model,operation.range);cells.forEach(cell=>patch(cell.openTo,cell.closeFrom,''));selection=operation.range.from;}
  else if(operation.type==='merge') {
    structural(model);const range=htmlTableRectangle(model,operation.range),cells=htmlTableSelectedCells(model,range),anchor=model.grid[range.from.row][range.from.column];
    if(cells.length<2)fail('invalid-range','Select at least two actual cells.');
    if(cells.some(cell=>cell.group!==anchor.group||cell.kind!==anchor.kind))fail('unsupported-structure','Merging must stay in one row group and preserve header identity.');
    const signature=(cell:HtmlTableCell)=>JSON.stringify(Object.entries(cell.attributes).filter(([key])=>!['rowspan','colspan','id'].includes(key)).sort(([a],[b])=>a.localeCompare(b)));
    if(cells.some(cell=>signature(cell)!==signature(anchor)||(cell!==anchor&&Object.hasOwn(cell.attributes,'id'))))fail('attribute-conflict','Selected cell attributes or unique identifiers conflict.');
    const content=cells.filter(cell=>cell.content.trim()).map(cell=>cell.content),block=content.some(html=>/<(?:p|ul|ol|div|pre|blockquote|table|h[1-6])(?:\s|>)/i.test(html));
    spans(anchor,range.to.row-range.from.row+1,range.to.column-range.from.column+1);patch(anchor.openTo,anchor.closeFrom,content.join(block?'':'<br>'));cells.filter(cell=>cell!==anchor).forEach(cell=>patch(cell.from,cell.to,''));selection={row:anchor.row,column:anchor.column};
  } else if(operation.type==='unmerge') {
    structural(model);const cell=position(model,operation.at);if(cell.rowspan===1&&cell.colspan===1)fail('invalid-range','This cell is not merged.');spans(cell,1,1);
    const blank=tag(cell,1,1).replace(/\s+id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/ig,'')+`</${cell.kind}>`;
    for(let r=cell.row;r<cell.row+cell.rowspan;r++)for(let c=cell.column;c<cell.column+cell.colspan;c++)if(r!==cell.row||c!==cell.column){if(r===cell.row)insert(cell.to,blank);else rowInsertion(r,c,blank);}selection={row:cell.row,column:cell.column};
  } else {
    structural(model);const rowOperation=operation.type.endsWith('row'),inserting=operation.type.startsWith('insert'),size=rowOperation?model.rows.length:model.columns,index=operation.index;
    if(!Number.isInteger(index)||index<0||index>size-(inserting?0:1))fail('invalid-range','The requested track is no longer available.');
    if(!inserting&&size===1)fail('delete-table-confirmation','Deleting the last track requires an explicit Delete table action.');
    if(inserting&&(rowOperation?(size+1)*model.columns:model.rows.length*(size+1))>tableEditingLimits.cells)fail('budget','The resulting table exceeds the editing budget.');
    if(rowOperation&&inserting) {
      const group=model.rows[Math.min(index,size-1)].group;
      const covering=model.cells.filter(cell=>cell.group===group&&cell.row<index&&cell.row+cell.rowspan>index);covering.forEach(cell=>spans(cell,cell.rowspan+1));
      const ref=model.rows[Math.min(index,size-1)];let content='';for(let c=0;c<model.columns;c++)if(!covering.some(cell=>c>=cell.column&&c<cell.column+cell.colspan)){const kind=model.grid[Math.min(index,size-1)][c].kind;content+=`<${kind}></${kind}>`;}
      insert(index<size?ref.from:ref.to,`<tr>${content}</tr>`);selection={row:index,column:0};
    } else if(rowOperation) {
      const removed=model.rows[index];patch(removed.from,removed.to,'');
      for(const cell of model.cells) {
        if(cell.row<index&&cell.row+cell.rowspan>index)spans(cell,cell.rowspan-1);
        else if(cell.row===index&&cell.rowspan>1)rowInsertion(index+1,cell.column,tag(cell,cell.rowspan-1)+source.slice(cell.openTo,cell.to));
      }selection={row:Math.min(index,size-2),column:0};
    } else if(inserting) {
      const covering=model.cells.filter(cell=>cell.column<index&&cell.column+cell.colspan>index);covering.forEach(cell=>spans(cell,cell.rowspan,cell.colspan+1));
      for(let r=0;r<model.rows.length;r++)if(!covering.some(cell=>r>=cell.row&&r<cell.row+cell.rowspan)){const kind=model.grid[r][Math.min(index,size-1)].kind;rowInsertion(r,index,`<${kind}></${kind}>`);}selection={row:0,column:index};
    } else {
      for(const cell of model.cells)if(index>=cell.column&&index<cell.column+cell.colspan){if(cell.colspan>1)spans(cell,cell.rowspan,cell.colspan-1);else patch(cell.from,cell.to,'');}selection={row:0,column:Math.min(index,size-2)};
    }
  }
  for(const [at,values]of insertions)patch(at,at,values.join(''));
  const next=applySourcePatches(source,patches),after=parseHtmlTable(next);
  if(operation.type==='cell'&&(after.rows.length!==model.rows.length||after.columns!==model.columns||after.cells.length!==model.cells.length))fail('invalid-table','Cell input must not change the surrounding table structure.');
  return {source:next,patches,selection};
}
