/** @vitest-environment jsdom */
import {describe, expect, it} from "vitest";
import {TechnicalMarkdownReader} from "./reader";
import {resolveLocalImageSource} from "./profile";

describe("host-owned image resources", () => {
  it("exposes heading/table/callout semantics and read-only task states to assistive technology", async () => {
    const root = document.createElement("div");
    await new TechnicalMarkdownReader(root).render({source: "# Title\n\n- [x] Done\n- [ ] Pending\n\n> [!warning] Custom title\n> Body\n\n| Header |\n| --- |\n| Cell |"});
    expect(root.querySelector("h1")?.textContent).toBe("Title");
    expect(root.querySelector("th")?.textContent).toBe("Header");
    expect(root.querySelector("blockquote")?.getAttribute("aria-label")).toBe("warning callout");
    const tasks = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(tasks.map(task => task.checked)).toEqual([true, false]);
    expect(tasks.map(task => task.getAttribute("aria-label"))).toEqual(["Done", "Pending"]);
    expect(tasks.every(task => task.disabled && task.getAttribute("aria-hidden") !== "true")).toBe(true);
  });
  it("preserves browser SDK URLs and only adopts app-file for an explicit native host", async () => {
    const root = document.createElement("div");
    const input = {source: "![image](assets/My%20Image.png)", documentPath: "/tmp/#notes/note.md"};
    await new TechnicalMarkdownReader(root, {resourcePolicy: {allowRelative: true}}).render(input);
    expect(root.querySelector("img")?.getAttribute("src")).toBe("assets/My%20Image.png");
    await new TechnicalMarkdownReader(root, {resolveImage: resolveLocalImageSource, resourcePolicy: {allowedProtocols: ["app-file:"]}}).render(input);
    expect(root.querySelector("img")?.getAttribute("src")).toBe("app-file:///tmp/%23notes/assets/My%20Image.png");
  });
});
