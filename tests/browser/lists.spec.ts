import {test, expect} from '@playwright/test';

test('live lists keep numbering and hanging layout through editing', async ({page}) => {
  await page.goto('http://127.0.0.1:18915/react.html');
  const source = '- first\n    - child\n        - third\n            - long '.concat('word '.repeat(35), '\n- back\n\nParagraph\n\n100. one\n1. two');
  await page.evaluate(source => (window as any).host.show('editor', source), source);
  await expect.poll(() => page.evaluate(() => !!(window as any).host.instance)).toBe(true);
  await page.evaluate(() => (window as any).host.instance.setMode('live'));
  await page.locator('main').evaluate(el => el.style.width = '440px');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const markers = page.locator('.cm-live-list-marker');
  await expect(markers).toHaveText(['•','•','•','•','•','100.','101.']);
  const rows = page.locator('.cm-live-list-row');
  const before = await rows.evaluateAll(nodes => nodes.map(n => ({height:n.getBoundingClientRect().height, padding:getComputedStyle(n).paddingInlineStart})));
  await markers.first().click();
  await expect(markers).toHaveText(['•','•','•','•','•','100.','101.']);
  expect(await rows.evaluateAll(nodes => nodes.map(n => ({height:n.getBoundingClientRect().height, padding:getComputedStyle(n).paddingInlineStart})))).toEqual(before);
  await page.keyboard.insertText('X');
  expect(await page.evaluate(() => (window as any).host.instance.source)).toBe(source.replace('first','Xfirst'));
  const geometry = await rows.nth(3).evaluate(el => {
    const text = [...el.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent?.includes('long'))!;
    const range = document.createRange(); range.selectNodeContents(text);
    const rects = [...range.getClientRects()];
    return {lefts:rects.map(r=>r.left), height:el.getBoundingClientRect().height, lineHeight:parseFloat(getComputedStyle(el).lineHeight)};
  });
  expect(geometry.lefts.length).toBeGreaterThan(1);
  expect(Math.max(...geometry.lefts)-Math.min(...geometry.lefts)).toBeLessThan(2);
  expect(geometry.height).toBeGreaterThan(geometry.lineHeight);
  await page.screenshot({path:'.validation/list-layout.png',fullPage:true});
});

test('list Enter continues and an empty item exits', async ({page}) => {
  await page.goto('http://127.0.0.1:18915/react.html');
  await page.evaluate(() => (window as any).host.show('editor','- item'));
  await expect.poll(() => page.evaluate(() => !!(window as any).host.instance)).toBe(true);
  await page.evaluate(() => (window as any).host.instance.setMode('live'));
  await page.locator('.cm-live-list-marker').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).host.instance.source)).toBe('- item\n- ');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).host.instance.source)).toBe('- item\n');
});

 test('Tab changes list depth and Shift-Tab restores it without revealing markers', async ({page}) => {
  await page.goto('http://127.0.0.1:18915/react.html');
  await page.evaluate(() => (window as any).host.show('editor','- first\n- second'));
  await expect.poll(() => page.evaluate(() => !!(window as any).host.instance)).toBe(true);
  await page.evaluate(() => (window as any).host.instance.setMode('live'));
  await page.locator('.cm-live-list-marker').nth(1).click();
  await page.keyboard.press('Tab');
  await expect(page.locator('.cm-live-list-row').nth(1)).toHaveCSS('--md-list-depth','1');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.cm-live-list-row').nth(1)).toHaveCSS('--md-list-depth','0');
  expect(await page.evaluate(() => (window as any).host.instance.source)).toBe('- first\n- second');
 });

async function openList(page: import('@playwright/test').Page, source: string, width = 440) {
  await page.goto('http://127.0.0.1:18915/react.html');
  await page.evaluate(source => (window as any).host.show('editor',source), source);
  await expect.poll(() => page.evaluate(() => !!(window as any).host.instance)).toBe(true);
  await page.evaluate(() => (window as any).host.instance.setMode('live'));
  await page.locator('main').evaluate((el,width) => {el.style.width=width+'px';el.style.height='900px';},width);
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));});
}
const sourceOf = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).host.instance.source as string);

for (const [label,source] of [
  ['wide ordered parent','100. parent\n     - child\n         - grandchild'],
  ['nested tasks','- [ ] parent\n    - [x] child\n        - [ ] grandchild'],
  ['quoted nested lists','> - parent\n>     - child\n>         - grandchild'],
]) test(`review: ${label} keeps each child beyond its parent text`, async ({page}) => {
  await openList(page,source);
  const xs=await page.locator('.cm-line').evaluateAll(lines => ['parent','child','grandchild'].map(word=>{
    const walker=document.createTreeWalker(lines[0].parentElement!,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()) {const node=walker.currentNode;const i=node.textContent?.indexOf(word)??-1;if(i>=0){const r=document.createRange();r.setStart(node,i);r.setEnd(node,i+word.length);return r.getBoundingClientRect().left;}}
    return -1;
  }));
  expect(xs[1]-xs[0]).toBeGreaterThan(10);
  expect(xs[2]-xs[1]).toBeGreaterThan(10);
  expect(await sourceOf(page)).toBe(source);
});

