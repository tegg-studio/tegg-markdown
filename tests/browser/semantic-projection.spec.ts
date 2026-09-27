import {test, expect, type Page} from "@playwright/test";

async function openLive(page: Page, source: string) {
  await page.goto("http://127.0.0.1:18915/react.html");
  await page.evaluate(value => (window as any).host.show("editor", value, "internal", "tegg"), source);
  await expect.poll(() => page.evaluate(() => !!(window as any).host.instance)).toBe(true);
  await page.evaluate(() => (window as any).host.instance.setMode("live"));
}

const sourceOf = (page: Page) => page.evaluate(() => (window as any).host.instance.source as string);

test("complete details and parsed references stay aligned with Reader", async ({page}) => {
  const source = "<details>\n<summary>More</summary>\n\nFolded content.\n\n</details>\n\nLiteral \\[^a] and real[^a]\n\n[^a]: Note\n\n: ordinary text\n\nTerm\n: definition";
  await openLive(page, source);
  const details = page.locator(".cm-live-html-block details");
  await expect(details).toHaveCount(1);
  await expect(details).not.toHaveAttribute("open");
  const foldedHeight = await details.evaluate(node => node.getBoundingClientRect().height);
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  expect(await details.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(foldedHeight);
  await expect(page.locator(".cm-live-footnote-ref")).toHaveCount(1);
  await expect(page.locator(".cm-live-definition-description")).toHaveCount(1);
  expect(await sourceOf(page)).toBe(source);
});

test("nested callout focus, editing and quote hard break keep their source", async ({page}) => {
  const source = "> [!note] Outer\n> body\n>\n> > [!tip] Inner\n> > child\n\n> quote";
  await openLive(page, source);
  const header = page.locator(".cm-live-callout-title").first();
  const before = await header.boundingBox();
  const bodyLine = page.locator(".cm-live-callout-source").filter({hasText: /^body$/});
  const background = await bodyLine.evaluate(node => getComputedStyle(node).backgroundColor);
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
  await page.evaluate(anchor => {
    const view = (window as any).host.instance.view;
    view.dispatch({selection: {anchor}});
    view.focus();
  }, source.indexOf("body") + 2);
  await expect(page.locator(".callout-type-button")).toHaveCount(2);
  await expect(page.locator(".cm-content")).not.toContainText("[!note]");
  const after = await header.boundingBox();
  expect(after).toEqual(before);
  await expect(bodyLine).toHaveClass(/cm-activeLine/);
  expect(await bodyLine.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(background);
  await page.evaluate(anchor => {
    const view = (window as any).host.instance.view;
    view.dispatch({selection: {anchor}});
    view.focus();
  }, source.length);
  await page.keyboard.press("Shift+Enter");
  expect(await sourceOf(page)).toBe(source + "\\\n> ");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await sourceOf(page)).toBe(source);
});

test("inline formula selects on click and edits on double click without opening viewer", async ({page}) => {
  await openLive(page, "Formula $x^2$ after\n\nend");
  await page.evaluate(() => {
    (window as any).__mathEditCount = 0;
    document.addEventListener("tegg-edit-object", () => (window as any).__mathEditCount++, true);
  });
  const formula = page.locator(".cm-live-math-inline");
  const afterPosition = () => page.locator(".cm-content").evaluate(root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent ?? "";
      const index = text.indexOf("after");
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(walker.currentNode, index);
      range.setEnd(walker.currentNode, index + 5);
      const rect = range.getBoundingClientRect();
      return {x: rect.x, y: rect.y};
    }
    throw new Error("Following formula text is missing");
  });
  const before = await afterPosition();
  await formula.click();
  await expect(formula).toHaveClass(/cm-live-object-selected/);
  const actions = page.locator(".cm-live-math-actions");
  await expect(actions).toHaveAttribute("data-side", /^(above|below)$/);
  expect(await afterPosition()).toEqual(before);
  await expect(page.locator(".md-object-viewer")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__mathEditCount)).toBe(0);
  const viewButton = actions.getByRole("button", {name: /View formula|查看公式/});
  expect(await viewButton.evaluate(button => {
    const rect = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  })).toBe(true);
  await viewButton.click();
  await expect(page.locator(".md-object-viewer")).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__mathEditCount)).toBe(0);
  await page.keyboard.press("Escape");
  await expect(formula).toBeFocused();
  await expect(actions).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(actions).toBeHidden();
  await formula.dblclick();
  await expect(page.locator(".md-object-viewer")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__mathEditCount)).toBe(1);
});
