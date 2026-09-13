/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { findHighlights } from "./profile";
import { markdownParser } from "./markdownParser";

function render(source: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = markdownParser.renderInline(source);
  return root;
}

function contents(source: string): string[] {
  return findHighlights(source).map(range => source.slice(range.contentFrom, range.contentTo));
}

const styles = [
  ["bold", "**甲**", "strong"],
  ["italic", "*甲*", "em"],
  ["bold italic", "***甲***", "strong em, em strong"],
  ["strike", "~~甲~~", "s"],
  ["underline", "<u>甲</u>", "u"],
  ["HTML highlight", "<mark>甲</mark>", "mark"],
  ["inline code", "`甲`", "code"],
] as const;

describe("shared highlight syntax", () => {
  it("pairs adjacent highlights without treating their middle delimiters as content", () => {
    const source = "==甲====乙====丙==";
    expect(contents(source)).toEqual(["甲", "乙", "丙"]);
    expect(findHighlights(source)).toEqual([
      { from: 0, contentFrom: 2, contentTo: 3, to: 5 },
      { from: 5, contentFrom: 7, contentTo: 8, to: 10 },
      { from: 10, contentFrom: 12, contentTo: 13, to: 15 },
    ]);
    expect(render(source).innerHTML).toBe("<mark>甲</mark><mark>乙</mark><mark>丙</mark>");
  });

  it.each(styles)("parses nested %s rather than displaying its Markdown markers", (_name, body, selector) => {
    const source = `==${body}==`;
    const root = render(source);
    expect(contents(source)).toEqual([body]);
    expect(root.textContent).toBe("甲");
    expect(root.querySelector(`:scope > mark`)?.querySelector(selector)?.textContent).toBe("甲");
  });

  it.each([
    ["**==甲==**", "strong > mark"],
    ["*==甲==*", "em > mark"],
    ["~~==甲==~~", "s > mark"],
    ["<u>==甲==</u>", "u > mark"],
    ["[==甲==](https://example.com)", "a > mark"],
    ["==[甲](https://example.com)==", "mark > a"],
  ])("preserves the outer style or link in %s", (source, selector) => {
    const root = render(source);
    expect(root.textContent).toBe("甲");
    expect(root.querySelector(selector)?.textContent).toBe("甲");
  });

  it.each(styles.flatMap(([leftName, left]) => styles.map(([rightName, right]) => [leftName, rightName, `==${left}====${right}==`])))
    ("keeps adjacent %s and %s highlights separate", (_leftName, _rightName, source) => {
      expect(contents(source)).toHaveLength(2);
      const root = render(source);
      expect(root.textContent).toBe("甲甲");
      expect(root.querySelectorAll(":scope > mark")).toHaveLength(2);
    });

  it.each([
    ["\\==甲\\== ==乙==", ["乙"], "==甲== 乙"],
    ["==甲\\==乙==", ["甲\\==乙"], "甲==乙"],
    ["\\\\==甲==", ["甲"], "\\甲"],
    ["`==甲==` ==乙==", ["乙"], "==甲== 乙"],
    ["`` `==甲==` `` ==乙==", ["乙"], "`==甲==` 乙"],
    ["==甲`==`乙==", ["甲`==`乙"], "甲==乙"],
    ["`==甲==", ["甲"], "`甲"],
    ["==甲\n乙==", [], "==甲\n乙=="],
    ["==甲\r\n乙==", [], "==甲\n乙=="],
    ["====", [], "===="],
    ["===甲===", [], "===甲==="],
  ] as const)("keeps literal delimiters and line boundaries in %s", (source, expected, text) => {
    expect(contents(source)).toEqual(expected);
    expect(render(source).textContent).toBe(text);
  });

  it("does not let unmatched code ticks in separate paragraphs hide a valid highlight", () => {
    const source = "`first paragraph\n\n==甲==\n\n`last paragraph";
    expect(contents(source)).toEqual(["甲"]);
    const root = document.createElement("div");
    root.innerHTML = markdownParser.render(source);
    expect(root.querySelector("mark")?.textContent).toBe("甲");
  });

  it("does not style highlights inside inline code or fenced code", () => {
    const root = document.createElement("div");
    root.innerHTML = markdownParser.render("`==甲==`\n\n```text\n==乙==\n```");
    expect(root.querySelector("mark")).toBeNull();
    expect(root.querySelector("p > code")?.textContent).toBe("==甲==");
    expect(root.querySelector("pre > code")?.textContent).toBe("==乙==\n");
  });
});
