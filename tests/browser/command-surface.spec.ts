import {test, expect} from '@playwright/test';

async function open(page: import('@playwright/test').Page, source: string) {
  await page.goto('http://127.0.0.1:18930/reliable.html');
  await page.evaluate(source => (window as any).host.load(source), source);
  await expect.poll(() => page.evaluate(() => !!(window as any).host.editor)).toBe(true);
}
const sourceOf = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).host.editor.source as string);

test('live typing style arms without a placeholder and keeps subsequent input inside marks', async ({page}) => {
  await open(page, 'after');
  await page.evaluate(() => {
    const editor = (window as any).host.editor;
    editor.view.dispatch({selection: {anchor: 0}}); editor.view.focus(); editor.command('bold'); editor.command('italic');
  });
  expect(await sourceOf(page)).toBe('after');
  await page.keyboard.insertText('你好');
  expect(await sourceOf(page)).toBe('***你好***after');
  await page.keyboard.insertText('!');
  expect(await sourceOf(page)).toBe('***你好!***after');
});

test('toggling bold off after typing keeps following words outside the mark', async ({page}) => {
  await open(page, '段落前半段 后半段。');
  await page.evaluate(() => {
    const editor = (window as any).host.editor;
    editor.view.dispatch({selection: {anchor: '段落前半段'.length}});
    editor.view.focus();
  });
  await page.evaluate(() => (window as any).host.editor.command('bold'));
  expect(await sourceOf(page)).toBe('段落前半段 后半段。');
  await page.keyboard.type('Bold');
  expect(await sourceOf(page)).toBe('段落前半段**Bold** 后半段。');
  await page.evaluate(() => (window as any).host.editor.command('bold'));
  expect(await sourceOf(page)).toBe('段落前半段**Bold** 后半段。');
  await page.keyboard.type(' plain');
  expect(await sourceOf(page)).toBe('段落前半段**Bold** plain 后半段。');
});

test('native controller bold intent survives separate text insertions', async ({page}) => {
  await open(page, '段落前半段 后半段。');
  await page.evaluate(() => {
    const editor = (window as any).host.editor;
    editor.view.dispatch({selection: {anchor: '段落前半段'.length}});
    editor.view.focus(); editor.editing.command('bold');
  });
  await page.keyboard.insertText('Bold');
  expect(await sourceOf(page)).toBe('段落前半段**Bold** 后半段。');
  await page.evaluate(() => (window as any).host.editor.editing.command('bold'));
  expect(await sourceOf(page)).toBe('段落前半段**Bold** 后半段。');
  await page.keyboard.insertText(' ');
  await page.keyboard.insertText('plain');
  expect(await sourceOf(page)).toBe('段落前半段**Bold** plain 后半段。');
});

test('armed bold keeps ordinary spaces and following letters in one mark', async ({page}) => {
  await open(page, '段落前半段 后半段。');
  await page.evaluate(() => {
    const editor = (window as any).host.editor;
    editor.view.dispatch({selection: {anchor: '段落前半段'.length}});
    editor.view.focus(); editor.editing.command('bold');
  });
  await page.keyboard.type('Bold plain');
  expect(await sourceOf(page)).toBe('段落前半段**Bold plain** 后半段。');
});

test('armed bold keeps a trailing space editable across the next input event', async ({page}) => {
  await open(page, '段落前半段 后半段。');
  await page.evaluate(() => {
    const editor = (window as any).host.editor;
    editor.view.dispatch({selection: {anchor: '段落前半段'.length}});
    editor.view.focus(); editor.editing.command('bold');
  });
  await page.keyboard.insertText('Bold ');
  expect(await sourceOf(page)).toBe('段落前半段**Bold ** 后半段。');
  await page.keyboard.insertText('plain');
  expect(await sourceOf(page)).toBe('段落前半段**Bold plain** 后半段。');
});

test('turning bold off keeps multiple spaces outside the mark', async ({page}) => {
  await open(page, '段落前半段 后半段。');
  await page.evaluate(() => {
    const editor = (window as any).host.editor;
    editor.view.dispatch({selection: {anchor: '段落前半段'.length}});
    editor.view.focus(); editor.editing.command('bold');
  });
  await page.keyboard.insertText('Bold');
  await page.evaluate(() => (window as any).host.editor.editing.command('bold'));
  await page.keyboard.insertText('  ');
  await page.keyboard.insertText('plain');
  expect(await sourceOf(page)).toBe('段落前半段**Bold**  plain 后半段。');
});

test('back-to-back controller intent and text input obey the latest style', async ({page}) => {
  await open(page, '段落前半段 后半段。');
  await page.evaluate(() => {
    const editor = (window as any).host.editor;
    editor.view.dispatch({selection: {anchor: '段落前半段'.length}});
    editor.view.focus(); editor.editing.command('bold');
  });
  await page.keyboard.insertText('Bold');
  await page.evaluate(() => (window as any).host.editor.editing.command('bold'));
  await page.keyboard.insertText(' plain');
  expect(await sourceOf(page)).toBe('段落前半段**Bold** plain 后半段。');
});

