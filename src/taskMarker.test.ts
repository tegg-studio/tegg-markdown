import {describe,it,expect} from 'vitest';
import {resolveTaskMarkers,planTaskToggle,toggleTaskSource} from './taskMarker';
import {EditorState,type Transaction} from '@codemirror/state';
import {history,undo,redo,isolateHistory} from '@codemirror/commands';

describe('parsed raw-source single-task patches',()=>{
 it.each(['\n','\r\n'])('preserves every non-marker byte with %j and BOM/emoji/frontmatter',newline=>{
  const source=['\uFEFF---','title: 😀','---','> 3. [ ] parent','>    - [X] child','tail'].join(newline);
  const tasks=resolveTaskMarkers(source);expect(tasks.map(t=>t.expected)).toEqual(['[ ]','[X]']);
  const patch=planTaskToggle(source,tasks[1]);expect(source.slice(patch.from-1,patch.to+1)).toBe('[X]');
  expect(patch.to-patch.from).toBe(1);expect(toggleTaskSource(source,tasks[1])).toBe(source.slice(0,patch.from)+' '+source.slice(patch.to));
 });
 it('excludes fenced/indented code, inline literal, escaped markers and controlled HTML',()=>{
  const source='```md\n- [ ] code\n```\n\n    - [x] code\n\n<div>\n- [X] HTML\n</div>\n\n`- [ ] inline`\n\n- \\[ ] escaped\n- [ ] actual\n';
  expect(resolveTaskMarkers(source).map(t=>source.slice(t.from,t.to))).toEqual(['[ ]']);
  expect(toggleTaskSource(source,resolveTaskMarkers(source)[0])).toBe(source.replace('- [ ] actual','- [x] actual'));
 });
 it('keeps ordered/nested/sibling markers and multi-paragraph item untouched',()=>{
  const source='1. [x] first\n   continued\n\n   paragraph\n   - [ ] nested\n2. [X] second';
  const tasks=resolveTaskMarkers(source);expect(tasks.map(t=>t.expected)).toEqual(['[x]','[ ]','[X]']);
  expect(toggleTaskSource(source,tasks[1])).toBe(source.replace('- [ ] nested','- [x] nested'));
 });
 it('fails closed for a stale or authored/fake marker range',()=>{
  const source='- [ ] original',task=resolveTaskMarkers(source)[0];
  expect(()=>planTaskToggle('- [X] original',task)).toThrow(/no longer matches/);
  expect(()=>planTaskToggle('text [ ] not task',{from:5,to:8,expected:'[ ]'})).toThrow(/parsed source/);
  expect(()=>planTaskToggle(source,{...task,from:task.from+0.5})).toThrow();
 });
 it.each(['- [ ] a\r\n- [x] b\n','- [ ] a\r- [x] b'])('preserves existing mixed/CR read-only policy',source=>{
  const task=resolveTaskMarkers(source)[0];expect(task).toBeDefined();expect(()=>planTaskToggle(source,task)).toThrow(/newline policy/);
 });
 it('maps every marker in a long CRLF task list without confusing duplicate text or line numbers',()=>{
  const source=Array.from({length:1500},()=>'- [ ] same 😀').join('\r\n'),tasks=resolveTaskMarkers(source);expect(tasks).toHaveLength(1500);expect(tasks.at(-1)?.bodyLine).toBe(1499);expect(tasks.at(-1)?.from).toBe(source.lastIndexOf('[ ]'));expect(toggleTaskSource(source,tasks[997])).toBe(source.slice(0,tasks[997].from+1)+'x'+source.slice(tasks[997].from+2));
 });
 it('is exactly one isolated undo entry and restores uppercase X byte-for-byte',()=>{
  const source='- [X] first\n- [ ] sibling';let state=EditorState.create({doc:source,extensions:history()});
  const dispatch=(transaction:Transaction)=>{state=transaction.state;};
  const patch=planTaskToggle(source,resolveTaskMarkers(source)[0]);dispatch(state.update({changes:patch,annotations:isolateHistory.of('full')}));
  expect(state.doc.toString()).toBe('- [ ] first\n- [ ] sibling');
  expect(undo({state,dispatch})).toBe(true);expect(state.doc.toString()).toBe(source);
  expect(undo({state,dispatch})).toBe(false);expect(redo({state,dispatch})).toBe(true);expect(state.doc.toString()).toBe('- [ ] first\n- [ ] sibling');
 });
});
