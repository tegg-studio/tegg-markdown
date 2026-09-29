import {test,expect} from '@playwright/test';
const url='http://127.0.0.1:18930/reliable.html';
test('object toolbar and compact image sheet retain accessible exits at desktop and narrow sizes',async({page})=>{
  const original='![Missing illustration](missing.png)\n\nEnd';
  await page.goto(url);await page.evaluate(value=>(window as any).host.load(value),original);
  const figure=page.locator('.cm-live-image');await expect(figure.locator('.md-image-unavailable')).toBeVisible();await expect(figure.locator('img')).toBeHidden();
  await figure.hover();const edit=figure.getByRole('button',{name:'Edit image',exact:true});await expect(edit).toBeVisible();
  const a=await figure.boundingBox(),b=await edit.boundingBox();expect(b!.x).toBeGreaterThan(a!.x+a!.width/2);expect(b!.y).toBeLessThan(a!.y+40);
  await edit.click();const panel=page.getByRole('dialog',{name:'Edit image',exact:true});
  for(const width of [1000,390]){
    await page.setViewportSize({width,height:650});await expect(panel).toBeVisible();
    const box=await panel.boundingBox();expect(box!.width).toBeLessThanOrEqual(Math.min(840,width-32));expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);
    for(const label of ['Close','Cancel','Apply']){const button=panel.getByRole('button',{name:label,exact:true});await expect(button).toBeInViewport();}
  }
  await panel.getByLabel('Target',{exact:true}).fill('replacement.png');await panel.getByRole('button',{name:'Close',exact:true}).click();
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
  await panel.getByLabel('Formula source',{exact:true}).fill('x^2');await panel.getByRole('button',{name:'Apply',exact:true}).click();
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
  {button:'Callout',source:'> [!note]\n> Sample',render:'.callout'},
])test(`${entry.button} keeps Source left and live preview right in a Mac content column`,async({page})=>{
  await page.setViewportSize({width:720,height:700});await page.goto(url);
  await page.evaluate(value=>{(window as any).host.load(value);(window as any).host.editor.view.dispatch({selection:{anchor:2}});},entry.source+'\n\nEnd');
  await page.getByRole('button',{name:entry.button,exact:true}).click();
  const panel=page.getByRole('dialog'),left=panel.locator('.tegg-source-pane'),right=panel.locator('.tegg-preview-pane');
  await expect(right.locator(entry.render).first()).toBeVisible();
  for(const width of [1000,720,600]){
    await page.setViewportSize({width,height:700});const a=await left.boundingBox(),b=await right.boundingBox();
    expect(b!.x).toBeGreaterThanOrEqual(a!.x+a!.width-1);expect(Math.abs(a!.y-b!.y)).toBeLessThan(2);
    for(const name of ['Close','Cancel','Apply'])await expect(panel.getByRole('button',{name,exact:true})).toBeInViewport();
  }
  await page.setViewportSize({width:390,height:650});
  const a=await left.boundingBox(),b=await right.boundingBox();expect(b!.y).toBeGreaterThanOrEqual(a!.y+a!.height-1);
  expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await panel.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).host.editor.source)).toBe(entry.source+'\n\nEnd');
});
