/** @vitest-environment jsdom */
import {afterEach,describe,it,expect,vi} from 'vitest';
import {TechnicalMarkdownReader,type ReaderInput,type ReaderTaskToggleRequest} from './reader';
import {TeggMarkdownReader} from './sdkReader';
import {toggleTaskSource} from './taskMarker';
const readers:TechnicalMarkdownReader[]=[];
const input:ReaderInput={documentId:'own',generation:'generation-1',sequence:0,revision:'base',source:'- [ ] first\n- [X] second',taskToggleEnabled:true};
function fixture(host:ConstructorParameters<typeof TechnicalMarkdownReader>[1]={}){const root=document.body.appendChild(document.createElement('div'));const reader=new TechnicalMarkdownReader(root,{onError:vi.fn(),...host});readers.push(reader);return {root,reader};}
const checkbox=(root:HTMLElement,index=0)=>root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[index];
const ack=(request:ReaderTaskToggleRequest)=>({accepted:true as const,input:{...input,source:toggleTaskSource(request.source,request.task.marker),sequence:request.task.sequence+1,profileVersion:request.task.profileVersion}});
afterEach(()=>{readers.splice(0).forEach(r=>r.destroy());document.body.replaceChildren();vi.restoreAllMocks();});
describe('explicit Reader task host capability',()=>{
 it('exposes the same trusted query/action through the public attributed Reader wrapper',async()=>{
  const root=document.body.appendChild(document.createElement('div')),reader=new TeggMarkdownReader(root,{onTaskToggle:ack,onError:vi.fn()});try{await reader.render(input);const task=reader.taskAt(checkbox(root))!;expect(task.documentId).toBe('own');expect(await reader.toggleTask(task)).toBe(true);expect(checkbox(root).checked).toBe(true);}finally{reader.destroy();}expect(reader.taskAt(root)).toBeNull();
 });
 it('keeps default and callback-only Readers disabled',async()=>{
  for(const host of [{},{onTaskToggle:vi.fn(ack)}]){const {root,reader}=fixture(host);await reader.render({...input,taskToggleEnabled:undefined});expect(checkbox(root).disabled).toBe(true);checkbox(root).click();expect(checkbox(root).checked).toBe(false);}
 });
 it('enables only real parser/plugin controls, never author checkbox/classes/data',async()=>{
  const {root,reader}=fixture({onTaskToggle:ack});await reader.render({...input,source:'<input type="checkbox" class="task-list-item-checkbox" data-tegg-task-key="fake">\n\n- [ ] real'});
  expect([...root.querySelectorAll<HTMLInputElement>('input')].map(n=>n.disabled)).toEqual([true,false]);expect(reader.taskAt(checkbox(root))).toBeNull();expect(root.querySelector('[data-tegg-task-key]')).toBeNull();
 });
 it('requests one patch with full identity then reflects only exact Host ACK',async()=>{
  const handler=vi.fn(ack),{root,reader}=fixture({onTaskToggle:handler});await reader.render(input);
  checkbox(root).click();await vi.waitFor(()=>expect(checkbox(root).checked).toBe(true));
  expect(handler).toHaveBeenCalledTimes(1);const request=handler.mock.calls[0][0];expect(request.source).toBe(input.source);expect(request.task).toMatchObject({documentId:'own',generation:'generation-1',sequence:0,revision:'base'});expect(request.patch).toEqual({from:3,to:4,expected:' ',insert:'x'});expect(checkbox(root,1).checked).toBe(true);
 });
 it('reverts a rejected write and reports understandable failure once',async()=>{
  const onError=vi.fn(),{root,reader}=fixture({onTaskToggle:()=>({accepted:false}),onError});await reader.render(input);const before=root.innerHTML;checkbox(root).click();await vi.waitFor(()=>expect(onError).toHaveBeenCalledTimes(1));expect(checkbox(root).checked).toBe(false);expect(checkbox(root).disabled).toBe(false);expect(String(onError.mock.calls[0][0])).toContain('not accepted');expect(root.querySelector('[role=status]')).toBeNull();expect(root.innerHTML).toBe(before);
 });
 it('routes preserved-state failure once through a Host-owned accessible error surface outside task content',async()=>{
  const status=document.body.appendChild(document.createElement('aside'));status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const onError=vi.fn((error:unknown)=>{status.textContent=error instanceof Error?error.message:String(error);}),{root,reader}=fixture({onTaskToggle:()=>({accepted:false}),onError});await reader.render(input);const before=root.innerHTML;
  expect(await reader.toggleTask(reader.taskAt(checkbox(root))!)).toBe(false);expect(onError).toHaveBeenCalledTimes(1);expect(status.textContent).toBe('Task change was not accepted. The original task is preserved.');expect(root.contains(status)).toBe(false);expect(root.innerHTML).toBe(before);expect(checkbox(root).checked).toBe(false);
 });
 it('keeps task controls disabled without a Host error presentation path',async()=>{
  const handler=vi.fn(ack),{root,reader}=fixture({onError:undefined,onTaskToggle:handler});await reader.render(input);expect(checkbox(root).disabled).toBe(true);expect(await reader.toggleTask(reader.taskAt(checkbox(root))!)).toBe(false);expect(handler).not.toHaveBeenCalled();expect(root.querySelector('[role=status]')).toBeNull();
 });
 it('rejects mismatched ACK source/generation/sequence without changing the projection',async()=>{
  for(const change of [{source:'other'},{generation:'other'},{sequence:0}]){const onError=vi.fn(),{root,reader}=fixture({onTaskToggle:r=>({accepted:true,input:{...ack(r).input,...change}}),onError});await reader.render(input);expect(await reader.toggleTask(reader.taskAt(checkbox(root))!)).toBe(false);expect(onError).toHaveBeenCalledTimes(1);expect(checkbox(root).checked).toBe(false);}
 });
 it('rejects stale references even at same document and revision, after sequence or generation change',async()=>{
  const handler=vi.fn(ack),{root,reader}=fixture({onTaskToggle:handler});await reader.render(input);const stale=reader.taskAt(checkbox(root))!;await reader.render({...input,sequence:1});expect(await reader.toggleTask(stale)).toBe(false);const old=reader.taskAt(checkbox(root))!;await reader.render({...input,generation:'new'});expect(await reader.toggleTask(old)).toBe(false);expect(handler).not.toHaveBeenCalled();
 });
 it('aborts pending ownership and never applies a late ACK to a new document',async()=>{
  let finish!:(value:ReturnType<typeof ack>)=>void;let request!:ReaderTaskToggleRequest;const {root,reader}=fixture({onTaskToggle:r=>{request=r;return new Promise(resolve=>{finish=resolve;});}});await reader.render(input);const pending=reader.toggleTask(reader.taskAt(checkbox(root))!);await reader.render({...input,documentId:'different',source:'- [ ] new'});expect(request.signal.aborted).toBe(true);finish(ack(request));expect(await pending).toBe(false);expect(checkbox(root).checked).toBe(false);expect(reader.taskAt(checkbox(root))!.documentId).toBe('different');
 });
 it('does not restore stale checkbox focus when a new identical-source document wins during ACK rendering',async()=>{
  let count=0,finish!:(value:string|null)=>void;
  const {root,reader}=fixture({onTaskToggle:ack,resolveResource:async()=>{count++;return count===2?new Promise<string|null>(resolve=>{finish=resolve;}):null;}});
  const original={...input,source:input.source+'\n\n![own](own.png)'};await reader.render(original);checkbox(root).focus();const originalTask=reader.taskAt(checkbox(root))!;const pending=reader.toggleTask(originalTask);
  await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));const nextSource=toggleTaskSource(original.source,originalTask.marker);
  await reader.render({...original,documentId:'new-owner',source:nextSource,sequence:1});const before=document.body.appendChild(document.createElement('button'));before.focus();finish(null);
  expect(await pending).toBe(false);expect(document.activeElement).toBe(before);expect(reader.taskAt(checkbox(root))!.documentId).toBe('new-owner');
 });
 it('serializes rapid clicks and IME, missing ownership, streaming and mixed newlines fail closed',async()=>{
  let finish!:(value:{accepted:false})=>void;const handler=vi.fn(()=>new Promise<{accepted:false}>(resolve=>{finish=resolve;})),{root,reader}=fixture({onTaskToggle:handler});await reader.render(input);const task=reader.taskAt(checkbox(root))!,pending=reader.toggleTask(task);expect(await reader.toggleTask(task)).toBe(false);finish({accepted:false});await pending;expect(handler).toHaveBeenCalledTimes(1);
  for(const change of [{generation:undefined},{sequence:undefined},{contentState:'streaming' as const},{source:'- [ ] first\r\n- [X] second\n'}]){await reader.render({...input,...change});expect(checkbox(root).disabled).toBe(true);expect(await reader.toggleTask(reader.taskAt(checkbox(root))!)).toBe(false);}
  await reader.render(input);root.dispatchEvent(new Event('compositionstart',{bubbles:true}));expect(checkbox(root).disabled).toBe(true);expect(await reader.toggleTask(reader.taskAt(checkbox(root))!)).toBe(false);root.dispatchEvent(new Event('compositionend',{bubbles:true}));expect(checkbox(root).disabled).toBe(false);
 });
 it('rejects forged references and duplicate-looking author owners without trusting their data',async()=>{
  const handler=vi.fn(ack),{root,reader}=fixture({onTaskToggle:handler});await reader.render({...input,source:'<ul><li class="task-list-item" data-source-from="2">Author<input type="checkbox"></li></ul>\n\n- [ ] first'});
  const real=reader.taskAt(checkbox(root,1))!;expect(await reader.toggleTask({...real})).toBe(false);expect(reader.taskAt(root.querySelector('li')!)).toBeNull();expect(handler).not.toHaveBeenCalled();
 });
 it('discards pending writes on destroy without publishing errors or late UI',async()=>{
  let finish!:(value:ReturnType<typeof ack>)=>void;let request!:ReaderTaskToggleRequest;const onError=vi.fn(),{root,reader}=fixture({onError,onTaskToggle:r=>{request=r;return new Promise(resolve=>{finish=resolve;});}});await reader.render(input);const pending=reader.toggleTask(reader.taskAt(checkbox(root))!);reader.destroy();finish(ack(request));expect(await pending).toBe(false);expect(root.hasChildNodes()).toBe(false);expect(onError).not.toHaveBeenCalled();
 });
 it('queries a single task text owner without focus/scroll; excludes multi-task and nested selections',async()=>{
  const {root,reader}=fixture({onTaskToggle:ack});await reader.render({...input,source:'- [ ] parent\n  - [x] child\n- [ ] sibling'});
  expect([...root.querySelectorAll<HTMLInputElement>('input')].map(node=>node.getAttribute('aria-label'))).toEqual(['parent','child','sibling']);
  const labels=root.querySelectorAll('label'),selection=document.getSelection()!,focus=vi.spyOn(HTMLElement.prototype,'focus'),scroll=vi.fn();root.scrollIntoView=scroll;
  const range=document.createRange();range.selectNodeContents(labels[1]);selection.removeAllRanges();selection.addRange(range);expect(reader.selectedTask()?.marker.expected).toBe('[x]');expect(focus).not.toHaveBeenCalled();expect(scroll).not.toHaveBeenCalled();
  range.setStart(labels[0].firstChild!,0);range.setEnd(labels[1].firstChild!,1);selection.removeAllRanges();selection.addRange(range);expect(reader.selectedTask()).toBeNull();expect(labels[0].hasAttribute('for')).toBe(false);expect(checkbox(root).tabIndex).toBe(0);
 });
});

