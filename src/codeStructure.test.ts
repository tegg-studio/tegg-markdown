import {describe,it,expect} from 'vitest';
import {EditorState,Transaction} from '@codemirror/state';
import {markdown} from '@codemirror/lang-markdown';
import {ensureSyntaxTree,syntaxTree} from '@codemirror/language';
import {history} from '@codemirror/commands';
import {undo,redo,selectionHistory} from './selectionHistory';
import {preserveCodeStructure,codeSource} from './codeStructure';
import {readCode,writeContainerCode} from './codeEditing';

function state(doc:string, live=true) {return EditorState.create({doc, extensions:[markdown(),history(),selectionHistory, ...(live?[preserveCodeStructure]:[])]});}
function blocks(s:EditorState) {
 const result:{body:string,prefix:string,kind:string,from:number,to:number}[]=[];
 (ensureSyntaxTree(s,s.doc.length,1000)??syntaxTree(s)).iterate({enter(n){if(['CodeBlock','FencedCode'].includes(n.name)){const c=codeSource(s,n.node);if(c)result.push({body:readCode(c.plain).body,prefix:c.prefix,kind:n.name,from:c.from,to:c.to});return false;}}});return result;
}
const containers=[['root','paragraph',''],['bullet','- paragraph','  '],['wide','100. paragraph','     '],['nested','- parent\n  - paragraph','    '],['task','- [ ] paragraph','  ']];
for(const [name,lead,prefix] of containers) for(const fenced of [false,true]) for(const method of ['delete.backward','delete.forward','delete.cut']) {
 it(`${name} ${fenced?'fenced':'indented'} ${method} preserves the last separator and undo`,()=>{
  const code=(fenced?'```\nfirst\n    nested\n```':'    first\n        nested').split('\n').map(l=>prefix+l).join('\n');
  const doc=lead+'\n\n'+code+'\n\n'+(prefix?'- sibling':'tail');
  let s=state(doc);const original=blocks(s);expect(original).toHaveLength(1);
  const from=lead.length;
  const selection=method==='delete.backward'?from+1:from;
  s=s.update({selection:{anchor:selection}}).state;
  s=s.update({changes:{from,to:from+1},selection:{anchor:from},userEvent:method}).state;
  expect(blocks(s)).toHaveLength(1);expect(blocks(s)[0].body).toBe(original[0].body);expect(blocks(s)[0].prefix).toBe(prefix);
  expect(s.doc.toString()).toContain(prefix?'- sibling':'tail');
  const changed=s.doc.toString();
  const target={get state(){return s;},dispatch(tr:Transaction){s=tr.state;}};
  for(let i=0;i<3;i++){expect(undo(target)).toBe(true);expect(s.doc.toString()).toBe(doc);expect(s.selection.main.head).toBe(selection);expect(redo(target)).toBe(true);expect(s.doc.toString()).toBe(changed);expect(blocks(s)[0].body).toBe(original[0].body);}
 });
}
for(const [name,lead,prefix] of containers) {
 it(`${name}: extra blank line deletion preserves indented source`,()=>{
 const doc=lead+'\n\n\n'+prefix+'    code';let s=state(doc);s=s.update({changes:{from:lead.length,to:lead.length+1},userEvent:'delete.backward'}).state;
 expect(s.doc.toString()).toBe(doc.replace('\n\n\n','\n\n'));expect(blocks(s)[0].kind).toBe('CodeBlock');
 });
 for(const body of ['', '\nstart','end\n','\n\n','first\n\nlast','```\ncode']) it(`${name}: body ${JSON.stringify(body)} stays a code object`,()=>{
 const raw=prefix+'    original';const next=writeContainerCode(raw,prefix,body);
 const s=state(lead+'\n\n'+next+'\n\n'+(prefix?'- next':'next'));
 expect(blocks(s)).toHaveLength(1);expect(blocks(s)[0].body).toBe(body);
 });
}
it('source mode leaves literal whitespace deletion unchanged',()=>{
 const doc='paragraph\n\n    code';const s=state(doc,false).update({changes:{from:9,to:10},userEvent:'delete.backward'}).state;
 expect(s.doc.toString()).toBe('paragraph\n    code');expect(blocks(s)).toHaveLength(0);
});
it('selection deleting all separating newlines preserves both block boundaries',()=>{
 let s=state('- paragraph\n\n      code\n\n- next');const c=blocks(s)[0];
 s=s.update({changes:[{from:11,to:c.from},{from:c.to,to:c.to+2}],userEvent:'delete.cut'}).state;
 expect(blocks(s)[0].body).toBe('code');expect(s.doc.toString()).toContain('\n- next');
});
it('deleting a whole code block is intentional and not restored',()=>{
 let s=state('paragraph\n\n```\ncode\n```');const c=blocks(s)[0];s=s.update({changes:{from:c.from,to:c.to},userEvent:'delete.selection'}).state;expect(blocks(s)).toHaveLength(0);
});
it('non-delete edits and undo transactions are not rewritten',()=>{
 const doc='paragraph\n\n    code';for(const userEvent of ['input','undo','redo'])expect(state(doc).update({changes:{from:9,to:10},userEvent}).newDoc.toString()).toBe('paragraph\n    code');
});

for(const [name,lead,prefix] of containers) for(const all of [false,true]) it(`${name}: deleting the gap after code retains its body and sibling`,()=>{
 let s=state(lead+'\n\n'+prefix+'    code\n\n'+(prefix?'- next':'tail'));
 const c=blocks(s)[0];
 s=s.update({changes:{from:c.to,to:c.to+(all?2:1)},userEvent:'delete.forward'}).state;
 expect(blocks(s)[0].body).toBe('code');expect(s.doc.toString()).toContain('\n'+(prefix?'- next':'tail'));
});
it('preserves history and custom annotations on a rewritten transaction',()=>{
 const s=state('paragraph\n\n    code');
 const tr=s.update({changes:{from:9,to:10},userEvent:'delete.cut',annotations:Transaction.addToHistory.of(false)});
 expect(tr.annotation(Transaction.addToHistory)).toBe(false);expect(tr.isUserEvent('delete.cut')).toBe(true);
});

for(const [lead,prefix] of [['> paragraph','> '],['> - paragraph','>   '],['- item\n\n  > paragraph','  > ']]) for(const fenced of [false,true]) it(`quoted gap selection preserves ${lead} ${fenced}`,()=>{
 const code=(fenced?'```\nfirst\n    nested\n```':'    first\n        nested').split('\n').map(l=>prefix+l).join('\n');
 const doc=lead+'\n'+prefix.trimEnd()+'\n'+code;
 const s=state(doc);const old=blocks(s);expect(old).toHaveLength(1);
 const next=s.update({changes:{from:lead.length,to:old[0].from},userEvent:'delete.cut'}).state;
 expect(blocks(next)).toHaveLength(1);expect(blocks(next)[0].body).toBe(old[0].body);expect(blocks(next)[0].prefix).toBe(prefix);
});

it('forward deletion of a quoted blank row does not leak a > into paragraph text',()=>{
 const s=state('> paragraph\n>\n>     code');
 const next=s.update({changes:{from:11,to:12},userEvent:'delete.forward'}).state;
 expect(next.doc.toString()).toBe('> paragraph\n> ```\n> code\n> ```');
});
