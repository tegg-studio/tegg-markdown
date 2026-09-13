// @vitest-environment jsdom
import {describe, it, expect} from "vitest";
import {createMarkdownParser} from "./markdownParser";
import commonmark from "../tests/fixtures/compatibility/commonmark-0.31.2.json";
import gfm from "../tests/fixtures/compatibility/gfm-0.29.json";
function semantic(html: string) {
  const root = document.createElement("div"); root.innerHTML = html;
  // cmark-gfm coalesces nested identical emphasis; markdown-it retains it.
  // Normalize this documented DOM representation difference, not text or ranges.
  for (const node of [...root.querySelectorAll("em, strong")].reverse()) {
    if (node.parentElement?.closest(node.tagName.toLowerCase())) node.replaceWith(...node.childNodes);
  }
  root.normalize();
  function visit(node: Node, ancestors: string[] = []): unknown {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? "";
      if (!value.trim() && /^(DIV|BLOCKQUOTE|UL|OL|TABLE|THEAD|TBODY|TR)$/.test(node.parentElement?.tagName ?? "")) return null;
      return value;
    }
    if (!(node instanceof Element)) return null;
    const alignment = node.getAttribute("align") ?? node.className.match(/align-(left|right|center)/)?.[1];
    node.removeAttribute("class");
    if (alignment) node.setAttribute("align", alignment);
    const children = [...node.childNodes].flatMap(child => {
      // Redundant nesting of the same emphasis has the same semantic role.
      if (child instanceof Element && ["EM", "STRONG"].includes(child.tagName) && [...ancestors, node.tagName].includes(child.tagName)) return [...child.childNodes].map(c => visit(c, [...ancestors, node.tagName]));
      return [visit(child, [...ancestors, node.tagName])];
    }).filter(child => child !== null);
    return {tag: node.tagName, attrs: [...node.attributes].map(a => [a.name, a.value]).sort(), children};
  }
  return visit(root);
}
describe("fixed specification examples", () => {
  for (const test of gfm) it(`GFM ${test.example}: ${test.section}`, () => {
    const parser = createMarkdownParser("gfm", test.section === "Task list items (extension)" ? ["tasklist"] : test.extensions);
    expect(semantic(parser.render(test.markdown))).toEqual(semantic(test.html));
  });
  const commonParser = createMarkdownParser("gfm", []);
  for (const test of commonmark) it(`CommonMark ${test.example}: ${test.section}`, () => {
    expect(semantic(commonParser.render(test.markdown))).toEqual(semantic(test.html));
  });
});
