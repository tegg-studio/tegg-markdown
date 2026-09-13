import { describe, expect, it } from "vitest";
import { normalizeReaderInput } from "./reader";
import { technicalMarkdownProfile } from "./syntaxContract";

describe("Tegg Markdown Reader input contract", () => {
  it("provides stable host-neutral defaults", () => {
    expect(normalizeReaderInput({ source: "# Hello" })).toEqual({
      documentId: "",
      source: "# Hello",
      revision: "",
      profileVersion: technicalMarkdownProfile.version,
      documentPath: "",
      contentState: "settled",
      fontScale: 1,
      contentWidth: 672,
    });
  });

  it("bounds appearance values supplied by a host", () => {
    const normalized = normalizeReaderInput({ source: "", fontScale: 4, contentWidth: 120 });
    expect(normalized.fontScale).toBe(4);
    expect(normalized.contentWidth).toBe(320);
  });
});