test('empty-line slash command keeps Escape literal and insertion has one undo', async ({page}) => {
  await open(page, '/');
  await page.evaluate(() => {
    const editor = (window as any).host.editor;
    editor.view.dispatch({selection: {anchor: 1}}); editor.view.focus();
  });
  const menu = page.locator('.tegg-command-menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  expect(await sourceOf(page)).toBe('/');
  await page.keyboard.insertText('code');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Enter');
  expect(await sourceOf(page)).toContain('```text\n\n```');
  await expect(page.getByRole('textbox', {name: /Code content|代码内容/})).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Z');
  expect(await sourceOf(page)).toBe('/code');
});

test('math slash command keeps its query through Cancel and applies one reviewed draft', async ({page}) => {
  await open(page, '/math');
  await page.evaluate(() => {
    const editor = (window as any).host.editor;
    editor.view.focus();
    editor.view.dispatch({selection: {anchor: 0}});
    editor.view.dispatch({selection: {anchor: 5}});
  });
  const math = page.locator('.tegg-command-menu').getByRole('option', {name: /Math block|数学块/});
  await math.click();
  await expect(page.getByRole('textbox', {name: /Formula source|公式源码/})).toBeVisible();
  expect(await sourceOf(page)).toBe('/math');
  await page.getByRole('button', {name: /Cancel|取消/}).click();
  expect(await sourceOf(page)).toBe('/math');
  await expect(math).toBeVisible();
  await math.click();
  await page.getByRole('textbox', {name: /Formula source|公式源码/}).fill('x^2');
  expect(await sourceOf(page)).toBe('/math');
  await page.getByRole('button', {name: /Done|完成/}).click();
  expect(await sourceOf(page)).toBe('$$\nx^2\n$$');
  await page.evaluate(() => (window as any).host.editor.command('undo'));
  expect(await sourceOf(page)).toBe('/math');
});

test('block type entry opens by pointer or focused activation and keeps the caret on Escape', async ({page}) => {
  await open(page, '## Current\n\nNext');
  await page.evaluate(() => {
    const editor = (window as any).host.editor;
    editor.view.dispatch({selection: {anchor: 5}}); editor.view.focus();
  });
  const trigger = page.locator('.tegg-command-more');
  await page.keyboard.press('Alt+Shift+KeyB');
  await expect(trigger.locator('svg')).toHaveAttribute('data-icon','heading-2');
  await trigger.click();
  const menu = page.locator('.tegg-command-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option', {name: 'Heading 2'})).toHaveAttribute('aria-current', 'true');
  await expect(menu.getByRole('option', {name: 'Heading 2'})).toHaveAttribute('aria-selected', 'true');
  await expect(menu.locator('.tegg-command-group')).toHaveText(['Paragraph style', 'List style', 'Wrap in quote', 'Move block']);
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('option', {name: 'Heading 3'})).toHaveAttribute('aria-selected', 'true');
  await expect(menu.getByRole('option', {name: 'Heading 2'})).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  expect(await sourceOf(page)).toBe('## Current\n\nNext');
  expect(await page.evaluate(() => (window as any).host.editor.view.state.selection.main.anchor)).toBe(5);
  await trigger.focus();
  await trigger.evaluate((button: HTMLButtonElement) => button.click());
  await expect(menu).toBeVisible();
  await trigger.evaluate((button: HTMLButtonElement) => button.click());
  await expect(menu).toBeHidden();
});

test('gutter type marks stay centered on one line with inherited wrapping and button padding', async ({page}) => {
  await open(page, '# Heading');
  // The native Host inherits overflow-wrap:anywhere; browser buttons also have
  // default padding. Exercise only the installed package CSS, with hostile
  // inherited Host defaults added here to reproduce the native environment.
  await page.addStyleTag({content: '#editor {overflow-wrap:anywhere} button {padding:6px;box-sizing:content-box}'});
  const trigger = page.locator('.tegg-command-more');
  for (let level = 1; level <= 6; level++) {
    const source = `${'#'.repeat(level)} Heading`;
    await page.evaluate(value => {
      const host = (window as any).host;
      host.load(value);
      host.editor.view.dispatch({selection: {anchor: value.length}});
      host.editor.view.focus();
    }, source);
    await page.keyboard.press('Alt+Shift+KeyB');
    await expect(trigger.locator('svg')).toHaveAttribute('data-icon',`heading-${level}`);
    const geometry = await trigger.evaluate(button => {
      const glyph = button.querySelector<SVGSVGElement>('svg.tegg-command-glyph')!;
      const outer = button.getBoundingClientRect(), inner = glyph.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {width: outer.width, height: outer.height, glyphHeight: inner.height,
        dx: Math.abs((outer.left + outer.right - inner.left - inner.right) / 2),
        dy: Math.abs((outer.top + outer.bottom - inner.top - inner.bottom) / 2),
        padding: style.paddingLeft, wrap: style.overflowWrap, whiteSpace: style.whiteSpace};
    });
    expect(geometry).toMatchObject({width: 28, height: 28, padding: '0px', wrap: 'normal', whiteSpace: 'nowrap'});
    expect(geometry.glyphHeight).toBe(16);
    expect(geometry.dx).toBeLessThan(1);
    expect(geometry.dy).toBeLessThan(1);
  }
  await page.evaluate(() => {
    const host = (window as any).host;
    host.load('- item');
    host.editor.view.dispatch({selection: {anchor: 5}});
    host.editor.view.focus();
  });
  await page.keyboard.press('Alt+Shift+KeyB');
  await expect(trigger.locator('svg.tegg-command-glyph')).toBeVisible();
  const svg = await trigger.evaluate(button => {
    const outer = button.getBoundingClientRect(), inner = button.querySelector('svg')!.getBoundingClientRect();
    return {width: inner.width, height: inner.height,
      dx: Math.abs((outer.left + outer.right - inner.left - inner.right) / 2),
      dy: Math.abs((outer.top + outer.bottom - inner.top - inner.bottom) / 2)};
  });
  expect(svg.width).toBe(16); expect(svg.height).toBe(16);
  expect(svg.dx).toBeLessThan(1); expect(svg.dy).toBeLessThan(1);
});