for (const [label,source] of [
  ['task','- [ ] '+ 'long word '.repeat(24)],
  ['quoted list','> - '+ 'long word '.repeat(24)],
  ['nested task','- parent\n    - [ ] '+ 'long word '.repeat(24)],
  ['nested quoted list','> - parent\n>     - '+ 'long word '.repeat(24)],
  ['ordered','999. '+ 'long word '.repeat(24)],
]) test(`review: ${label} wraps to the text start`, async ({page}) => {
  await openList(page,source);
  const xs=await page.locator('.cm-content').evaluate(el=>{
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){const n=walker.currentNode;const i=n.textContent?.indexOf('long word')??-1;if(i>=0){const r=document.createRange();r.setStart(n,i);r.setEnd(n,n.textContent!.trimEnd().length);return [...r.getClientRects()].map(r=>r.left);}}
    return [];
  });
  expect(xs.length).toBeGreaterThan(1);
  expect(Math.max(...xs)-Math.min(...xs)).toBeLessThan(2);
});

test('review: Backspace at text start unwraps one list level and undo restores source', async ({page}) => {
  await openList(page,'- first\n    - second');
  await page.locator('.cm-live-list-marker').nth(1).click();
  await page.keyboard.press('Backspace');
  const edited=await sourceOf(page);
  expect(edited).not.toContain('\n    - second');
  expect(edited).toContain('second');
  await page.evaluate(()=>(window as any).host.instance.command('undo'));
  expect(await sourceOf(page)).toBe('- first\n    - second');
});

test('review: Shift-Enter creates continuation without another bullet', async ({page}) => {
  await openList(page,'- first');
  await page.locator('.cm-live-list-marker').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.insertText('continued');
  expect(await sourceOf(page)).toBe('- first\\\n  continued');
  await expect(page.locator('.cm-live-list-marker')).toHaveCount(1);
});

test('review: task toggling is reversible and preserves the text selection', async ({page}) => {
  await openList(page,'- [ ] first\n- [x] second');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  const selection=await page.evaluate(()=>(window as any).host.instance.selection().range);
  await page.getByRole('checkbox',{name:'Incomplete task'}).click();
  expect(await page.evaluate(()=>(window as any).host.instance.selection().range)).toEqual(selection);
  expect(await sourceOf(page)).toBe('- [x] first\n- [x] second');
  await page.evaluate(()=>(window as any).host.instance.command('undo'));
  expect(await sourceOf(page)).toBe('- [ ] first\n- [x] second');
});

test('review: mode switching, selection deletion and undo preserve list source', async ({page}) => {
  const source='09. **first**\n1. second\n\n    continuation\n\n- `literal`';
  await openList(page,source);
  for(const mode of ['reader','source','live']) {await page.evaluate(mode=>(window as any).host.instance.setMode(mode),mode);expect(await sourceOf(page)).toBe(source);}
  await page.locator('.cm-live-list-marker').first().click();
  await page.keyboard.press('Shift+End');
  await page.keyboard.press('Backspace');
  expect(await sourceOf(page)).not.toContain('first');
  await page.evaluate(()=>(window as any).host.instance.command('undo'));
  expect(await sourceOf(page)).toBe(source);
});


for (const source of ['100. parent\n1. child','> 100. parent\n> 1. child','- parent\n- child\n  - grandchild']) {
  test(`review: semantic Tab and Shift-Tab round trip ${JSON.stringify(source)}`,async({page})=>{
    await openList(page,source);
    await page.locator('.cm-live-list-marker').nth(1).click();
    await page.keyboard.press('Tab');
    await expect(page.locator('.cm-live-list-row').nth(1)).toHaveCSS('--md-list-depth','1');
    await page.keyboard.press('Shift+Tab');
    expect(await sourceOf(page)).toBe(source);
  });
}

test('review: keyboard hard-break delete and redo preserve nested task source',async({page})=>{
  const source='- parent\n    - [ ] first';
  await openList(page,source);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.insertText('continued');
  await expect.poll(()=>page.evaluate(()=>(window as any).host.instance.commandStatus('undo').enabled)).toBe(true);
  expect(await sourceOf(page)).toBe(source+'\\\n      continued');
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  expect(await sourceOf(page)).toBe(source+'continued');
  await expect.poll(()=>page.evaluate(()=>(window as any).host.instance.commandStatus('undo').enabled)).toBe(true);
  expect(await page.evaluate(()=>(window as any).host.instance.command('undo'))).toBe(true);
  expect(await sourceOf(page)).toContain('\\\n');
  await page.evaluate(()=>(window as any).host.instance.command('redo'));
  expect(await sourceOf(page)).toBe(source+'continued');
});

