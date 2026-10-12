import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/task.html');await page.waitForFunction(()=>Boolean((window as any).ready));});
test('native checkbox Space is one Host transaction and preserves keyboard focus',async({page})=>{
 const task=page.getByRole('checkbox',{name:'first',exact:true});await task.focus();await task.press('Space');await expect(task).toBeChecked();await expect(task).toBeFocused();
 const result=await page.evaluate(()=>({calls:(window as any).calls,source:(window as any).taskFixture.getSource()}));expect(result.calls).toHaveLength(1);expect(result.calls[0].patch).toEqual({from:3,to:4,expected:' ',insert:'x'});expect(result.source).toBe('- [x] first\n- [X] second');
 await task.press('Space');await expect(task).not.toBeChecked();await expect(task).toBeFocused();expect(await page.evaluate(()=>(window as any).calls.length)).toBe(2);
});
test('glyph pointer toggles but task text only selects and failure preserves state',async({page})=>{
 const task=page.getByRole('checkbox',{name:'first',exact:true});await page.locator('label').first().click();expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
 const before=await page.locator('#reader').innerHTML();await page.evaluate(()=>{(window as any).reject=true;});await task.click();await expect(task).not.toBeChecked();await expect(task).toBeEnabled();expect(await page.evaluate(()=>(window as any).errors)).toEqual(['Error: Task change was not accepted. The original task is preserved.']);expect(await page.locator('#reader').innerHTML()).toBe(before);
});
test('single-task selection query leaves focus and scroll unchanged; stale task request fails',async({page})=>{
 const result=await page.evaluate(async()=>{
  const w=window as any,{reader,root}=w.taskFixture,label=root.querySelector('label'),before=document.querySelector<HTMLButtonElement>('#before')!;before.focus();
  const range=document.createRange();range.selectNodeContents(label);const selection=document.getSelection()!;selection.removeAllRanges();selection.addRange(range);
  const y=window.scrollY,task=reader.selectedTask(),focus=document.activeElement===before;const sameScroll=window.scrollY===y;
  await reader.render({documentId:'own',generation:'g1',sequence:1,revision:'base',source:'- [ ] new',taskToggleEnabled:true});
  return {task:task?.marker.expected,focus,sameScroll,stale:await reader.toggleTask(task),calls:w.calls.length};
 });expect(result).toEqual({task:'[ ]',focus:true,sameScroll:true,stale:false,calls:0});
});
test('compiled lightweight public Reader exposes trusted actions while default Host remains read-only',async({page})=>{
 const result=await page.evaluate(async()=>{
  const module=(window as any).taskAPI.reader,core=(window as any).taskAPI.core,mount=document.body.appendChild(document.createElement('div'));
  const input={documentId:'boundary',generation:'g2',sequence:0,revision:'base',source:'- [ ] public',taskToggleEnabled:true};
  const plain=new module.TeggMarkdownReader(mount);await plain.render(input);const disabled=mount.querySelector('input').disabled;plain.destroy();let calls=0;
  const reader=new module.TeggMarkdownReader(mount,{onError:error=>{throw error;},onTaskToggle:request=>{calls++;return {accepted:true,input:{...input,source:core.toggleTaskSource(request.source,request.task.marker),sequence:1,profileVersion:request.task.profileVersion}};}});
  await reader.render(input);const control=mount.querySelector('input'),task=reader.taskAt(control),accepted=await reader.toggleTask(task),checked=mount.querySelector('input').checked;reader.destroy();mount.remove();return {disabled,accepted,checked,calls};
 });expect(result).toEqual({disabled:true,accepted:true,checked:true,calls:1});
});

test('compiled task owner API uses current CM source selection, maps CRLF and refuses nested ownership',async({page})=>{
 const result=await page.evaluate(async()=>{
  const api=(window as any).taskAPI.core,{EditorState,EditorSelection}=(window as any).cmTypes;
  const source='# 😀\r\n\r\n- [X] parent\r\n  - [ ] child',normalized=source.replaceAll('\r\n','\n'),start=normalized.indexOf('parent');
  const state=EditorState.create({doc:normalized,selection:EditorSelection.single(start,start+6)}),owner=api.queryEditorTaskSelection(state,source),patch=api.planEditorTaskOwnerToggle(state,source,owner);
  const cross=api.queryTaskSourceSelection(source,{from:source.indexOf('parent'),to:source.indexOf('child')+5});
  let copied=false;try{api.planTaskOwnerToggle(source,{...owner});}catch{copied=true;}
  return {marker:owner.marker.expected,patch,expectedPosition:normalized.indexOf('[X]')+1,cross,copied,sourceUnchanged:state.doc.toString()===normalized,selectionUnchanged:state.selection.main.from===start&&state.selection.main.to===start+6};
 });expect(result).toEqual({marker:'[X]',patch:{from:result.expectedPosition,to:result.expectedPosition+1,expected:'X',insert:' '},expectedPosition:result.expectedPosition,cross:null,copied:true,sourceUnchanged:true,selectionUnchanged:true});
});

