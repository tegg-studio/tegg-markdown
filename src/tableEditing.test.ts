import {describe,it,expect} from 'vitest';
import {applySourcePatches} from './sourcePatch';
import {applyTableOperation,copyTableRectangle,parseDelimitedData,serializeDelimitedData,nextTablePosition} from './tableEditing';
import {parseMarkdownTable,serializeMarkdownTable} from './table';
const source='| Name  | Value |\r\n| :------ | ---: |\r\n| cat | old |\r\n| dog | 2 |\r\n';
describe('bounded table transactions',()=>{
  it('changes only a cell and its allowed source range',()=>{
    const result=applyTableOperation(source,{type:'cell',at:{row:1,column:1},value:'新🐈'});
    expect(result.source).toBe(source.replace(' old ',' 新🐈 '));expect(applySourcePatches(source,result.patches)).toBe(result.source);
    expect(result.patches).toEqual([{from:source.indexOf('old'),to:source.indexOf('old')+3,expected:'old',insert:'新🐈'}]);
  });
  it('updates only the chosen delimiter while retaining width and other rows',()=>{
    const result=applyTableOperation(source,{type:'align',column:1,alignment:'center'});
    expect(result.source).toBe(source.replace(' ---: ',' :---: '));expect(parseMarkdownTable(result.source)?.alignments).toEqual(['left','center']);
  });
  it('preserves CRLF and trailing newline during structural operations',()=>{
    const added=applyTableOperation(source,{type:'insert-row',index:2}).source;
    expect(added.endsWith('\r\n')).toBe(true);expect(added.replaceAll('\r\n','')).not.toContain('\n');
    expect(parseMarkdownTable(added)?.rows).toEqual([['cat','old'],['',''],['dog','2']]);
    const column=applyTableOperation(source,{type:'insert-column',index:1}).source;
    expect(parseMarkdownTable(column)?.headers).toEqual(['Name','','Value']);
    expect(parseMarkdownTable(applyTableOperation(column,{type:'delete-column',index:1}).source)?.headers).toEqual(['Name','Value']);
  });
  it('requires explicit expansion and applies a rectangle atomically',()=>{
    const operation={type:'paste' as const,at:{row:2,column:1},cells:[['a','b'],['c']]};
    expect(applyTableOperation(source,operation)).toMatchObject({source,patches:[],requiresConfirmation:true,expansion:{rows:4,columns:3}});
    const result=applyTableOperation(source,operation,{allowExpansion:true});
    expect(parseMarkdownTable(result.source)?.rows).toEqual([['cat','old',''],['dog','a','b'],['','c','']]);
    expect(applySourcePatches(source,result.patches)).toBe(result.source);
  });
  it('does not silently delete the final column or ignored source cells',()=>{
    expect(()=>applyTableOperation('| A |\n| --- |',{type:'delete-column',index:0})).toThrow('Delete table');
    expect(()=>applyTableOperation('| A |\n| --- |\n| one | secret |',{type:'insert-row',index:1})).toThrow('extra source cells');
  });
  it('materializes a missing legal GFM cell rather than dropping its edit',()=>{
    const result=applyTableOperation('| A | B |\n| --- | --- |\n| one |',{type:'cell',at:{row:1,column:1},value:'two'});
    expect(result.source).toBe('| A | B |\n| --- | --- |\n| one | two |');
  });
  it('copies a bounded selection and handles quoted delimiter data',()=>{
    expect(copyTableRectangle(source,{from:{row:2,column:1},to:{row:1,column:0}})).toBe('cat\told\ndog\t2');
    const values=[['A\tB','"quoted"'],['one\ntwo','']];expect(parseDelimitedData(serializeDelimitedData(values))).toEqual(values);
    expect(()=>parseDelimitedData('"unfinished')).toThrow('incomplete');
  });
  it('navigates headers, wraps rows and identifies the explicit final-row insertion',()=>{
    expect(nextTablePosition(source,{row:0,column:0},-1).exit).toBe(true);
    expect(nextTablePosition(source,{row:1,column:1},1)).toEqual({position:{row:2,column:0},appendRow:false,exit:false});
    expect(nextTablePosition(source,{row:2,column:1},1).appendRow).toBe(true);
  });
  it('keeps odd backslashes before a newly pasted pipe inside its cell',()=>{
    const result=applyTableOperation('| A | B |\n| --- | --- |\n| old | keep |',{type:'cell',at:{row:1,column:0},value:String.raw`back\|pipe`});
    const model=parseMarkdownTable(result.source)!;expect(model.headers).toHaveLength(2);expect(model.rows[0][1]).toBe('keep');expect(model.rows[0][0]).toContain('|pipe');
  });
  it('does not treat a Setext heading or separate paragraphs as a table',()=>{
    expect(parseMarkdownTable('Heading\n---')).toBeNull();expect(parseMarkdownTable('| A |\n| --- |\n\nparagraph')).toBeNull();
  });
  it('does not serialize an untouched cell or no-op operation',()=>{
    expect(applyTableOperation(source,{type:'cell',at:{row:1,column:1},value:'old'}).patches).toEqual([]);
    const escaped='| Code |\n| --- |\n| `A\\|B` [link](x) |';expect(serializeMarkdownTable(parseMarkdownTable(escaped)!)).toBe(escaped);
  });
  it('rejects aggregate cell text and escaped output beyond the table budget',()=>{
    const source='| A | B |\n| --- | --- |';
    expect(()=>applyTableOperation(source,{type:'paste',at:{row:0,column:0},cells:[['x'.repeat(600_000),'y'.repeat(600_000)]]})).toThrow('input budget');
    expect(()=>applyTableOperation(source,{type:'cell',at:{row:0,column:0},value:'|'.repeat(600_000)})).toThrow('resulting table');
  });

});
