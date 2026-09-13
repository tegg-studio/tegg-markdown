/** @vitest-environment jsdom */

import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

describe("Reader projection integration", () => {
  it("keeps extended inline syntax after sanitization and enhancement", async () => {
    const { renderMarkdown } = await import("./markdown");
    const root = document.createElement("main");

    await renderMarkdown("==highlight==, H~2~O, X^2^, :rocket:.", root);

    expect(root.querySelector("mark")?.textContent).toBe("highlight");
    expect(root.querySelector("sub")?.textContent).toBe("2");
    expect(root.querySelector("sup")?.textContent).toBe("2");
    expect(root.textContent).toContain("🚀");
  });
});
