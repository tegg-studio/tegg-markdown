// @vitest-environment jsdom
import {afterEach,describe,it,expect} from 'vitest';
import {TeggMarkdownEditor} from './editor';
import {commandBlockAt,planBlockHeading} from './commandBlockTarget';
import {dispatchSourcePatches} from './editorPatches';
const editors:TeggMarkdownEditor[]=[];
afterEach(()=>{editors.splice(0).forEach(e=>e.destroy());document.body.replaceChildren();});
function make(source:string){const root=document.body.appendChild(document.createElement('div'));const e=new TeggMarkdownEditor(root,{documentId:'blocks',revision:'1',source,profile:'tegg'},{},'live');editors.push(e);return e;}
describe('semantic Hover targets',()=>{
 it.each([
  ['plain **bold** and [link](a.md) with $x$','link','text'],
  ['plain **bold** and [link](a.md) with $x$','$x','text'],
  ['before ![alt](a.png) after','alt','text'],
  ['![alt](a.png)','alt','image'],
  ['> - ## **heading**','heading','text'],
  ['- outer\n  - [x] inner\n    continuation','continuation','text'],
  ['| A | B |\n| --- | --- |\n| c | d |','c','table'],
  ['```mermaid\nflowchart TD\nA --> B\n```','flowchart','mermaid'],
  ['```ts\nconst x=1\n```','const','code'],
  ['$$\nx^2\n$$','x^2','math'],
  ['> [!NOTE]\n> Important','Important','callout'],
  ['Term\n: definition','definition','definition'],
  ['ref[^a]\n\n[^a]: note','ref','text'],
  ['ref[^a]\n\n[^a]: note','note','footnote'],
 ])('resolves %s without promoting inline syntax', (source,at,kind)=>{
   const editor=make(source);expect(commandBlockAt(editor.view.state,source.indexOf(at)+1)?.kind).toBe(kind);
 });
 it('anchors nested item continuations to their own first paragraph',()=>{
   const source='- outer\n  - [x] inner\n    continuation\n- sibling';const editor=make(source);
   const target=commandBlockAt(editor.view.state,source.indexOf('continuation')+4)!;
   expect(target.position).toBeLessThan(source.indexOf('continuation'));
   expect(target.position).toBeGreaterThan(source.indexOf('inner'));
 });
 it.each([
  ['first **bold**\nsecond [link](a.md)',2,'## first **bold** second [link](a.md)'],
  ['> first\n> second',3,'> ### first second'],
  ['- first\n  continuation\n  - child\n- sibling',2,'- ## first continuation\n  - child\n- sibling'],
  ['> - ## **title**\n> - sibling',0,'> - **title**\n> - sibling'],
  ['Title\n=====',2,'## Title'],
  ['Title\n-----',0,'Title'],
  ['first  \nsecond',2,'## first<br>second'],
  ['first\\\nsecond',2,'## first<br>second'],
 ])('converts a logical paragraph and restores exact source on undo: %s',(source,level,expected)=>{
   const editor=make(source),target=commandBlockAt(editor.view.state,source.indexOf('first')>=0?source.indexOf('first')+2:source.indexOf('title')>=0?source.indexOf('title')+2:2)!;
   const plan=planBlockHeading(editor.view.state,target,level)!;expect(plan).not.toBeNull();
   dispatchSourcePatches(editor.view,plan.patches,{selection:plan.selection,isolateHistory:true});expect(editor.source).toBe(expected);
   editor.command('undo');expect(editor.source).toBe(source);editor.command('redo');expect(editor.source).toBe(expected);
 });
});