test('review: list-type conversion preserves descendants, blank lines and undo',async({page})=>{
  const source='- parent\n  - child\n\n- next';
  await openList(page,source);
  await page.locator('.cm-live-list-marker').first().click();
  await page.keyboard.press('Shift+End');
  await page.evaluate(()=>(window as any).host.instance.command('orderedList'));
  expect(await sourceOf(page)).toBe('1. parent\n   - child\n\n- next');
  await expect(page.locator('.cm-live-list-row').nth(1)).toHaveCSS('--md-list-depth','1');
  await page.evaluate(()=>(window as any).host.instance.command('undo'));
  expect(await sourceOf(page)).toBe(source);
});

for (const prefix of ['- ', '100. ', '- [x] ', '> - ']) {
  test(`continuous operations and three undo/redo cycles: ${prefix}`, async ({page}) => {
    const source=prefix+'first\n'+prefix+'second';
    await openList(page,source);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    const snapshot=()=>page.evaluate(()=>({source:(window as any).host.instance.source,selection:(window as any).host.instance.selection().range}));
    const states=[await snapshot()];
    for(const key of ['Enter','Tab','Enter','Enter']) {await page.keyboard.press(key);states.push(await snapshot());}
    expect(states[1].source).toContain(prefix.includes('[x]')?'- [ ] ':prefix.includes('100')?'101. ':'- ');
    expect(states[2].source).not.toEqual(states[1].source);
    expect(states[3].source).toEqual(states[1].source);
    expect(states[4].source).toBe(source+'\n'+(prefix.startsWith('>')?'> ':''));
    for(let round=0;round<3;round++) {
      for(let i=states.length-2;i>=0;i--) {
        expect(await page.evaluate(()=>(window as any).host.instance.command('undo'))).toBe(true);
        expect(await snapshot()).toEqual(states[i]);
      }
      for(let i=1;i<states.length;i++) {
        expect(await page.evaluate(()=>(window as any).host.instance.command('redo'))).toBe(true);
        expect(await snapshot()).toEqual(states[i]);
      }
    }
  });
}

test('Backspace repeatedly outdents, exits, then undoes the complete subtree',async({page})=>{
  const source='- first\n  - second\n    - child';
  await openList(page,source);
  await page.locator('.cm-live-list-marker').nth(1).click();
  await page.keyboard.press('Backspace');
  expect(await sourceOf(page)).toBe('- first\n- second\n  - child');
  await page.keyboard.press('Backspace');
  expect(await sourceOf(page)).toBe('- first\n\nsecond\n- child');
  for(let round=0;round<3;round++) {
    await page.evaluate(()=>(window as any).host.instance.command('undo'));
    await page.evaluate(()=>(window as any).host.instance.command('undo'));
    expect(await sourceOf(page)).toBe(source);
    await page.evaluate(()=>(window as any).host.instance.command('redo'));
    await page.evaluate(()=>(window as any).host.instance.command('redo'));
    expect(await sourceOf(page)).toBe('- first\n\nsecond\n- child');
  }
});

test('cross-item keyboard deletion preserves the surviving child through repeated undo',async({page})=>{
  const source='- ab\n- cd\n  - child';
  await openList(page,source);
  await page.locator('.cm-live-list-marker').first().click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const selected=await page.evaluate(()=>(window as any).host.instance.selection().range);
  expect(selected).toEqual({from:3,to:8});
  await page.keyboard.press('Backspace');
  expect(await sourceOf(page)).toBe('- ad\n  - child');
  for(let round=0;round<3;round++) {
    await page.evaluate(()=>(window as any).host.instance.command('undo'));
    expect(await sourceOf(page)).toBe(source);
    expect(await page.evaluate(()=>(window as any).host.instance.selection().range)).toEqual(selected);
    await page.evaluate(()=>(window as any).host.instance.command('redo'));
    expect(await sourceOf(page)).toBe('- ad\n  - child');
  }
});

test('parent split keeps children with the tail and the caret before that tail',async({page})=>{
  await openList(page,'- abcd\n  - child');
  await page.locator('.cm-live-list-marker').first().click();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  expect(await sourceOf(page)).toBe('- ab\n- cd\n  - child');
  expect(await page.evaluate(()=>(window as any).host.instance.selection().range)).toEqual({from:7,to:7});
  await expect(page.locator('.cm-live-list-row').nth(2)).toHaveCSS('--md-list-depth','1');
});
