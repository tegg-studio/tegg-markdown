import {expect, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({page}) => {
  await page.route("**/conflict-harness", route => route.fulfill({contentType: "text/html", body: `<!doctype html><html lang="en"><head><title>External change review fixture</title><link rel="stylesheet" href="/src/conflictUI.css"></head><body><main id="root"><button id="launcher">Review changes</button></main></body></html>`}));
  await page.goto("/conflict-harness");
  await page.evaluate(async () => {
    const {attachConflictUI} = await import("/src/conflictUI.ts");
    const {applySourcePatches} = await import("/src/sourcePatch.ts");
    const base = "# Report\nalpha=old\nbeta=old\ngamma=old\n";
    let state = {
      base: {documentId: "fixture.md", revision: "disk-1", source: base},
      local: {documentId: "fixture.md", baseRevision: "disk-1", generation: "page", sequence: 1, source: base.replace("beta=old", "beta=human")},
      incoming: {documentId: "fixture.md", revision: "disk-2", source: base.replace("alpha=old", "alpha=new").replace("gamma=old", "gamma=new")},
    };
    const copies: string[] = [];
    (window as any).readFixture = () => ({state, copies});
    document.getElementById("launcher")!.focus();
    attachConflictUI(document.getElementById("root")!, {
      getContext: () => state,
      applyPatches: (patches, expected) => {
        if (expected.source !== state.local.source || expected.sequence !== state.local.sequence) return null;
        state = {...state, local: {...state.local, source: applySourcePatches(state.local.source, patches), sequence: state.local.sequence + 1}};
        return state.local;
      },
      adoptIncomingBaseline: (incoming, expected) => {
        if (expected.source !== state.local.source || incoming.revision !== state.incoming.revision) return false;
        copies.push(incoming.source);
        state = {...state, base: incoming, local: {...state.local, baseRevision: incoming.revision}};
        return true;
      },
      acceptExternal: (incoming, expected) => {copies.push(expected.source); state = {...state, base: incoming, local: {...state.local, source: incoming.source, baseRevision: incoming.revision}}; return true;},
      saveCopy: (source) => {copies.push(source); return true;},
    });
  });
  await expect(page.getByRole("dialog", {name: "Review external changes"})).toBeVisible();
  await expect(page.locator("fieldset")).toHaveCount(2);
});

test("external review applies only selected changes and final explicit choices adopt the new baseline", async ({page}) => {
  await page.getByLabel("Apply this change", {exact: true}).first().check();
  await page.getByRole("button", {name: "Apply selected changes", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("Selected changes applied.");
  const partial = await page.evaluate(() => (window as any).readFixture());
  expect(partial.state.local.baseRevision).toBe("disk-1");
  expect(partial.state.local.source).toContain("alpha=new");
  expect(partial.state.local.source).toContain("gamma=old");
  expect(partial.copies).toEqual([]);
  await page.getByRole("button", {name: "Keep my version for all remaining changes", exact: true}).click();
  await page.getByRole("button", {name: "Complete review", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("still needs a successful save");
  const complete = await page.evaluate(() => (window as any).readFixture());
  expect(complete.state.local.baseRevision).toBe("disk-2");
  expect(complete.state.local.source).toContain("beta=human");
  expect(complete.state.local.source).toContain("gamma=old");
  expect(complete.copies).toEqual([partial.state.incoming.source]);
});

test("review remains accessible at narrow width and 200 percent text, and Escape restores focus", async ({page}, info) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.locator("body").evaluate(body => {body.style.fontSize = "200%";});
  const scan = await new AxeBuilder({page}).include(".tegg-conflict-panel").analyze();
  expect(scan.violations).toEqual([]);
  expect(await page.locator(".tegg-conflict-panel").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  if (info.project.name === "chromium") await page.screenshot({path: ".validation/conflict-ui-mobile.png", fullPage: true});
  await page.getByRole("button", {name: "Save my draft as a copy", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("separate copy was saved");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Review changes", exact: true})).toBeFocused();
});
