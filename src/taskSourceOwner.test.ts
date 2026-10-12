import {describe,it,expect} from 'vitest';
import {EditorState,EditorSelection,type Transaction} from '@codemirror/state';
import {history,undo,redo,isolateHistory} from '@codemirror/commands';
import {queryTaskSourceSelection,queryEditorTaskSelection,planTaskOwnerToggle,planEditorTaskOwnerToggle} from './taskSourceOwner';
import {applySourcePatches} from './sourcePatch';
const select=(source:string,text:string)=>({from:source.indexOf(text),to:source.indexOf(text)+text.length});
describe('trusted task body source and current-editor ownership',()=>{
 it.each(['\n','\r\n'])('maps own task body after frontmatter/BOM/emoji with %j',newline=>{
  const source=['\uFEFF---','title: 😀','---','> 3. [ ] parent','>    - [X] child'].join(newline),owner=queryTaskSourceSelection(source,select(source,'child'))!;
  expect(owner.marker.expected).toBe('[X]');expect(source.slice(owner.marker.from,owner.marker.to)).toBe('[X]');expect(source.slice(owner.itemRange.from,owner.itemRange.to)).toBe('- [X] child');expect(owner.selection).toEqual(select(source,'child'));expect(Object.isFrozen(owner)).toBe(true);
  const patch=planTaskOwnerToggle(source,owner);expect(applySourcePatches(source,[patch])).toBe(source.replace('[X] child','[ ] child'));
 });
 it('accepts continuation and direct paragraphs belonging to one task, excluding its descendants',()=>{
  const source='- [ ] parent\n  continued\n\n  paragraph\n  - [x] child\n  - non-task child\n- [ ] sibling';
  const owner=queryTaskSourceSelection(source,{from:source.indexOf('parent'),to:source.indexOf('paragraph')+'paragraph'.length})!;expect(owner.marker.expected).toBe('[ ]');expect(owner.textRanges).toHaveLength(2);expect(owner.itemRange.to).toBe(source.indexOf('\n- [ ] sibling'));
  expect(queryTaskSourceSelection(source,select(source,'continued'))?.marker.from).toBe(2);expect(queryTaskSourceSelection(source,select(source,'child'))?.marker.expected).toBe('[x]');
  expect(queryTaskSourceSelection(source,select(source,'non-task child'))).toBeNull();
 });
 it('rejects parent-to-child, child-to-sibling and non-task descendant selection',()=>{
  const source='- [ ] parent\n  - [x] child\n  - plain descendant\n- [X] sibling';
  for(const [first,last] of [['parent','child'],['child','sibling'],['parent','plain descendant']])expect(queryTaskSourceSelection(source,{from:source.indexOf(first),to:source.indexOf(last)+last.length})).toBeNull();
 });
 it.each(['```md\n  - [ ] code\n  ```','<div>\n  - [ ] html\n  </div>','| H |\n  | --- |\n  | data |','> quoted child'])('does not grant an outer task for a nested object: %j',body=>{
  const source='- [ ] parent\n\n  '+body+'\n\n  after';
  const inside=body.includes('code')?'code':body.includes('html')?'html':body.includes('data')?'data':'quoted child';
  expect(queryTaskSourceSelection(source,select(source,inside))).toBeNull();expect(queryTaskSourceSelection(source,{from:source.indexOf('parent'),to:source.indexOf('after')+5})).toBeNull();
 });
 it('rejects markers/prefixes, empty/out-of-bounds/fractional source selections',()=>{
  const source='- [ ] body';for(const range of [{from:0,to:source.length},{from:2,to:5},{from:6,to:6},{from:-1,to:6},{from:6.5,to:8},{from:6,to:99}])expect(queryTaskSourceSelection(source,range)).toBeNull();
 });
 it.each(['- [ ] a\r\n- [x] b\n','- [ ] a\r- [x] b'])('keeps mixed/CR newline content read-only',source=>{expect(queryTaskSourceSelection(source,select(source,'a'))).toBeNull();});
 it('rejects copied owners and any source drift, even outside the unchanged target marker',()=>{
  const source='# title\n\n- [ ] body',owner=queryTaskSourceSelection(source,select(source,'body'))!;
  expect(()=>planTaskOwnerToggle(source,{...owner})).toThrow(/captured source/);expect(()=>planTaskOwnerToggle(source.replace('title','other'),owner)).toThrow(/captured source/);expect(()=>planTaskOwnerToggle(source+'\n',owner)).toThrow(/captured source/);
 });
 it('queries only the current CM source/selection and does not mutate its document or selection',()=>{
  const source='- [ ] first\n- [X] second',selection=select(source,'second'),state=EditorState.create({doc:source,selection:EditorSelection.single(selection.to,selection.from)}),before=state.selection.toJSON();
  expect(queryEditorTaskSelection(state,source)?.marker.expected).toBe('[X]');expect(state.doc.toString()).toBe(source);expect(state.selection.toJSON()).toEqual(before);expect(queryEditorTaskSelection(state,source.replace('first','other'))).toBeNull();
 });
 it('rejects readonly, caret-only and multiple CM selections',()=>{
  const source='- [ ] first\n- [ ] second',a=select(source,'first'),b=select(source,'second');
  for(const state of [EditorState.create({doc:source,selection:EditorSelection.single(a.from,a.to),extensions:EditorState.readOnly.of(true)}),EditorState.create({doc:source,selection:EditorSelection.single(a.from)}),EditorState.create({doc:source,selection:EditorSelection.create([EditorSelection.range(a.from,a.to),EditorSelection.range(b.from,b.to)]),extensions:EditorState.allowMultipleSelections.of(true)})])expect(queryEditorTaskSelection(state,source)).toBeNull();
 });
 it('maps raw CRLF to CM offsets for one isolated transaction and exact uppercase-X undo/redo',()=>{
  const source='\uFEFF# 😀\r\n\r\n- [X] first\r\n- [ ] sibling',normalized=source.replace(/\r\n/g,'\n'),range=select(normalized,'first');let state=EditorState.create({doc:normalized,selection:EditorSelection.single(range.from,range.to),extensions:history()});
  const owner=queryEditorTaskSelection(state,source)!,patch=planEditorTaskOwnerToggle(state,source,owner);expect(source[owner.marker.from+1]).toBe('X');expect(state.doc.sliceString(patch.from,patch.to)).toBe('X');expect(patch.from).toBe(normalized.indexOf('[X]')+1);expect(patch.to-patch.from).toBe(1);
  const dispatch=(transaction:Transaction)=>{state=transaction.state;};dispatch(state.update({changes:patch,annotations:isolateHistory.of('full')}));expect(state.doc.toString().replaceAll('\n','\r\n')).toBe(source.replace('[X] first','[ ] first'));expect(state.selection.main.from).toBe(range.from);expect(state.selection.main.to).toBe(range.to);
  expect(undo({state,dispatch})).toBe(true);expect(state.doc.toString().replaceAll('\n','\r\n')).toBe(source);expect(undo({state,dispatch})).toBe(false);expect(redo({state,dispatch})).toBe(true);
 });
 it('rechecks selection, readonly and source at action time after menu capture',()=>{
  const source='- [ ] first\n- [ ] second',a=select(source,'first'),b=select(source,'second'),state=EditorState.create({doc:source,selection:EditorSelection.single(a.from,a.to)}),owner=queryEditorTaskSelection(state,source)!;
  const moved=state.update({selection:EditorSelection.single(b.from,b.to)}).state;expect(()=>planEditorTaskOwnerToggle(moved,source,owner)).toThrow(/current editor selection/);
  const readOnly=EditorState.create({doc:source,selection:state.selection,extensions:EditorState.readOnly.of(true)});expect(()=>planEditorTaskOwnerToggle(readOnly,source,owner)).toThrow(/current editor selection/);
  const changed=state.update({changes:{from:6,to:11,insert:'other'}}).state;expect(()=>planEditorTaskOwnerToggle(changed,changed.doc.toString(),owner)).toThrow(/captured source/);
 });
});
