// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {parseHtmlTable} from './htmlTableEditing';
import {htmlTableCopy,htmlTablePaste,readHtmlTablePaste,prepareHtmlTablePaste,writeHtmlTableClipboard,readHtmlTableClipboard} from './htmlTableClipboard';
const table="<table data-owner='x'><tbody><tr><td rowspan='2'><strong>A</strong><br>B</td><td>C</td></tr><tr><td>D</td></tr></tbody></table>";
const whole={from:{row:0,column:0},to:{row:1,column:1}};
describe('rich HTML table clipboard',()=>{
 it('copies human text and one complete relative merged structure',()=>{
  const data=htmlTableCopy(parseHtmlTable(table),whole);expect(data.text).toBe('"A\nB"\tC\n\tD');
  const matrix=readHtmlTablePaste({text:data.text,html:data.html,structured:data.structured});expect(matrix.cells).toHaveLength(3);expect(matrix.cells[0].rowspan).toBe(2);expect(matrix.cells[0].html).toBe('<strong>A</strong><br>B');
 });
 it('replaces matching spans without altering attributes or roles',()=>{
  const data=htmlTableCopy(parseHtmlTable(table),whole),matrix=readHtmlTablePaste({text:data.text,structured:data.structured});matrix.cells[0].html='<em>new</em>';
  expect(htmlTablePaste(table,whole,matrix).source).toBe(table.replace('<strong>A</strong><br>B','<em>new</em>'));
 });
 it('fills each selected actual cell once with a scalar, including an empty value',()=>{
  const empty=readHtmlTablePaste({text:''});const result=htmlTablePaste(table,whole,empty);expect(result.patches).toHaveLength(3);expect(result.source).toContain("<td rowspan='2'></td>");
 });
 it('keeps a span copy distinct from scalar text and rejects partial targets',()=>{
  const source=htmlTableCopy(parseHtmlTable(table),{from:{row:0,column:0},to:{row:0,column:0}});const matrix=readHtmlTablePaste({text:source.text,structured:source.structured});
  expect(()=>htmlTablePaste(table,{from:{row:0,column:1},to:{row:0,column:1}},matrix)).toThrow(/spans/);
 });
 it('does not silently use TSV when the preferred structure is corrupt',()=>{
  expect(()=>readHtmlTablePaste({structured:'{broken',text:'fallback'})).toThrow();expect(readHtmlTablePaste({structured:'{broken',text:'fallback',plain:true}).cells[0].html).toBe('fallback');
 });
 it('keeps scalar rich formatting rather than falling back to plain text',()=>{expect(readHtmlTablePaste({text:'bold',html:'<strong>bold</strong>'}).cells[0].html).toBe('<strong>bold</strong>');});
 it('preserves quoted multiline fields and rejects irregular rows or executable input',()=>{
  expect(readHtmlTablePaste({text:'"a\nb"\t"c"'}).cells[0].html).toBe('a<br>b');expect(()=>readHtmlTablePaste({text:'a\tb\nc'})).toThrow(/different lengths/);
  expect(()=>readHtmlTablePaste({html:'<table><tr><td><script>alert(1)</script></td></tr></table>',text:''})).toThrow(/reviewed/);
 });
});

describe('HTML table clipboard transactions and expansion preview',()=>{
 it('plans all new tracks without rewriting existing source until explicit confirmation',()=>{
  const source="<table class='exact'><tbody>\n<tr data-r='keep'><td data-x='retain'>A</td><td>B</td></tr>\n</tbody></table>",range={from:{row:0,column:1},to:{row:0,column:1}},matrix=readHtmlTablePaste({text:'x\ty\nz\tw'}),plan=prepareHtmlTablePaste(source,range,matrix);
  expect(plan.requiresConfirmation).toBe(true);expect(plan.expansion).toEqual({rows:2,columns:3,addedRows:1,addedColumns:1,overwritten:{from:{row:0,column:1},to:{row:0,column:1}}});expect(source).toContain('>B</td>');expect(plan.source).toContain("<td data-x='retain'>A</td>");expect(plan.source).toContain("class='exact'");expect(()=>htmlTablePaste(source,range,matrix)).toThrow(/extends/);expect(htmlTablePaste(source,range,matrix,{expand:true}).source).toBe(plan.source);expect(plan.patches).toHaveLength(1);
 });
 it('does not expand a table whose track declarations cannot be mapped losslessly',()=>{
  for(const source of ['<table><colgroup><col width="40"></colgroup><tr><td>A</td></tr></table>','<table><tr><th scope="row">A</th></tr></table>','<table><tr><td style="width:20px">A</td></tr></table>'])expect(()=>prepareHtmlTablePaste(source,{from:{row:0,column:0},to:{row:0,column:0}},readHtmlTablePaste({text:'x\ty'}))).toThrow(/mapping|associations/);
 });
 it('protects source spans and missing cells rather than converting a conflicting matrix',()=>{
  expect(()=>prepareHtmlTablePaste(table,whole,readHtmlTablePaste({text:'x\ty\nz\tw'}))).toThrow(/spans/);expect(()=>readHtmlTablePaste({structured:JSON.stringify({version:1,rows:2,columns:2,cells:[{row:0,column:0,rowspan:1,colspan:1,kind:'td',html:'x'}]}),text:'fallback'})).toThrow(/uncovered/);
 });
 it('retains cell semantics in the structured copy and never promotes data to headers',()=>{
  const copy=htmlTableCopy(parseHtmlTable("<table><tr><td id='a' data-x='keep'>A</td></tr></table>"),{from:{row:0,column:0},to:{row:0,column:0}}),matrix=readHtmlTablePaste({...copy});expect(matrix.cells[0].kind).toBe('td');expect(matrix.cells[0].attributes).toEqual({id:'a','data-x':'keep'});
 });
 it('rejects HTML with a second object instead of taking just its first table',()=>{expect(()=>readHtmlTablePaste({text:'A extra',html:'<table><tr><td>A</td></tr></table><p>extra</p>'})).toThrow(/outside/);});
 it('waits for native acknowledgement of the whole copy and exposes all representations',async()=>{
  const trigger=document.createElement('div'),data=htmlTableCopy(parseHtmlTable(table),whole);let complete!:(success:boolean,error?:string)=>void;
  trigger.addEventListener('tegg-copy-table',event=>{event.preventDefault();const detail=(event as CustomEvent).detail;expect(detail.text).toBe(data.text);expect(detail.html).toContain('rowspan="2"');expect(detail.structured).toBe(data.structured);complete=detail.complete;});
  let done=false;const write=writeHtmlTableClipboard(trigger,data).then(()=>{done=true;});await Promise.resolve();expect(done).toBe(false);complete(true);await write;expect(done).toBe(true);
 });
 it('never considers native copy failure successful',async()=>{const trigger=document.createElement('div');trigger.addEventListener('tegg-copy-table',event=>{event.preventDefault();(event as CustomEvent).detail.complete(false,'denied');});await expect(writeHtmlTableClipboard(trigger,htmlTableCopy(parseHtmlTable(table),whole))).rejects.toThrow('denied');});
 it('prefers a native structured read to the lower fidelity DOM paste event',async()=>{const trigger=document.createElement('div');trigger.addEventListener('tegg-read-table',event=>{event.preventDefault();(event as CustomEvent).detail.complete({text:'native',structured:'exact'});});expect(await readHtmlTableClipboard(trigger,{text:'DOM'})).toEqual({text:'native',structured:'exact'});});
});
