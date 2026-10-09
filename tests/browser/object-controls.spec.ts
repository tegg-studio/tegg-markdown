import {test,expect} from '@playwright/test';
const url='http://127.0.0.1:18930/reliable.html';
test('object toolbar and compact image sheet retain accessible exits at desktop and narrow sizes',async({page})=>{
  const original='![Missing illustration](missing.png)\n\nEnd';
  await page.goto(url);await page.evaluate(value=>(window as any).host.load(value),original);
  const figure=page.locator('.cm-live-image');await expect(figure.locator('.md-image-unavailable')).toBeVisible();await expect(figure.locator('img')).toBeHidden();
  await figure.hover();await expect(figure.locator('.md-object-toolbar')).toBeHidden();
  // R02: unavailable/small artwork keeps its content bounds and uses the existing selected-object entry.
  const bounds=await figure.boundingBox();await figure.click();await expect.poll(async()=>{const next=await figure.boundingBox();return [next!.width,next!.height];}).toEqual([bounds!.width,bounds!.height]);expect(await page.evaluate(()=>(window as any).host.editor.source)).toBe(original);
  const selectedBounds=await figure.boundingBox();expect(selectedBounds!.width).toBe(bounds!.width);expect(selectedBounds!.height).toBe(bounds!.height);
  await page.locator('.tegg-editing-toolbar').getByRole('button',{name:'Image',exact:true}).click();const panel=page.getByRole('dialog',{name:'Edit image',exact:true});
  for(const width of [1000,390]){
    await page.setViewportSize({width,height:650});await expect(panel).toBeVisible();
    let previous='',box:{x:number;y:number;width:number;height:number}|null=null;
    await expect.poll(async()=>{box=await panel.boundingBox();if(!box)return false;const signature=JSON.stringify(box),stable=signature===previous;previous=signature;return stable&&box.width<=Math.min(840,width-32)&&box.x>=0&&box.x+box.width<=width;}).toBe(true);
    expect(box!.width).toBeLessThanOrEqual(Math.min(840,width-32));expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);
    for(const label of ['Cancel','Done']){const button=panel.getByRole('button',{name:label,exact:true});await expect(button).toBeInViewport();}
  }
  await panel.getByLabel('Target',{exact:true}).fill('replacement.png');await panel.press('Escape');
  await expect(panel.getByRole('button',{name:'Keep editing',exact:true})).toBeFocused();await panel.getByRole('button',{name:'Keep editing',exact:true}).click();
  await panel.press('Escape');await panel.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(panel).toBeHidden();
  expect(await page.evaluate(()=>(window as any).host.editor.source)).toBe(original);
});
test('formula has one action row, a positioned matrix preview and stable apply undo',async({page})=>{
  const original=String.raw`$$
\begin{bmatrix}1&2\\3&4\end{bmatrix}
$$

End`;
  await page.goto(url);await page.evaluate(value=>(window as any).host.load(value),original);
  const block=page.locator('.cm-preview-widget').filter({has:page.locator('.katex')});
  await expect(block.locator('.md-object-toolbar')).toHaveCount(1);await block.hover();await block.getByRole('button',{name:'Edit formula',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'Edit formula',exact:true});await expect(panel.locator('.tegg-object-preview .katex')).toBeVisible();await expect(panel.locator('.tegg-object-preview .vlist [style*="top"]').first()).toBeAttached();
  await panel.getByLabel('Formula source',{exact:true}).fill('x^2');await panel.getByRole('button',{name:'Done',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).host.editor.source)).toContain('x^2');await page.getByRole('button',{name:'Undo',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).host.editor.source)).toBe(original);
  await block.hover();await block.getByRole('button',{name:'View formula',exact:true}).click();await expect(page.locator('.md-formula-viewer')).toBeVisible();
  await page.locator('.md-formula-viewer').getByRole('button',{name:'Close',exact:true}).click();await expect(page.locator('.md-formula-viewer')).toHaveCount(0);
});

test('Graphviz starts after a Live Edit widget is attached',async({page})=>{
  await page.goto(url);await page.evaluate(value=>(window as any).host.load(value),'```dot\ndigraph { A -> B }\n```\n\nEnd');
  await expect(page.locator('.cm-preview-widget .diagram-canvas')).toHaveAttribute('data-render-state','ready');
  await expect(page.locator('.cm-preview-widget .diagram-canvas > svg')).toBeVisible();
});

for(const entry of [
  {button:'Formula',source:'$$\nx^2\n$$',render:'.katex'},
  {button:'Mermaid',source:'```mermaid\nflowchart LR\n A --> B\n```',render:'svg'},
  {button:'GraphViz',source:'```dot\ndigraph { A -> B }\n```',render:'svg'},
  {button:'Image',source:'![Missing](missing.png)',render:'.md-image-unavailable'},

])test(`${entry.button} stacks or splits its independent workspace using the actual internal width`,async({page})=>{
  await page.setViewportSize({width:720,height:700});await page.goto(url);
  await page.evaluate(value=>{(window as any).host.load(value);(window as any).host.editor.view.dispatch({selection:{anchor:2}});},entry.source+'\n\nEnd');
  await page.getByRole('button',{name:entry.button,exact:true}).click();
  const panel=page.getByRole('dialog'),left=panel.locator('.tegg-source-pane'),right=panel.locator('.tegg-preview-pane');
  await expect(right.locator(entry.render).first()).toBeVisible();
  async function stableWorkspaceGeometry(){
    let previous='',geometry:{internal:number;columns:string|null;a:{x:number;y:number;width:number;height:number};b:{x:number;y:number;width:number;height:number}}|undefined;
    await expect.poll(async()=>{
      geometry=await panel.evaluate(node=>{const content=node.querySelector('.tegg-editing-content') as HTMLElement,source=node.querySelector('.tegg-source-pane') as HTMLElement,preview=node.querySelector('.tegg-preview-pane') as HTMLElement;const a=source.getBoundingClientRect(),b=preview.getBoundingClientRect();return {internal:content.clientWidth-32,columns:node.getAttribute('data-columns'),a:{x:a.x,y:a.y,width:a.width,height:a.height},b:{x:b.x,y:b.y,width:b.width,height:b.height}};});
      const signature=JSON.stringify(geometry),stable=signature===previous;previous=signature;
      const expected=['Mermaid','GraphViz','Image'].includes(entry.button)&&geometry.internal>=600?'2':'1';const aligned=geometry.columns==='2'?geometry.b.x>=geometry.a.x+geometry.a.width-1&&Math.abs(geometry.a.y-geometry.b.y)<2:geometry.b.y>=geometry.a.y+geometry.a.height-1;
      return stable&&geometry.columns===expected&&aligned;
    }).toBe(true);
    return geometry!;
  }
  for(const width of [1000,720,600]){
    await page.setViewportSize({width,height:700});
    const geometry=await stableWorkspaceGeometry();const {a,b,columns}=geometry;
    if(columns==='2'){expect(b.x).toBeGreaterThanOrEqual(a.x+a.width-1);expect(Math.abs(a.y-b.y)).toBeLessThan(2);}else expect(b.y).toBeGreaterThanOrEqual(a.y+a.height-1);
    for(const name of ['Cancel','Done'])await expect(panel.getByRole('button',{name,exact:true})).toBeInViewport();
  }
  await page.setViewportSize({width:390,height:650});await expect(panel).toHaveAttribute('data-columns','1');
  const {a,b}=await stableWorkspaceGeometry();expect(b.y).toBeGreaterThanOrEqual(a.y+a.height-1);
  expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await panel.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).host.editor.source)).toBe(entry.source+'\n\nEnd');
});
