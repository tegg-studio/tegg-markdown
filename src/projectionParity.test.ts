/** @vitest-environment jsdom */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./renderKit", async (importOriginal) => {
  const original = await importOriginal<typeof import("./renderKit")>();
  return {
    ...original,
    renderDiagram: vi.fn(async (model: { engine: string; source: string }, target: HTMLElement) => {
      target.dataset.renderedDiagram = model.engine;
      target.textContent = model.source;
    }),
  };
});

import { livePreview } from "./livePreview";
import { renderMarkdown } from "./markdown";
import { renderClassNames } from "./renderKit";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as DOMRectList;
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  }
});

const mounted: EditorView[] = [];

afterEach(() => {
  mounted.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

describe("Reader and Live Edit render parity", () => {
  it("projects core Markdown through the same visual roles", async () => {
    const source = [
      "---",
      "title: Visual parity",
      "---",
      "",
      "# Heading",
      "",
      "Paragraph with **bold**, *emphasis*, ~~removed~~, `code`, [link](https://example.com), [[Note|wiki]], ==mark==, H~2~O, and X^2^.",
      "",
      "> Quote",
      "",
      "- [ ] Task",
      "",
      "---",
      "",
      "| Column | Value |",
      "| --- | ---: |",
      "| One | 1 |",
      "",
      "![Image](image.png)",
      "",
      "Term",
      ": Definition",
      "",
      "Footnote[^one]",
      "",
      "[^one]: Definition text",
      "",
      "end",
    ].join("\n");

    const reader = document.createElement("main");
    await renderMarkdown(source, reader, { contentState: "streaming" });

    const editor = document.createElement("div");
    document.body.append(editor);
    const view = new EditorView({
      state: EditorState.create({
        doc: source,
        selection: { anchor: source.length },
        extensions: [markdown({ extensions: GFM }), livePreview],
      }),
      parent: editor,
    });
    mounted.push(view);

    // CodeMirror may finish its time-budgeted parse on the next idle turn.
    await vi.waitFor(() => {
      for (const className of [
        renderClassNames.properties,
        renderClassNames.heading,
        renderClassNames.paragraph,
        renderClassNames.strong,
        renderClassNames.emphasis,
        renderClassNames.strike,
        renderClassNames.inlineCode,
        renderClassNames.link,
        renderClassNames.wikiLink,
        renderClassNames.quote,
        renderClassNames.listItem,
        renderClassNames.task,
        renderClassNames.rule,
        renderClassNames.table,
        renderClassNames.image,
        renderClassNames.footnoteRef,
        renderClassNames.footnoteDefinition,
        renderClassNames.definitionTerm,
        renderClassNames.definitionDescription,
        renderClassNames.highlight,
        renderClassNames.subscript,
        renderClassNames.superscript,
      ]) {
        expect(reader.querySelector(`.${className}`), `Reader should use ${className}`).not.toBeNull();
        expect(editor.querySelector(`.${className}`), `Live Edit should use ${className}`).not.toBeNull();
      }
    }, { timeout: 2000 });

    expect(editor.querySelector(".cm-live-quote-line")?.textContent)
      .toBe(reader.querySelector("blockquote:not(.callout) p")?.textContent);
  });

  it("projects technical content through the same semantic primitives", async () => {
    const source = [
      "Inline $E=mc^2$.",
      "",
      "> [!TIP] Shared callout",
      "> The same semantic color token is used.",
      "",
      "```swift",
      "struct Note { let ready = true }",
      "```",
      "",
      "$$",
      "x^2",
      "$$",
      "",
      "```mermaid",
      "flowchart LR",
      "A-->B",
      "```",
      "",
      "end",
    ].join("\n");

    const reader = document.createElement("main");
    await renderMarkdown(source, reader, { contentState: "streaming" });

    const editor = document.createElement("div");
    document.body.append(editor);
    const view = new EditorView({
      state: EditorState.create({
        doc: source,
        selection: { anchor: source.length },
        extensions: [markdown({ extensions: GFM }), livePreview],
      }),
      parent: editor,
    });
    mounted.push(view);

    // CodeMirror may finish its time-budgeted parse on the next idle turn.
    await vi.waitFor(() => {
      for (const className of [
        renderClassNames.code,
        renderClassNames.mathInline,
        renderClassNames.mathBlock,
        renderClassNames.diagram,
        renderClassNames.canvas,
        renderClassNames.callout,
      ]) {
        expect(reader.querySelector(`.${className}`), `Reader should use ${className}`).not.toBeNull();
        expect(editor.querySelector(`.${className}`), `Live Edit should use ${className}`).not.toBeNull();
      }
    }, { timeout: 2000 });

    expect(reader.querySelector(`.${renderClassNames.code} .hljs-keyword`)?.textContent).toBe("struct");
    expect(editor.querySelector(`.${renderClassNames.code} .hljs-keyword`)?.textContent).toBe("struct");

    const readerCallout = reader.querySelector(".callout");
    const editorCallout = editor.querySelector(".cm-live-callout");
    expect(editorCallout?.querySelector(".callout-title")?.textContent)
      .toBe(readerCallout?.querySelector(".callout-title")?.textContent);
    expect(editorCallout?.querySelector("p")?.textContent)
      .toBe(readerCallout?.querySelector("p")?.textContent);
  });
});
