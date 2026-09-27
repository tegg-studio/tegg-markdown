import {test,expect} from '@playwright/test';

test('table controls fit desktop and narrow layouts without losing secondary actions',async({page})=>{
  const source='| Name | Value |\n| --- | --- |\n| cat | old |\n\nEnd';
  await page.goto('http://127.0.0.1:18930/reliable.html');
  await page.evaluate(value=>(window as any).host.load(value),source);
  const toolbar=page.locator('.md-table-toolbar');
  for(const width of [720,390]){
    await page.setViewportSize({width,height:800});
    await expect(toolbar).toBeVisible();
    const geometry=await toolbar.evaluate(element=>{
      const bounds=element.getBoundingClientRect();
      const children=Array.from(element.querySelectorAll('.md-table-dimensions,button,select')).map(child=>{
        const rect=child.getBoundingClientRect();
        return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height};
      });
      return {left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom,children,
        dimensionWrap:getComputedStyle(element.querySelector('.md-table-dimensions')!).whiteSpace};
    });
    expect(geometry.dimensionWrap).toBe('nowrap');
    for(const child of geometry.children){
      expect(child.width).toBeGreaterThan(0);expect(child.height).toBeGreaterThan(0);
      expect(child.left).toBeGreaterThanOrEqual(geometry.left-1);
      expect(child.right).toBeLessThanOrEqual(geometry.right+1);
      expect(child.bottom).toBeLessThanOrEqual(geometry.bottom+1);
    }
    if(width===720){
      const centers=geometry.children.map(child=>(child.top+child.bottom)/2);
      expect(Math.max(...centers)-Math.min(...centers)).toBeLessThan(3);
    }
    await expect(toolbar.getByRole('button',{name:'Add Row',exact:true})).toBeVisible();
    await expect(toolbar.getByRole('button',{name:'Add Column',exact:true})).toBeVisible();
    const menu=toolbar.getByRole('combobox',{name:'Table actions'});
    await expect(menu.locator('option[value="select-range"]')).toHaveText('Select range');
    await expect(menu.locator('option[value="copy-cells"]')).toHaveText('Copy cells');
    await expect(menu.locator('option[value="edit-source"]')).toHaveText('Edit Source');
    await menu.selectOption('select-range');
    await expect(page.locator('.md-table-status')).toHaveText('Select the opposite corner of the range.');
    await menu.press('Escape');
  }
  expect(await page.evaluate(()=>(window as any).host.editor.source)).toBe(source);
});


test('table preview blocks stale prose commands while history and find remain usable',async({page})=>{
  const original='> [!NOTE]\n> Outside\n\n| A | B |\n| --- | --- |\n| old | 2 |\n\nEnd';
  const source=()=>page.evaluate(()=>(window as any).host.editor.source as string);
  await page.goto('http://127.0.0.1:18930/reliable.html');
  await page.evaluate(value=>{
    const host=(window as any).host;host.load(value);host.select('Outside');host.editor.view.focus();
  },original);
  await page.getByRole('button',{name:'Edit table cell: old',exact:true}).click();
  const cell=page.locator('.md-table-inline-editor .cm-content');
  await cell.press('ControlOrMeta+A');await page.keyboard.type('changed');
  const edited=original.replace('| old |','| changed |');
  await expect.poll(source).toBe(edited);await cell.press('Escape');
  const tools=page.locator('#tools');
  await expect(tools.getByRole('button',{name:'Bold',exact:true})).toBeDisabled();
  await expect(tools.getByRole('button',{name:'List',exact:true})).toBeDisabled();
  await expect(tools.getByRole('button',{name:'Undo',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>{
    const editor=(window as any).host.editor;
    return {bold:editor.command('bold'),list:editor.command('list'),heading:editor.command('heading2'),callout:editor.state.callout};
  })).toEqual({bold:false,list:false,heading:false,callout:null});
  expect(await source()).toBe(edited);
  await tools.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(source).toBe(original);
  await tools.getByRole('button',{name:'Redo',exact:true}).click();await expect.poll(source).toBe(edited);
  await expect(tools.getByRole('button',{name:'Bold',exact:true})).toBeDisabled();
  await page.getByRole('combobox',{name:'Table actions'}).focus();
  expect(await page.evaluate(()=>(window as any).host.editor.command('undo'))).toBe(true);
  await expect.poll(source).toBe(original);
  await tools.getByRole('button',{name:'Redo',exact:true}).click();await expect.poll(source).toBe(edited);
  await tools.getByRole('button',{name:'Find and replace',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Find and replace'})).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await source()).toBe(edited);
  await page.getByRole('button',{name:'Edit table cell: changed',exact:true}).click();
  await expect(cell).toBeFocused();await expect(tools.getByRole('button',{name:'Bold',exact:true})).toBeEnabled();
  await cell.press('Escape');await page.locator('.cm-line').filter({hasText:/Outside/}).click();
  await expect(tools.getByRole('button',{name:'Bold',exact:true})).toBeEnabled();
  await expect(tools.getByRole('button',{name:'List',exact:true})).toBeEnabled();
  expect(await source()).toBe(edited);
});
