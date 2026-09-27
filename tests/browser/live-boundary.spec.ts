import {test, expect, type Page} from "@playwright/test";

const callout = "> [!NOTE] Editing\n> 点击正文即可输入，文字和容器应保持稳定。 Stable\n>\n> - First OK\n> - Second";
const source = ["# Document", "", ...Array.from({length: 14}, (_, index) =>
  `Paragraph ${index} with enough ordinary words to occupy a line.\n`),
"```text", "code block", "```", "", "| A | B |", "|---|---|", "| cell | data |", "", "## Callout", "", callout].join("\n");

async function openLive(page: Page, markdown = source) {
  await page.goto("http://127.0.0.1:18915/react.html");
  await page.setViewportSize({width: 1600, height: 800});
  await page.addStyleTag({content: `.tegg-app #editor > .cm-editor > .cm-scroller > .cm-content {
    width: 100%; max-width: 808px; margin: 0 auto; padding: 32px 24px 64px; box-sizing: border-box;
  }`});
  await page.evaluate(value => (window as any).host.show("editor", value, "internal", "tegg"), markdown);
  await expect.poll(() => page.evaluate(() => !!(window as any).host.instance)).toBe(true);
  await page.evaluate(() => {
    document.documentElement.classList.add("tegg-app");
    document.body.classList.add("tegg-app");
    document.querySelector<HTMLElement>(".tegg-sdk-editor")!.id = "editor";
    (window as any).host.instance.setMode("live");
    const view = (window as any).host.instance.view;
    view.dispatch({selection: {anchor: view.state.doc.toString().indexOf("Stable") + 3}, scrollIntoView: true});
    view.focus();
  });
  await page.locator(".cm-live-callout-source").filter({hasText: "Stable"}).scrollIntoViewIfNeeded();
}

async function clickInsideStable(page: Page) {
  const row = page.locator(".cm-live-callout-source").filter({hasText: "Stable"});
  const point = await row.evaluate(root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent ?? "";
      const index = text.indexOf("Stable");
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(walker.currentNode, index + 3);
      range.setEnd(walker.currentNode, index + 3);
      const rect = range.getBoundingClientRect();
      const bounds = root.getBoundingClientRect();
      return {x: rect.x - bounds.left, y: (rect.top + rect.bottom) / 2 - bounds.top};
    }
    throw new Error("Stable is not rendered");
  });
  // Locator actionability waits for layout to settle after widgets are measured.
  // A global coordinate sampled one frame earlier can hit the Callout title.
  await row.click({position: point});
}

test("line-end keys stay in a long document's visible Callout row", async ({page}) => {
  await openLive(page);
  await clickInsideStable(page);
  await page.keyboard.type("!");
  await page.keyboard.press("Meta+ArrowRight");
  const atEnd = await page.evaluate(() => {
    const view = (window as any).host.instance.view;
    const body = view.state.doc.lineAt(view.state.doc.toString().indexOf("Sta!ble"));
    return {head: view.state.selection.main.head, end: body.to};
  });
  expect(atEnd.head).toBe(atEnd.end);
  await page.keyboard.type("X");
  expect(await page.evaluate(() => (window as any).host.instance.view.state.doc.toString())).toContain("Sta!bleX\n>\n> - First OK");
  await page.keyboard.press("Meta+ArrowRight");
  expect(await page.evaluate(() => {
    const view = (window as any).host.instance.view;
    return view.state.selection.main.head === view.state.doc.lineAt(view.state.doc.toString().indexOf("Sta!bleX")).to;
  })).toBe(true);

  await page.evaluate(() => {
    const view = (window as any).host.instance.view;
    view.dispatch({selection: {anchor: view.state.doc.toString().indexOf("Sta!bleX") + 3}});
    view.focus();
  });
  await page.keyboard.press("Shift+End");
  const selected = await page.evaluate(() => {
    const view = (window as any).host.instance.view;
    return {text: view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
      head: view.state.selection.main.head,
      end: view.state.doc.lineAt(view.state.selection.main.anchor).to};
  });
  expect(selected.text).toBe("!bleX");
  expect(selected.head).toBe(selected.end);

  await page.evaluate(() => {
    const view = (window as any).host.instance.view;
    view.dispatch({selection: {anchor: view.state.doc.toString().indexOf("Sta!bleX") + 3}});
    view.focus();
  });
  await page.keyboard.press("Meta+Shift+ArrowLeft");
  const left = await page.evaluate(() => {
    const view = (window as any).host.instance.view;
    return {head: view.state.selection.main.head,
      start: view.state.doc.lineAt(view.state.selection.main.anchor).from};
  });
  expect(left.head).toBe(left.start + 2);
  await page.evaluate(() => {
    const view = (window as any).host.instance.view;
    view.dispatch({selection: {anchor: view.state.selection.main.head}});
    view.focus();
  });
  await page.keyboard.type("Y");
  expect(await page.evaluate(() => (window as any).host.instance.view.state.doc.toString()))
    .toContain("> Y点击正文即可输入");
});