function textNode(root:HTMLElement,text:string):Text {
 const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
 for(let node=walk.nextNode();node;node=walk.nextNode())if(node.textContent?.includes(text))return node as Text;
 throw new Error('Missing owned test text: '+text);
}
function selectText(first:Text,last=first){const range=document.createRange();range.setStart(first,0);range.setEnd(last,last.length);const selection=document.getSelection()!;selection.removeAllRanges();selection.addRange(range);}
const excludedTaskBodies=[
 ['table','| H |\n  | --- |\n  | excluded-body |'],
 ['code','```txt\n  excluded-body\n  ```'],
 ['HTML','<div>excluded-body</div>'],
 ['quote','> excluded-body'],
 ['plain child','- excluded-body'],
] as const;
describe('Reader actual renderer and AST task-body boundaries',()=>{
 it.each(excludedTaskBodies)('does not grant the parent task for %s body text',async(_kind,body)=>{
  const {root,reader}=fixture({onTaskToggle:ack});await reader.render({...input,source:'- [ ] before\n\n  '+body+'\n\n  after'});
  selectText(textNode(root,'excluded-body'));expect(reader.selectedTask()).toBeNull();expect(reader.taskAt(textNode(root,'excluded-body'))).toBeNull();
 });
 it.each(excludedTaskBodies)('rejects parent text selection crossing a %s object',async(_kind,body)=>{
  const {root,reader}=fixture({onTaskToggle:ack});await reader.render({...input,source:'- [ ] before\n\n  '+body+'\n\n  after'});
  selectText(textNode(root,'before'),textNode(root,'after'));expect(reader.selectedTask()).toBeNull();
 });
 it('allows own continuation and direct paragraphs without granting descendant objects',async()=>{
  const {root,reader}=fixture({onTaskToggle:ack});await reader.render({...input,source:'- [ ] before\n  continued\n\n  own-after\n- [ ] sibling'});
  selectText(textNode(root,'continued'));expect(reader.selectedTask()?.marker.from).toBe(2);
  selectText(textNode(root,'before'),textNode(root,'own-after'));expect(reader.selectedTask()?.marker.from).toBe(2);
 });
 it.each(['tegg','github','gfm'] as const)('binds %s displayed controls to exact raw source after frontmatter',async profile=>{
  const source='---\ntitle: own\n---\n- [ ] one\n- [ ] two\n- [ ] three\n- [ ] four';
  const {root,reader}=fixture({onTaskToggle:ack});await reader.render({...input,profile,source});
  const controls=[...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];expect(controls).toHaveLength(4);
  controls.forEach((control,index)=>{const owner=reader.taskAt(control)!;expect(owner.marker.from).toBe(source.indexOf('[ ] '+['one','two','three','four'][index]));});
 });
});

