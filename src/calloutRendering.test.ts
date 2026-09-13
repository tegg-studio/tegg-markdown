/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { calloutTypes, resolveCallout } from "./callouts";
import { markdownParser } from "./markdownParser";
import { enhanceCallouts, sanitizeRenderedHtml } from "./renderKit";

function render(source: string) {
  const root = document.createElement("main");
  root.innerHTML = sanitizeRenderedHtml(markdownParser.render(source));
  enhanceCallouts(root);
  return root;
}

describe("semantic Callout rendering", () => {
  it("has 15 distinct identities, 27 identifiers, and 15 distinct bundled glyphs", () => {
    expect(calloutTypes).toHaveLength(15);
    expect(new Set(calloutTypes.flatMap(type => [type.id, ...type.aliases])).size).toBe(27);
    expect(new Set(calloutTypes.map(type => type.svg)).size).toBe(15);
    expect(new Set(calloutTypes.map(type => type.light)).size).toBe(15);
    expect(resolveCallout("IMPORTANT").id).toBe("important");
    expect(resolveCallout("caution").id).toBe("caution");
  });
  it("keeps text and identity glyphs readable against both palette backgrounds", () => {
    const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const luminance = (color: number[]) => color.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const contrast = (a: number[], b: number[]) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    for (const mode of ["light", "dark"] as const) {
      const background = rgb(mode === "light" ? "#fbfbfc" : "#1d1e20");
      const text = rgb(mode === "light" ? "#202124" : "#e8e8ea");
      for (const type of calloutTypes) {
        const accent = rgb(type[mode]);
        const fill = accent.map((value, index) => value * .07 + background[index] * .93);
        expect(contrast(accent, fill), `${type.id} ${mode} icon`).toBeGreaterThanOrEqual(3);
        expect(contrast(text, fill), `${type.id} ${mode} text`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it.each(calloutTypes)("renders $id with its own icon and light/dark tokens", type => {
    const root = render(`> [!${type.id}] **Title**\n> **bold** and [link](https://example.com) and \`code\``);
    const quote = root.querySelector<HTMLElement>(".callout")!;
    expect(quote.dataset.calloutKind).toBe(type.id);
    expect(quote.style.getPropertyValue("--callout-light")).toBe(type.light);
    expect(quote.style.getPropertyValue("--callout-dark")).toBe(type.dark);
    expect(quote.querySelector(".callout-title strong")?.textContent).toBe("Title");
    expect(quote.querySelector("p strong")?.textContent).toBe("bold");
    expect(quote.querySelector("p a")?.getAttribute("href")).toBe("https://example.com");
    expect(quote.querySelector("p code")?.textContent).toBe("code");
    expect(quote.querySelectorAll(".callout-icon svg")).toHaveLength(1);
    enhanceCallouts(root);
    expect(quote.querySelectorAll(".callout-icon")).toHaveLength(1);
  });
  it("uses canonical visuals for aliases without changing their source identity", () => {
    for (const type of calloutTypes) for (const alias of type.aliases) {
      const quote = render(`> [!${alias}]\n> body`).querySelector<HTMLElement>(".callout")!;
      expect(quote.dataset.callout).toBe(alias);
      expect(quote.dataset.calloutKind).toBe(type.id);
    }
  });
  it("preserves nested blocks, title-only blocks, lists and fold metadata", () => {
    const root = render("> [!note]+ Outer\n> **body**\n>\n> > [!tip]- Inner\n> >\n> > - one\n> > - two\n\n> [!quote] Title only");
    expect(root.querySelectorAll(".callout")).toHaveLength(3);
    expect(root.querySelector('[data-callout="note"] [data-callout="tip"] li')?.textContent).toBe("one");
    expect(root.querySelector('[data-callout="tip"]')?.getAttribute("data-callout-fold")).toBe("-");
    expect(root.querySelector('[data-callout="quote"] p')).toBeNull();
  });
  it("does not promote quoted code, escaped markers, or a nested child to its parent", () => {
    expect(render("```md\n> [!note]\n> literal\n```").querySelector(".callout")).toBeNull();
    expect(render("> \\[!note]\n> literal").querySelector(".callout")).toBeNull();
    const root = render("> > [!tip]\n> > nested");
    expect(root.querySelectorAll(".callout")).toHaveLength(1);
    expect(root.firstElementChild?.classList.contains("callout")).toBe(false);
  });
  it("preserves unknown identifiers with a predictable fallback and sanitizes title HTML", () => {
    const root = render('> [!custom-type] <img src=x onerror="alert(1)">\n> text');
    const quote = root.querySelector<HTMLElement>(".callout")!;
    expect(quote.dataset.callout).toBe("custom-type");
    expect(quote.dataset.calloutKind).toBe("note");
    expect(root.querySelector("[onerror]")).toBeNull();
  });
});