test('mixed list heading keeps separate current styles and quotes the whole list', async ({page}) => {
  const source = '- ## title\n- sibling';
  await open(page, source);
  await page.evaluate(() => {
    const editor = (window as any).host.editor;
    editor.view.dispatch({selection: {anchor: editor.source.indexOf('title') + 2}}); editor.view.focus();
  });
  const trigger = page.locator('.tegg-command-more');
  await page.keyboard.press('Alt+Shift+KeyB');
  await expect(trigger.locator('svg')).toHaveAttribute('data-icon','heading-2');
  await trigger.click();
  const menu = page.locator('.tegg-command-menu');
  await expect(menu.getByRole('option', {name: 'Heading 2'})).toHaveAttribute('aria-current', 'true');
  await expect(menu.getByRole('option', {name: 'Bullet list'})).toHaveAttribute('aria-current', 'true');
  await menu.getByRole('option', {name: 'Wrap list in quote'}).click();
  expect(await sourceOf(page)).toBe('> - ## title\n> - sibling');
  await trigger.click();
  await expect(menu.getByRole('option', {name: 'Wrap list in quote'})).toHaveCount(0);
  await expect(menu.getByRole('option', {name: 'Heading 2'})).toHaveAttribute('aria-current', 'true');
  await expect(menu.getByRole('option', {name: 'Bullet list'})).toHaveAttribute('aria-current', 'true');
});

test('YAML metadata source does not expose block conversion', async ({page}) => {
  const source = '---\ntitle: X\n---\nBody';
  await open(page, source);
  await page.evaluate(() => {
    const editor = (window as any).host.editor;
    editor.view.dispatch({selection: {anchor: editor.source.indexOf('X')}}); editor.view.focus();
  });
  await expect(page.locator('.cm-live-frontmatter-source').filter({hasText: /^title: X$/})).toBeVisible();
  await expect(page.locator('.tegg-command-more')).toBeHidden();
  await expect(page.locator('.tegg-command-plus')).toBeHidden();
  await expect(page.locator('.tegg-command-menu')).toBeHidden();
  expect(await sourceOf(page)).toBe(source);
});

test('narrow bottom block menu keeps keyboard movement visible and conversion undoable', async ({page}) => {
  await page.setViewportSize({width: 390, height: 360});
  const source = Array.from({length: 20}, (_, index) => `Paragraph ${index}`).join('\n\n') + '\n\n## Target';
  await open(page, source);
  await page.evaluate(() => {
    const editor = (window as any).host.editor;
    editor.view.dispatch({selection: {anchor: editor.source.indexOf('Target') + 2}, scrollIntoView: true});
    editor.view.focus(); editor.view.scrollDOM.scrollTop = editor.view.scrollDOM.scrollHeight;
  });
  const trigger = page.locator('.tegg-command-more');
  await page.keyboard.press('Alt+Shift+KeyB');
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  const menu = page.locator('.tegg-command-menu');
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(7);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(383);
  expect(bounds!.y).toBeGreaterThanOrEqual(7);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(353);
  // Start at the current H2, then wrap past H1 and Paragraph to the last action.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  const moveDown = menu.getByRole('option', {name: 'Move down'});
  await expect(moveDown).toHaveAttribute('aria-selected', 'true');
  const row = await moveDown.boundingBox(), scroll = await menu.boundingBox();
  expect(row).not.toBeNull(); expect(scroll).not.toBeNull();
  expect(row!.y).toBeGreaterThanOrEqual(scroll!.y);
  expect(row!.y + row!.height).toBeLessThanOrEqual(scroll!.y + scroll!.height);
  await page.keyboard.press('Escape');
  expect(await sourceOf(page)).toBe(source);
  await trigger.click();
  await menu.getByRole('option', {name: 'Heading 4'}).click();
  expect(await sourceOf(page)).toBe(source.replace('## Target', '#### Target'));
  await page.evaluate(() => (window as any).host.editor.command('undo'));
  expect(await sourceOf(page)).toBe(source);
});