describe('Reader MarkdownIt token provenance without Editor runtime authority',()=>{
 it.each(['tegg','github','gfm'] as const)('maps duplicate nested/ordered/quoted %s task token rows with BOM LF/CRLF',async profile=>{
  for(const newline of ['\n','\r\n']){
   let source=['\uFEFF---','title: own','---','> 3. [ ] repeat','>    - [X] repeat','','- [ ] repeat','- [ ] repeat'].join(newline);
   const ownInput={...input,profile,source};const {root,reader}=fixture({onTaskToggle:request=>({accepted:true,input:{...ownInput,source:toggleTaskSource(request.source,request.task.marker),sequence:request.task.sequence+1,profileVersion:request.task.profileVersion}})});
   await reader.render(ownInput);const controls=[...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];expect(controls).toHaveLength(4);
   const expected=[...source.matchAll(/\[[ xX]\]/g)].map(match=>match.index!);controls.forEach((control,index)=>expect(reader.taskAt(control)?.marker.from).toBe(expected[index]));
   const third=reader.taskAt(controls[2])!;expect(await reader.toggleTask(third)).toBe(true);
   expect(root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[2].checked).toBe(true);expect(root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[0].checked).toBe(false);expect(root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[3].checked).toBe(false);
  }
 });
 it('binds a full original token line with repeated marker-looking body text to only its own start',async()=>{
  const source='- [ ] [ ] repeat [ ] repeat\n- [ ] [ ] repeat [ ] repeat',handler=vi.fn(request=>({accepted:false as const})),{root,reader}=fixture({onTaskToggle:handler});await reader.render({...input,source});
  const controls=[...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];expect(controls).toHaveLength(2);expect(reader.taskAt(controls[0])?.marker.from).toBe(2);expect(reader.taskAt(controls[1])?.marker.from).toBe(source.indexOf('\n')+3);
 });
 it('does not authorize copied controls or authored HTML/task/context attributes',async()=>{
  const source='<ul><li class="task-list-item" data-document-id="own" data-task-source="trusted"><input type="checkbox" data-tegg-task-key="fake">author repeat</li></ul>\n\n- [ ] repeat';
  const {root,reader}=fixture({onTaskToggle:ack});await reader.render({...input,source});const controls=[...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];expect(reader.taskAt(controls[0])).toBeNull();
  const clone=controls[1].cloneNode(true) as HTMLInputElement;root.querySelector('li')!.append(clone);expect(reader.taskAt(clone)).toBeNull();selectText(textNode(root,'author repeat'));expect(reader.selectedTask()).toBeNull();
  expect(root.querySelector('[data-tegg-task-key]')).toBeNull();expect(reader.taskAt(controls[1])?.marker.from).toBe(source.lastIndexOf('[ ]'));
 });
});