test("visual line boundaries retain soft wraps and Shift selection", async ({page}) => {
  const longLine = "> " + "alpha beta gamma delta ".repeat(45) + "tail";
  await openLive(page, source + "\n\n" + longLine);
  await page.evaluate(() => {
    const view = (window as any).host.instance.view;
    const line = view.state.doc.lineAt(view.state.doc.toString().lastIndexOf("alpha beta"));
    view.dispatch({selection: {anchor: line.from + 9}, scrollIntoView: true});
    view.focus();
  });
  await page.keyboard.press("Meta+Shift+ArrowRight");
  const result = await page.evaluate(() => {
    const view = (window as any).host.instance.view;
    const selection = view.state.selection.main;
    const line = view.state.doc.lineAt(selection.anchor);
    const start = view.coordsAtPos(selection.anchor), end = view.coordsAtPos(selection.head, -1);
    return {anchor: selection.anchor, head: selection.head, lineEnd: line.to,
      startY: start?.top, endY: end?.top};
  });
  expect(result.head).toBeGreaterThan(result.anchor);
  expect(result.head).toBeLessThan(result.lineEnd);
  expect(Math.abs(result.endY! - result.startY!)).toBeLessThan(2);
  await page.keyboard.press("Meta+Shift+ArrowRight");
  expect(await page.evaluate(() => {
    const view = (window as any).host.instance.view;
    const selection = view.state.selection.main;
    return selection.head === view.state.doc.lineAt(selection.anchor).to;
  })).toBe(true);
});

test("RTL Cmd+Right keeps the Callout cursor on its own source line", async ({page}) => {
  await openLive(page);
  await page.evaluate(() => {
    const view = (window as any).host.instance.view;
    view.contentDOM.style.direction = "rtl";
    view.dispatch({selection: {anchor: view.state.doc.toString().indexOf("Stable") + 3}, scrollIntoView: true});
    view.focus();
  });
  await expect.poll(() => page.evaluate(() => {
    const view = (window as any).host.instance.view;
    return view.textDirectionAt(view.state.selection.main.head);
  })).toBe(1);
  await page.keyboard.press("Meta+ArrowRight");
  const edge = await page.evaluate(() => {
    const view = (window as any).host.instance.view;
    const line = view.state.doc.lineAt(view.state.doc.toString().indexOf("Stable"));
    return {head: view.state.selection.main.head, firstVisible: line.from + 2};
  });
  expect(edge.head).toBe(edge.firstVisible);
  await page.keyboard.press("Meta+ArrowRight");
  expect(await page.evaluate(() => (window as any).host.instance.view.state.selection.main.head)).toBe(edge.firstVisible);
  await page.keyboard.type("Z");
  expect(await page.evaluate(() => (window as any).host.instance.view.state.doc.toString()))
    .toContain("> Z点击正文即可输入");

  await page.evaluate(() => {
    const view = (window as any).host.instance.view;
    view.dispatch({selection: {anchor: view.state.doc.toString().indexOf("Stable") + 3}});
    view.focus();
  });
  await page.keyboard.press("Meta+Shift+ArrowRight");
  expect(await page.evaluate(() => {
    const view = (window as any).host.instance.view;
    const selection = view.state.selection.main;
    return {anchor: selection.anchor, head: selection.head,
      firstVisible: view.state.doc.lineAt(selection.anchor).from + 2};
  })).toMatchObject({head: edge.firstVisible, firstVisible: edge.firstVisible});
});
