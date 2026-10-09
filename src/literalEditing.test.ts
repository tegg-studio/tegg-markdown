// @vitest-environment jsdom
import {afterEach,beforeAll,it,expect,vi} from 'vitest';
import {EditorState,EditorSelection} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {markdown} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {resourceContext} from './editorHost';
import {snapLiteralSelection,literalSemanticAtoms} from './literalEditing';
import {copySemanticSelection} from './contentClipboard';
import type {SemanticClipboardData} from './clipboardTransport';
const views:EditorView[]=[];
beforeAll(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});Range.prototype.getClientRects=()=>[] as unknown as DOMRectList;Range.prototype.getBoundingClientRect=()=>new DOMRect();});
afterEach(()=>{for(const view of views)view.destroy();views.length=0;document.body.replaceChildren();});
function cell(source:string,from:number,to:number){return EditorState.create({doc:source,selection:EditorSelection.single(from,to),extensions:[markdown({extensions:GFM}),resourceContext.of({documentPath:'table.md',profile:'tegg',editingContext:'table-cell'})]});}
async function copy(state:EditorState){const view=new EditorView({parent:document.body.appendChild(document.createElement('div')),state});views.push(view);let result!:SemanticClipboardData;view.dom.addEventListener('tegg-copy-content',event=>{event.preventDefault();const detail=(event as CustomEvent).detail;result=detail;detail.complete(true);});expect(await copySemanticSelection(view)).toBe(true);return {view,result};}
for(const [literal,part]of [['&amp;','amp'],['&#65;','65'],['&#x41;','x41']]as const)it(`cell inline code ${literal} copies only selected literal ${part}`,async()=>{
  const source='`a '+literal+' z`',from=source.indexOf(part),selection=EditorSelection.single(from,from+part.length),state=cell(source,from,from+part.length);
  expect(snapLiteralSelection(state,selection).eq(selection)).toBe(true);expect(literalSemanticAtoms(state).some(atom=>atom.from===3&&atom.to===3+literal.length)).toBe(false);
  const {view,result}=await copy(state);expect(view.state.selection.eq(selection)).toBe(true);expect(view.state.doc.toString()).toBe(source);expect(result.text).toBe(part);expect(result.html).toContain('<code>'+part+'</code>');expect(JSON.parse(result.structured).source).toBe('`'+part+'`');
});
for(const [literal,decoded]of [['&amp;','&'],['&#65;','A'],['&#x41;','A']]as const)it(`cell ordinary ${literal} remains one visible decoded atom`,async()=>{
  const source='a '+literal+' z',from=3,state=cell(source,from,from+1),snapped=snapLiteralSelection(state,state.selection);
  expect(state.sliceDoc(snapped.main.from,snapped.main.to)).toBe(literal);const {view,result}=await copy(state);expect(view.state.selection.eq(snapped)).toBe(true);expect(result.text).toBe(decoded);expect(view.state.doc.toString()).toBe(source);
});
it('cell escaped punctuation stays literal inside inline code and atomic outside it',async()=>{
  const literal='`a \\* z`',from=literal.indexOf('*'),state=cell(literal,from,from+1);expect(snapLiteralSelection(state,state.selection).eq(state.selection)).toBe(true);
  const local=await copy(state);expect(local.result.text).toBe('*');expect(JSON.parse(local.result.structured).source).toBe('`*`');
  const normal='a \\* z',outside=cell(normal,normal.indexOf('*'),normal.indexOf('*')+1),snapped=snapLiteralSelection(outside,outside.selection);expect(outside.sliceDoc(snapped.main.from,snapped.main.to)).toBe('\\*');const decoded=await copy(outside);expect(decoded.result.text).toBe('*');expect(decoded.view.state.selection.eq(snapped)).toBe(true);
});
it('code literal scope still keeps a complete emoji grapheme indivisible',()=>{
  const source='`a 👩🏽‍💻 z`',from=source.indexOf('👩'),state=cell(source,from+1,from+2),selection=snapLiteralSelection(state,state.selection);expect(state.sliceDoc(selection.main.from,selection.main.to)).toBe('👩🏽‍💻');
});