describe('new input immediately invalidates obsolete task renders',()=>{
 it.each(['same-document','different-document'])('never republishes writable owners before the newer streaming frame: %s',async(identity)=>{
  let frame!:FrameRequestCallback;
  vi.spyOn(globalThis,'requestAnimationFrame').mockImplementation(callback=>{frame=callback;return 1;});
  const handler=vi.fn(ack),{root,reader}=fixture({onTaskToggle:handler});
  const oldRender=reader.render(input);
  const next={...input,documentId:identity==='same-document'?input.documentId:'new-owner',sequence:1,source:'- [ ] newest',taskToggleEnabled:false,contentState:'streaming' as const};
  const newestRender=reader.render(next);
  expect(frame).toBeTypeOf('function');
  await oldRender;
  // Inspect the overlap itself, before allowing the newest render to run.
  expect(checkbox(root).disabled).toBe(true);
  expect(reader.taskAt(checkbox(root))).toBeNull();
  checkbox(root).click();expect(handler).not.toHaveBeenCalled();
  frame(0);await newestRender;
  const task=reader.taskAt(checkbox(root))!;
  expect(task.documentId).toBe(next.documentId);expect(task.sequence).toBe(1);
  expect(root.textContent).toContain('newest');expect(root.textContent).not.toContain('first');
  expect(checkbox(root).disabled).toBe(true);expect(await reader.toggleTask(task)).toBe(false);
  expect(handler).not.toHaveBeenCalled();expect(next.source).toBe('- [ ] newest');
 });
 it('aborts a pending Host ACK at receipt of streaming input before the next frame',async()=>{
  let frame!:FrameRequestCallback;
  vi.spyOn(globalThis,'requestAnimationFrame').mockImplementation(callback=>{frame=callback;return 1;});
  let request!:ReaderTaskToggleRequest,finish!:(value:ReturnType<typeof ack>)=>void;
  const onError=vi.fn(),handler=vi.fn((value:ReaderTaskToggleRequest)=>{request=value;return new Promise<ReturnType<typeof ack>>(resolve=>{finish=resolve;});});
  const {root,reader}=fixture({onTaskToggle:handler,onError});await reader.render(input);
  const oldTask=reader.taskAt(checkbox(root))!,pending=reader.toggleTask(oldTask);
  const newest=reader.render({...input,source:'- [ ] newest',sequence:1,taskToggleEnabled:false,contentState:'streaming'});
  expect(request.signal.aborted).toBe(true);expect(checkbox(root).disabled).toBe(true);
  expect(reader.taskAt(checkbox(root))).toBeNull();
  finish(ack(request));expect(await pending).toBe(false);
  expect(checkbox(root).checked).toBe(false);expect(checkbox(root).disabled).toBe(true);
  expect(onError).not.toHaveBeenCalled();expect(handler).toHaveBeenCalledTimes(1);
  frame(0);await newest;
  expect(reader.taskAt(checkbox(root))!.sequence).toBe(1);expect(checkbox(root).checked).toBe(false);
  expect(checkbox(root).disabled).toBe(true);expect(root.textContent).toContain('newest');
  expect(await reader.toggleTask(oldTask)).toBe(false);expect(handler).toHaveBeenCalledTimes(1);
 });
});
