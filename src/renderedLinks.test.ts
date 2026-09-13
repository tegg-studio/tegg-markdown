/** @vitest-environment jsdom */
import {describe, expect, it, vi} from "vitest";
import {resolveLocalImageSource} from "./profile";
import {markdownParser} from "./markdownParser";
import {sanitizeRenderedHtml} from "./renderKit";
import {enhanceRenderedLinks} from "./renderedLinks";

describe("rendered link routing", () => {
  it("normalizes images before insertion, including raw HTML, without srcset bypass", () => {
    const html = sanitizeRenderedHtml('<img src="docs/My%20Image.png" srcset="file:///private/secret.png 2x"><img src="file:///tmp/p.png">', "/tmp/#notes/a.md", resolveLocalImageSource);
    const root = document.createElement("div"); root.innerHTML = html;
    expect(root.querySelector("img")?.getAttribute("src")).toBe("app-file:///tmp/%23notes/docs/My%20Image.png");
    expect(root.querySelectorAll("img")[1].getAttribute("src")).toBe("app-file:///tmp/p.png");
    expect(root.querySelector("[srcset]")).toBeNull();
  });
  it("keeps wiki targets through sanitization and routes exactly once", () => {
    const root = document.createElement("div");
    root.innerHTML = sanitizeRenderedHtml(markdownParser.render("> [!note] Links\n> [[folder/中文笔记|Go]] and [site](https://example.com)"));
    const open = vi.fn();
    enhanceRenderedLinks(root, open);
    const links = root.querySelectorAll<HTMLAnchorElement>("a");
    links[0].click(); links[1].click();
    expect(open.mock.calls).toEqual([[`wikilink:${encodeURIComponent("folder/中文笔记")}`], ["https://example.com"]]);
  });
  it("does not navigate executable or malformed fragment links", () => {
    const root = document.createElement("div");
    root.innerHTML = sanitizeRenderedHtml('<a href="javascript:alert(1)">bad</a><a href="#%XX">fragment</a>');
    const open = vi.fn();
    enhanceRenderedLinks(root, open);
    root.querySelectorAll<HTMLAnchorElement>("a").forEach(link => link.click());
    expect(open).not.toHaveBeenCalled();
  });
});
