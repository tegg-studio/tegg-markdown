import {test,expect,type Page,type Locator} from '@playwright/test';

// The reliable consumer imports the packed public package, never a source alias.
const environment=(globalThis as {process?:{env:Record<string,string|undefined>}}).process?.env;
const url=environment?.TEGG_CLIPBOARD_TEST_URL??'http://127.0.0.1:18930/reliable.html';
test.use({hasTouch:true,viewport:{width:390,height:844}});
const caretAParagraph='Caret A\n\n';
const gfmA='| A | B |\n| --- | --- |\n| original-a | untouched-a |';
const gfmB='| H | R |\n| --- | --- |\n| old-b | untouched-b |';
const htmlA='<table><tr><td>original-a</td><td>untouched-a</td></tr></table>';
const htmlB='<table class="keep"><tr><td rowspan="2"><strong>Span B</strong></td><td>B2</td></tr><tr><td>B3</td></tr></table>';
const gfmLabels=['Edit cell','Add Row','Add Column','Select range','Copy cells','Cut cells','Paste','Paste plain text','Merge cells','Insert paragraph','Keep empty paragraph','Edit Source','Insert row before','Insert row after','Delete row','Insert column before','Insert column after','Delete column','Align left','Align center','Align right','Clear alignment','Delete table'];
const htmlLabels=['Edit cell','Copy cells','Cut cells','Paste','Paste plain text','Delete table','Insert paragraph','Insert list item','Keep empty paragraph','Set range start','Set range end','Clear content','Merge cells','Unmerge cell','Insert row below','Insert column after','Delete row','Delete column','Edit Source'];
type Kind='gfm'|'html';
type Copy={text:string;html:string;structured:string;mime:string};
const source=(page:Page)=>page.evaluate(()=>(window as any).host.editor.source as string);
const state=(page:Page)=>page.evaluate(()=>{const editor=(window as any).host.editor,selection=editor.view.state.selection.main;return {mode:editor.mode,readOnly:editor.view.state.readOnly,anchor:selection.anchor,head:selection.head,dirty:editor.dirty,snapshot:editor.snapshot()};});
function documentSource(kind:Kind,readonly=false){const a=kind==='gfm'?gfmA:htmlA,b=kind==='gfm'?gfmB:htmlB;const text=caretAParagraph+a+'\n\nBetween\n\n'+b+'\n\nAfter';return readonly?text.replaceAll('\n','\r\n')+'\nMixed newline tail':text;}
async function open(page:Page,kind:Kind,readonly=false){
 const original=documentSource(kind,readonly);await page.goto(url);await page.evaluate(value=>{const host=(window as any).host;host.load(value,{documentPath:'tables/original.md'});host.editor.view.dispatch({selection:{anchor:2}});host.editor.view.focus();},original);
 await expect.poll(async()=>{const current=await state(page);return {mode:current.mode,readOnly:current.readOnly};}).toEqual({mode:'live',readOnly:readonly});
 await expect(page.locator(kind==='gfm'?'.cm-live-table':'.cm-live-html-table')).toHaveCount(2);
 expect(await source(page)).toBe(original);const initial=await state(page);expect(initial.anchor).toBe(2);expect(initial.head).toBe(2);expect(initial.dirty).toBe(false);return {original,initial};
}
function panelB(page:Page,kind:Kind){return page.locator(kind==='gfm'?'.cm-live-table':'.cm-live-html-table').nth(1);}
function previewB(page:Page,kind:Kind){return kind==='gfm'?panelB(page,kind).locator('thead th').first().locator('.cm-live-table-preview'):panelB(page,kind).locator('td').first();}
async function tap(page:Page,target:Locator){
 await target.scrollIntoViewIfNeeded();await expect(target).toBeVisible();const box=await target.boundingBox();expect(box).not.toBeNull();
 const x=box!.x+box!.width/2,y=box!.y+box!.height/2;
 const hit=await target.evaluate((node,point)=>{const top=document.elementFromPoint(point.x,point.y);return {owns:top===node||!!top&&node.contains(top),target:top?.outerHTML.slice(0,900),rect:{x:node.getBoundingClientRect().x,y:node.getBoundingClientRect().y,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}};},{x,y});
 expect(hit,JSON.stringify(hit)).toMatchObject({owns:true});await page.touchscreen.tap(x,y);
}
async function assertCaretAndSource(page:Page,original:string,initial:Awaited<ReturnType<typeof state>>){expect(await source(page)).toBe(original);const current=await state(page);expect({anchor:current.anchor,head:current.head}).toEqual({anchor:initial.anchor,head:initial.head});expect(current.snapshot.sequence).toBe(initial.snapshot.sequence);}
async function openTouchedB(page:Page,kind:Kind,readonly:boolean,original:string,initial:Awaited<ReturnType<typeof state>>){
 await tap(page,previewB(page,kind));if(kind==='gfm')await expect(panelB(page,kind).locator('thead th').first()).toHaveAttribute('data-cell-state','selected');else await expect(previewB(page,kind)).toHaveAttribute('aria-selected','true');
 await expect(panelB(page,kind).locator('.md-table-inline-editor,.md-html-cell-editing')).toHaveCount(0);await assertCaretAndSource(page,original,initial);
 const from=await page.evaluate(kind=>{const text=(window as any).host.editor.view.state.doc.toString();return text.indexOf(kind==='gfm'?'| H | R |':'<table class="keep">');},kind);
 const trigger=page.locator('.tegg-command-more');await expect(trigger).toBeVisible();await expect(trigger).toHaveAttribute('data-block-from',String(from));if(readonly)await expect(page.locator('.tegg-command-plus')).toBeHidden();
 await tap(page,trigger);const menu=page.locator('.tegg-command-menu');await expect(menu).toBeVisible();await expect(menu.locator('.tegg-command-option-label')).toHaveText(readonly?['Copy cells']:kind==='gfm'?gfmLabels:htmlLabels);await assertCaretAndSource(page,original,initial);return {trigger,menu};
}
async function undoOnce(page:Page,original:string){expect(await page.evaluate(()=>(window as any).host.editor.command('undo'))).toBe(true);await expect.poll(()=>source(page)).toBe(original);expect(await page.evaluate(()=>(window as any).host.editor.command('undo'))).toBe(false);}
async function installClipboard(page:Page){await page.evaluate(()=>{const captured={values:[] as Copy[],completions:[] as Array<(success:boolean,error?:string)=>void>};(window as any).tableActionClipboard=captured;document.addEventListener('tegg-copy-table',event=>{event.preventDefault();const detail=(event as CustomEvent).detail;captured.values.push({text:detail.text,html:detail.html,structured:detail.structured,mime:detail.mime});captured.completions.push(detail.complete);});});}
async function copied(page:Page){await expect.poll(()=>page.evaluate(()=>(window as any).tableActionClipboard.values.length)).toBe(1);return page.evaluate(()=>(window as any).tableActionClipboard.values[0] as Copy);}
async function ack(page:Page){await page.evaluate(async()=>{const captured=(window as any).tableActionClipboard;captured.completions[0](true);await Promise.resolve();await Promise.resolve();await Promise.resolve();});}
function assertCopy(copy:Copy,kind:Kind){
 expect(copy.mime).toBe('application/x-tegg-table+json');expect(copy.text).toBe(kind==='gfm'?'H':'Span B\n');expect(copy.html).toContain('<table>');expect(copy.html).not.toContain('original-a');
 const structured=JSON.parse(copy.structured);expect(structured.version).toBe(1);expect(structured.rows).toBe(kind==='gfm'?1:2);expect(structured.columns).toBe(1);expect(structured.cells).toHaveLength(1);
 expect(structured.cells[0]).toMatchObject({row:0,column:0,rowspan:kind==='gfm'?1:2,colspan:1,kind:kind==='gfm'?'th':'td',html:kind==='gfm'?'H':'<strong>Span B</strong>'});
 expect(copy.html).toContain(kind==='gfm'?'<th>H</th>':'<td rowspan="2"><strong>Span B</strong></td>');
}