test('compiled Reader rejects nested object text and crossing while accepting its own direct paragraphs',async({page})=>{
 const results=await page.evaluate(async()=>{
  const {TeggMarkdownReader}=(window as any).taskAPI.reader,results=[];
  for(const body of ['| H |\n  | --- |\n  | excluded-body |','```txt\n  excluded-body\n  ```','<div>excluded-body</div>','> excluded-body','- excluded-body']){
   const root=document.body.appendChild(document.createElement('div')),reader=new TeggMarkdownReader(root,{onError:()=>{},onTaskToggle:()=>({accepted:false})});
   await reader.render({documentId:'own-negative',generation:'g1',sequence:0,source:'- [ ] before\n\n  '+body+'\n\n  after',taskToggleEnabled:true});
   const text=(value:string)=>{const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);for(let n=w.nextNode();n;n=w.nextNode())if(n.textContent?.includes(value))return n as Text;throw Error('Missing '+value)};
   const select=(a:Text,b=a)=>{const r=document.createRange();r.setStart(a,0);r.setEnd(b,b.length);const s=getSelection()!;s.removeAllRanges();s.addRange(r)};
   select(text('excluded-body'));const nested=reader.selectedTask();select(text('before'),text('after'));const cross=reader.selectedTask();results.push({nested:nested===null,cross:cross===null});reader.destroy();root.remove();
  }
  const root=document.body.appendChild(document.createElement('div')),reader=new TeggMarkdownReader(root,{onError:()=>{},onTaskToggle:()=>({accepted:false})});await reader.render({documentId:'positive',generation:'g1',sequence:0,source:'- [ ] first\n\n  own second paragraph',taskToggleEnabled:true});
  const p=[...root.querySelectorAll('p')].find(p=>p.textContent?.includes('own second paragraph'))!,r=document.createRange();r.selectNodeContents(p);const s=getSelection()!;s.removeAllRanges();s.addRange(r);const positive=reader.selectedTask()?.marker.from===2;reader.destroy();root.remove();return {results,positive};
 });expect(results.results).toEqual(Array(5).fill({nested:true,cross:true}));expect(results.positive).toBe(true);
});
test('compiled all Reader profiles bind displayed tasks to the correct raw marker after frontmatter',async({page})=>{
 const results=await page.evaluate(async()=>{
  const {TeggMarkdownReader}=(window as any).taskAPI.reader,results=[];
  for(const profile of ['tegg','github','gfm'] as const){const root=document.body.appendChild(document.createElement('div')),reader=new TeggMarkdownReader(root,{onError:()=>{},onTaskToggle:()=>({accepted:false})}),source='---\ntitle: own\n---\n- [ ] one\n- [ ] two\n- [ ] three\n- [ ] four';
   await reader.render({profile,documentId:'profile',generation:'g1',sequence:0,source,taskToggleEnabled:true});const actual=[...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].map(control=>reader.taskAt(control)?.marker.from);results.push({profile,actual,expected:['one','two','three','four'].map(word=>source.indexOf('[ ] '+word))});reader.destroy();root.remove();
  }return results;
 });for(const result of results)expect(result.actual).toEqual(result.expected);
});

test('public Reader token provenance distinguishes duplicate BOM/CRLF quoted ordered nested tasks in every profile',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {TeggMarkdownReader}=(window as any).taskAPI.reader,core=(window as any).taskAPI.core,results=[];
  for(const profile of ['tegg','github','gfm'] as const)for(const newline of ['\n','\r\n']){
   const source=['\uFEFF---','title: own','---','> 3. [ ] repeat','>    - [X] repeat','','- [ ] repeat','- [ ] repeat'].join(newline),input={profile,source,documentId:'repeat',generation:'g1',sequence:0},root=document.body.appendChild(document.createElement('div'));
   let output=source;const reader=new TeggMarkdownReader(root,{onError:()=>{},onTaskToggle:r=>{output=core.toggleTaskSource(r.source,r.task.marker);return {accepted:true,input:{...input,source:output,sequence:1,profileVersion:r.task.profileVersion}}}});await reader.render({...input,taskToggleEnabled:true});
   const controls=[...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')],owners=controls.map(c=>reader.taskAt(c)),expected=core.resolveTaskMarkers(source).map(m=>m.from),accepted=await reader.toggleTask(owners[2]!);
   results.push({profile,newline,actual:owners.map(o=>o?.marker.from),expected,accepted,exactSource:output===core.toggleTaskSource(source,{from:expected[2],to:expected[2]+3,expected:'[ ]'})});reader.destroy();root.remove();
  }return results;
 });for(const r of result){expect(r.actual).toEqual(r.expected);expect(r.accepted).toBe(true);expect(r.exactSource).toBe(true)}
});
test('public Reader refuses author task/context attributes and copied generated checkbox identity',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {TeggMarkdownReader}=(window as any).taskAPI.reader,root=document.body.appendChild(document.createElement('div')),reader=new TeggMarkdownReader(root,{onError:()=>{},onTaskToggle:()=>({accepted:false})}),source='<ul><li class="task-list-item" data-document-id="own" data-task-source="trusted"><input type="checkbox" data-tegg-task-key="fake">author</li></ul>\n\n- [ ] real';
  await reader.render({documentId:'authored',generation:'g1',sequence:0,source,taskToggleEnabled:true});const controls=root.querySelectorAll<HTMLInputElement>('input[type=checkbox]'),copy=controls[1].cloneNode(true);root.querySelector('li')!.append(copy);
  const result={author:reader.taskAt(controls[0])===null,copy:reader.taskAt(copy)===null,real:reader.taskAt(controls[1])?.marker.from===source.lastIndexOf('[ ]'),temporaryKeyAbsent:!root.querySelector('[data-tegg-task-key]')};reader.destroy();root.remove();return result;
 });expect(result).toEqual({author:true,copy:true,real:true,temporaryKeyAbsent:true});
});
