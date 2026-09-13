/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import {
  createCodeBlock,
  createHtmlPreview,
  createRenderToolbar,
  renderClassNames,
  renderMathInto,
  sanitizeRenderedHtml,
} from "./renderKit";

describe("shared RenderKit", () => {
  it("uses one sanitized HTML policy for projections", () => {
    const html = sanitizeRenderedHtml('<em>safe</em><script>alert(1)</script><img src="x" onerror="alert(2)">');

    expect(html).toContain("<em>safe</em>");
    expect(html).not.toContain("script");
    expect(html).not.toContain("onerror");
  });

  it("creates canonical highlighted code DOM with an injected action", () => {
    const action = vi.fn();
    const block = createCodeBlock(
      { kind: "code", source: "const ready = true", language: "javascript" },
      { label: "Edit Source", run: action },
    );

    expect(block.classList.contains(renderClassNames.code)).toBe(true);
    expect(block.querySelector(`.${renderClassNames.toolbar}`)?.textContent).toContain("javascript");
    expect(block.querySelector(".hljs-keyword")?.textContent).toBe("const");
    block.querySelector("button")?.click();
    expect(action).toHaveBeenCalledOnce();
  });

  it("uses the same KaTeX primitive for inline and block math", () => {
    const inline = document.createElement("span");
    const block = document.createElement("div");

    renderMathInto(inline, { kind: "math", source: "E=mc^2", display: "inline" });
    renderMathInto(block, { kind: "math", source: "x^2", display: "block" });

    expect(inline.classList.contains(renderClassNames.mathInline)).toBe(true);
    expect(block.classList.contains(renderClassNames.mathBlock)).toBe(true);
    expect(inline.querySelector(".katex")).not.toBeNull();
    expect(block.querySelector(".katex-display")).not.toBeNull();
  });

  it("creates safe semantic HTML preview nodes", () => {
    const inline = createHtmlPreview(
      { kind: "html", source: "<strong>safe</strong>", display: "inline" },
    );
    const block = createHtmlPreview(
      { kind: "html", source: "<details open onclick='bad()'>More</details>", display: "block" },
    );

    expect(inline.classList.contains(renderClassNames.htmlInline)).toBe(true);
    expect(block.classList.contains(renderClassNames.htmlBlock)).toBe(true);
    expect(block.innerHTML).not.toContain("onclick");
  });

  it("keeps toolbar construction independent from Reader and Live Edit", () => {
    const run = vi.fn();
    const toolbar = createRenderToolbar("Formula", { label: "Edit Source", run });
    toolbar.querySelector("button")?.click();

    expect(toolbar.className).toBe(renderClassNames.toolbar);
    expect(run).toHaveBeenCalledOnce();
  });
});
