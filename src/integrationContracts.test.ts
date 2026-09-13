// @vitest-environment jsdom
import {describe, it, expect, vi} from "vitest";
import {TechnicalMarkdownReader} from "./reader";
import {parserFor} from "./markdownParser";
import {allowedImageURL} from "./resources";
import {renderMarkdown} from "./markdown";
const root = () => document.body.appendChild(document.createElement("div"));
describe("dialect contracts", () => {
  it("keeps GFM literal text separate from Tegg projections", async () => {
    const node = root();
    const source = "---\ntitle: Original\n---\n\n$x^2$ ==mark== H~2~O x^2^ :smile: [[note]]\n\n> [!NOTE]\n> body";
    await renderMarkdown(source, node, {profile: "gfm"});
    expect(node.querySelector(".frontmatter, .katex, mark, sub, sup, .wikilink, .callout")).toBeNull();
    expect(node.textContent).toContain("$x^2$");
    await renderMarkdown(source, node, {profile: "tegg"});
    expect(node.querySelector(".frontmatter")).not.toBeNull();
    expect(node.querySelector(".katex")).not.toBeNull();
  });
  it("supports GitHub math fences and backtick delimiters without losing TeX", async () => {
    const node = root();
    await renderMarkdown("$`x_1`$\n\n```math\nx^2\n```", node, {profile: "github"});
    expect(node.querySelectorAll(".katex")).toHaveLength(2);
  });
  it("does not apply smart typography to GFM", () => {
    expect(parserFor("gfm").render('"quote" -- ...')).toContain('&quot;quote&quot; -- ...');
  });
  it("restricts GitHub alerts to documented headers", async () => {
    const node = root();
    await renderMarkdown("> [!NOTE]\n> allowed\n\n> [!SUCCESS]\n> literal", node, {profile: "github"});
    expect(node.querySelectorAll(".callout")).toHaveLength(1);
    expect(node.textContent).toContain("[!SUCCESS]");
  });
});
describe("resource policy and render ownership", () => {
  it.each(["https://example.com/a.png", "//example.com/a.png", "a.png", "data:image/svg+xml,<svg/>", "javascript:alert(1)", "blob:https://example.com/id"])("blocks %s without an explicit policy", value => {
    expect(allowedImageURL(value)).toBeNull();
  });
  it("compares origins exactly and rejects credentials and executable schemes", () => {
    const policy = {allowedOrigins: ["https://example.com"]};
    expect(allowedImageURL("https://example.com/a.png", policy)).toBeTruthy();
    expect(allowedImageURL("https://example.com.evil.test/a.png", policy)).toBeNull();
    expect(allowedImageURL("https://user:pass@example.com/a.png", policy)).toBeNull();
    expect(allowedImageURL("javascript:alert(1)", {allowedProtocols: ["javascript:"]})).toBeNull();
  });
  it("never puts default image or media URLs into the live DOM", async () => {
    const node = root(), reader = new TechnicalMarkdownReader(node);
    await reader.render({source: '![image](https://example.com/a.png)\n\n<video src="https://example.com/a.mp4" poster="https://example.com/poster.png"></video>'});
    expect(node.querySelector("[src], [poster]")).toBeNull(); reader.destroy();
  });
  it("does not allow a stale resource to populate a newer document", async () => {
    let finish!: (value: string) => void;
    const node = root(), reader = new TechnicalMarkdownReader(node, {resourcePolicy: {allowRelative: true}, resolveResource: () => new Promise(resolve => {finish = resolve;})});
    const old = reader.render({documentId: "old", source: "![old](old.png)"});
    await Promise.resolve();
    await reader.render({documentId: "new", source: "new document"});
    finish("old.png"); await old;
    expect(node.textContent).toBe("new document\n"); expect(node.querySelector("img")).toBeNull(); reader.destroy();
  });
  it("resolves readiness on destroy even when the Host ignores cancellation", async () => {
    const node = root(), reader = new TechnicalMarkdownReader(node, {resolveResource: () => new Promise(() => {})});
    const work = reader.render({source: "![pending](a.png)"});
    await Promise.resolve(); reader.destroy(); reader.destroy(); await work;
    expect(node.childNodes).toHaveLength(0);
    await expect(reader.render({source: "late"})).rejects.toThrow("destroyed");
  });
});