test.afterEach(async({page},info)=>{if(info.status===info.expectedStatus)return;await info.attach('table-action-current-state',{body:JSON.stringify(await page.evaluate(()=>{const host=(window as any).host,editor=host?.editor;return {source:editor?.source,mode:editor?.mode,readOnly:editor?.view.state.readOnly,selection:editor?{anchor:editor.view.state.selection.main.anchor,head:editor.view.state.selection.main.head}:null,errors:host?.errors,clipboard:(window as any).tableActionClipboard?.values,panels:[...document.querySelectorAll('.cm-live-table,.cm-live-html-table')].map(node=>({html:node.outerHTML.slice(0,2500),rect:node.getBoundingClientRect().toJSON()}))};}),null,2),contentType:'application/json'});});

for(const action of ['Add Row','Add Column'] as const)test(`real touch locks GFM B while caret stays in A; ${action} appends and one Undo restores exact Source`,async({page})=>{
 const{original,initial}=await open(page,'gfm'),{trigger,menu}=await openTouchedB(page,'gfm',false,original,initial);
 await page.keyboard.press('Escape');await expect(menu).toBeHidden();await assertCaretAndSource(page,original,initial);await tap(page,trigger);await expect(menu).toBeVisible();
 await tap(page,menu.getByRole('option',{name:action,exact:true}));const expected=original.replace(gfmB,action==='Add Row'?gfmB+'\n|  |  |':'| H | R |  |\n| --- | --- | --- |\n| old-b | untouched-b |  |');
 await expect.poll(()=>source(page)).toBe(expected);const after=await state(page);expect({anchor:after.anchor,head:after.head}).toEqual({anchor:initial.anchor,head:initial.head});expect(after.snapshot.sequence).toBe(initial.snapshot.sequence+1);expect(after.dirty).toBe(true);expect((await source(page)).slice(caretAParagraph.length,caretAParagraph.length+gfmA.length)).toBe(gfmA);await undoOnce(page,original);
});

