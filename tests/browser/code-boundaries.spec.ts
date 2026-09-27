import {test,expect, type Page} from '@playwright/test';
async function open(page:Page,source:string){
 await page.goto('http://127.0.0.1:18915/react.html');
 await page.evaluate(source=>(window as any).host.show('editor',source),source);
 await expect.poll(()=>page.evaluate(()=>!!(window as any).host.instance)).toBe(true);
 await page.evaluate(()=>(window as any).host.instance.setMode('live'));
}
const sourceOf=(page:Page)=>page.evaluate(()=>(window as any).host.instance.source);
async function caret(page:Page,anchor:number,head=anchor){await page.evaluate(({anchor,head})=>{const v=(window as any).host.instance.view;v.dispatch({selection:{anchor,head}});v.focus();},{anchor,head});}
const containers=[['root','paragraph',''],['bullet','- paragraph','  '],['wide','100. paragraph','     '],['nested','- parent\n  - paragraph','    '],['task','- [ ] paragraph','  '],['quote','> paragraph','> '],['quoted list','> - paragraph','>   ']];
for(const [name,lead,prefix] of containers) for(const fenced of [false,true]) test(`code boundaries ${name} ${fenced?'fenced':'indented'} delete and repeat undo`,async({page})=>{
 const code=(fenced?'```\nfirst\n    nested\n```':'    first\n        nested').split('\n').map(l=>prefix+l).join('\n');
 const gap='\n'+(prefix.includes('>')?'>':'')+'\n';
 const source=lead+gap+code+'\n\n'+(prefix?'- next':'tail');
 await open(page,source);
 const input=page.getByRole('textbox',{name:/Code content|代码内容/});
 await expect(input).toHaveValue('first\n    nested');
 for(const method of ['backward','forward','selection','cut']){
  if(method==='backward'){await caret(page,lead.length+1);await page.keyboard.press('Backspace');}
  else if(method==='forward'){await caret(page,lead.length);await page.keyboard.press('Delete');}
  else{await caret(page,lead.length,lead.length+gap.length);await page.keyboard.press(method==='cut'?'ControlOrMeta+x':'Backspace');}
  await expect(input).toHaveValue('first\n    nested');
  const changed=await sourceOf(page);
  expect(changed).not.toBe(source);
  expect(changed.startsWith(lead+"\n")).toBe(true);
  for(let round=0;round<3;round++){
   await page.keyboard.press('ControlOrMeta+z');expect(await sourceOf(page)).toBe(source);
   await page.keyboard.press('ControlOrMeta+Shift+z');expect(await sourceOf(page)).toBe(changed);
   await expect(input).toHaveValue('first\n    nested');
  }
  await page.keyboard.press('ControlOrMeta+z');
 }
});
for(const [name,lead,prefix] of [...containers,['quoted','> paragraph','> ']])test(`code boundaries ${name} empty and boundary lines remain editable`,async({page})=>{
 const source=lead+'\n'+(prefix.includes('>')?'>':'')+'\n'+prefix+'    first\n'+prefix+'        nested';
 await open(page,source);
 const input=page.getByRole('textbox',{name:/Code content|代码内容/});
 await expect(input).toHaveValue('first\n    nested');
 await input.fill('');await expect(input).toHaveValue('');await expect(input).toBeFocused();
 await input.press('Enter');await input.press('Tab');await input.press('X');
 await expect(input).toHaveValue('\n    X');
 await input.evaluate((el:HTMLTextAreaElement)=>el.setSelectionRange(0,0));await input.press('Backspace');
 await expect(input).toHaveValue('\n    X');
 const changed=await sourceOf(page);
 await page.evaluate(()=>(window as any).host.instance.setMode('source'));
 await page.evaluate(()=>(window as any).host.instance.setMode('live'));
 await expect(input).toHaveValue('\n    X');expect(await sourceOf(page)).toBe(changed);
 // Text input groups by elapsed time; fill, Return, Tab and typing may form
 // several history entries on a slower engine. Replay every actual entry.
 const checkpoints=[changed];
 for(let step=0;step<8&&await sourceOf(page)!==source;step++){
  await input.press('ControlOrMeta+z');checkpoints.push(await sourceOf(page));
 }
 expect(await sourceOf(page)).toBe(source);await expect(input).toHaveValue('first\n    nested');
 for(let round=0;round<3;round++){
  for(let step=checkpoints.length-2;step>=0;step--){await input.press('ControlOrMeta+Shift+z');expect(await sourceOf(page)).toBe(checkpoints[step]);}
  await expect(input).toHaveValue('\n    X');
  for(let step=1;step<checkpoints.length;step++){await input.press('ControlOrMeta+z');expect(await sourceOf(page)).toBe(checkpoints[step]);}
  await expect(input).toHaveValue('first\n    nested');
 }
});
test('code boundaries outside caret selects whole block before delete; source remains literal',async({page})=>{
 const source='paragraph\n\n    code\n\ntail';await open(page,source);
 const input=page.getByRole('textbox',{name:/Code content|代码内容/});
 await caret(page,11);await page.keyboard.press('Delete');await expect(input).toHaveValue('code');
 expect(await page.evaluate(()=>(window as any).host.instance.selection().range)).toEqual({from:11,to:19});
 await page.keyboard.press('Delete');await expect(input).toHaveCount(0);
 await page.keyboard.press('ControlOrMeta+z');await expect(input).toHaveValue('code');
 await page.evaluate(()=>(window as any).host.instance.setMode('source'));
 await caret(page,10);await page.keyboard.press('Backspace');expect(await sourceOf(page)).toBe('paragraph\n    code\n\ntail');
});