test('real touch locks HTML B with a span; Cancel retains A and insert after the selected span has one exact Undo',async({page})=>{
 const{original,initial}=await open(page,'html'),{trigger,menu}=await openTouchedB(page,'html',false,original,initial);
 await page.keyboard.press('Escape');await expect(menu).toBeHidden();await assertCaretAndSource(page,original,initial);await tap(page,trigger);await expect(menu).toBeVisible();await tap(page,page.getByRole('heading',{name:'Markdown editing workspace',exact:true}));await expect(menu).toBeHidden();await assertCaretAndSource(page,original,initial);await openTouchedB(page,'html',false,original,initial);await tap(page,menu.getByRole('option',{name:'Insert column after',exact:true}));
 const expected=original.replace('<td>B2</td>','<td></td><td>B2</td>').replace('<td>B3</td>','<td></td><td>B3</td>');await expect.poll(()=>source(page)).toBe(expected);expect((await source(page)).slice(caretAParagraph.length,caretAParagraph.length+htmlA.length)).toBe(htmlA);const after=await state(page);expect({anchor:after.anchor,head:after.head}).toEqual({anchor:initial.anchor,head:initial.head});expect(after.snapshot.sequence).toBe(initial.snapshot.sequence+1);await undoOnce(page,original);
});

for(const kind of ['gfm','html'] as const)test(`real mixed-newline readonly Live ${kind} preserves touched-B Copy-only with all three representations and ACK`,async({page})=>{
 const{original,initial}=await open(page,kind,true);await installClipboard(page);const{menu}=await openTouchedB(page,kind,true,original,initial);await tap(page,menu.getByRole('option',{name:'Copy cells',exact:true}));assertCopy(await copied(page),kind);await assertCaretAndSource(page,original,initial);
 await ack(page);await expect(panelB(page,kind).locator(kind==='gfm'?'.md-table-status':'.md-html-table-error')).toHaveText('Copied');await assertCaretAndSource(page,original,initial);expect((await state(page)).dirty).toBe(false);expect(await page.evaluate(()=>(window as any).host.editor.command('undo'))).toBe(false);
});

for(const kind of ['gfm','html'] as const)test(`old ${kind} asynchronous Cut ACK cannot write after public document/context/generation replacement with readonly Live`,async({page})=>{
 const{original,initial}=await open(page,kind);await installClipboard(page);const{menu}=await openTouchedB(page,kind,false,original,initial);await tap(page,menu.getByRole('option',{name:'Cut cells',exact:true}));assertCopy(await copied(page),kind);await assertCaretAndSource(page,original,initial);
 const replacement=documentSource(kind,true).replace('Between','Replacement document');const switched=await page.evaluate(value=>{const host=(window as any).host,result=host.editor.replaceDocument({documentId:'replacement-document',revision:'replacement-revision',source:value,profile:'tegg',documentPath:'moved/replacement.md'});host.ui.attachToCurrentState();return {result,before:(window as any).tableActionClipboard.values[0],snapshot:host.editor.snapshot()};},replacement);
 expect(switched.result).toBe('applied');expect(switched.snapshot.documentId).toBe('replacement-document');expect(switched.snapshot.generation).not.toBe(initial.snapshot.generation);expect(await source(page)).toBe(replacement);expect(await state(page)).toMatchObject({mode:'live',readOnly:true,dirty:false});await expect(page.locator('.tegg-command-menu')).toBeHidden();
 await ack(page);await expect.poll(()=>source(page)).toBe(replacement);expect(await state(page)).toMatchObject({mode:'live',readOnly:true,dirty:false});expect((await state(page)).snapshot.sequence).toBe(0);expect(await page.evaluate(()=>(window as any).host.editor.command('undo'))).toBe(false);
});
