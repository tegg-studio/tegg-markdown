import {resourceContext} from "./editorHost";
import {literalClipboardText} from "./literalEditing";
/** @vitest-environment jsdom */

import { history, cursorCharLeft, deleteCharBackward, undo, insertNewline } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import {ensureSyntaxTree} from "@codemirror/language";
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

import {deleteLiveBreak, insertLiveBreak} from "./liveBreaks";
import { editQuoteBoundary, livePreview, deleteScriptContent, deleteBesideInlineSyntax } from "./livePreview";
import { editorToolbarState, executeEditorCommand } from "./editorToolbar";
import { supportedSyntaxMarkers } from "./syntaxContract";

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
const covered = new Set<string>();

function mount(source: string, cursor = source.length, profile: "tegg" | "github" | "gfm" = "tegg") {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc: source,
      selection: { anchor: cursor },
      extensions: [history(), markdown({ extensions: GFM }), resourceContext.of({documentPath:"",profile}), livePreview],
    }),
    parent,
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 1000);
  view.dispatch({});
  mounted.push(view);
  return { parent, view };
}

function verify(markers: string[], source: string, assertion: (parent: HTMLElement) => void, cursor = source.length) {
  markers.forEach((marker) => covered.add(marker));
  const { parent } = mount(source, cursor);
  assertion(parent);
}

afterEach(() => {
  mounted.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

describe("Live Edit syntax contract", () => {
  it("keeps math-looking content literal inside inline code after renderer integration", () => {
    const source = 'Code `$x^2$` and `:smile:`\n\nEnd';
    const {parent, view} = mount(source);
    expect(parent.querySelector('.cm-live-math-inline')).toBeNull();
    expect(parent.querySelector('.cm-live-emoji')).toBeNull();
    expect(parent.querySelector('.cm-live-inline-code')?.textContent).toContain('$x^2$');
    expect(view.state.doc.toString()).toBe(source);
  });

  it.each([1, 2, 3, 4, 5, 6])("keeps H%i syntax hidden through focus, selection and editing", level => {
    const prefix = "#".repeat(level) + " ";
    const source = prefix + "Title";
    const {parent, view} = mount(source, prefix.length);
    view.focus();
    view.dispatch({selection: {anchor: prefix.length, head: source.length}});
    expect(parent.textContent).toBe("Title");
    expect(editorToolbarState(view.state).heading).toBe(level);
    view.dispatch({changes: {from: prefix.length, to: source.length, insert: "Edited"},
      selection: {anchor: prefix.length + 6}, userEvent: "input.type"});
    expect(parent.textContent).toBe("Edited");
    expect(view.state.doc.toString()).toBe(prefix + "Edited");
    const nextLevel = level === 2 ? 3 : 2;
    executeEditorCommand(view, `heading${nextLevel}`);
    expect(parent.textContent).toBe("Edited");
    expect(editorToolbarState(view.state).heading).toBe(nextLevel);
    undo(view);
    expect(view.state.doc.toString()).toBe(prefix + "Edited");
  });

  it("skips hidden heading syntax and removes it as one unit with Backspace", () => {
    const {parent, view} = mount("#### Title", 5);
    view.focus();
    cursorCharLeft(view);
    expect(view.state.selection.main.head).toBe(0);
    view.dispatch({selection: {anchor: 5}});
    deleteCharBackward(view);
    expect(view.state.doc.toString()).toBe("Title");
    expect(parent.textContent).toBe("Title");
    expect(editorToolbarState(view.state).heading).toBe(0);
    undo(view);
    expect(view.state.doc.toString()).toBe("#### Title");
  });

  it("hides closing ATX and Setext markers while focused", () => {
    for (const source of ["## Title ##", "Title\n====="]) {
      const {parent, view} = mount(source, 3);
      view.focus();
      view.dispatch({selection: {anchor: 3}});
      expect(parent.textContent).not.toMatch(/[#=]/);
      expect(view.state.doc.toString()).toBe(source);
    }
  });

  it("opens a body link on click but not after dragging a selection", () => {
    const source = "[Go](target.md) after";
    const {parent, view} = mount(source);
    const open = vi.fn();
    view.dom.addEventListener("tegg-open-link", open);
    const element = () => parent.querySelector<HTMLElement>(".cm-live-link")!;
    element().dispatchEvent(new MouseEvent("mousedown", {bubbles: true, button: 0, clientX: 10, clientY: 10}));
    document.dispatchEvent(new MouseEvent("mouseup", {bubbles: true, button: 0, clientX: 10, clientY: 10}));
    element().dispatchEvent(new MouseEvent("click", {bubbles: true, button: 0, clientX: 10, clientY: 10}));
    expect(open).toHaveBeenCalledOnce();
    expect((open.mock.calls[0][0] as CustomEvent).detail).toBe("target.md");
    open.mockClear();
    element().dispatchEvent(new MouseEvent("mousedown", {bubbles: true, button: 0, clientX: 10, clientY: 10}));
    view.dispatch({selection: {anchor: 1, head: 3}});
    element().dispatchEvent(new MouseEvent("click", {bubbles: true, button: 0, clientX: 30, clientY: 10}));
    expect(open).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe(source);
  });

  it("routes Metadata links through the host without changing YAML", () => {
    const source = '---\nwebsite: https://example.com\nrelated: "[[Target|Label]]"\n---\nBody';
    const { parent, view } = mount(source);
    const receive = vi.fn();
    view.dom.addEventListener("tegg-open-link", receive);
    parent.querySelector<HTMLAnchorElement>('.md-metadata-link')!.click();
    expect(receive).toHaveBeenCalledOnce();
    expect((receive.mock.calls[0][0] as CustomEvent).detail).toBe("https://example.com");
    expect(view.state.doc.toString()).toBe(source);
  });

  it("edits a link from row whitespace while text and icon retain navigation", () => {
    const source = '---\nwebsite: https://example.com\n---\nBody';
    const { parent, view } = mount(source);
    const receive = vi.fn();
    view.dom.addEventListener('tegg-open-link', receive);
    const row = parent.querySelector<HTMLElement>('dd[aria-label="Edit website"]')!;
    expect(parent.querySelector('.md-metadata-link-edit')).toBeNull();
    row.querySelector('svg')!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    expect(receive).toHaveBeenCalledOnce();
    expect(parent.querySelector('.md-metadata-value-input')).toBeNull();
    row.click();
    expect(parent.querySelector<HTMLInputElement>('.md-metadata-value-input')?.value).toBe('https://example.com');
    expect(view.state.doc.toString()).toBe(source);
  });

  it("routes list links through the host and opens editing only from their own row", () => {
    const source = '---\ngroup:\n  links: [https://example.com, "[[Target|Label]]"]\n  other: hello\n  tags: [one, two]\n---\nBody';
    const { parent, view } = mount(source);
    const receive = vi.fn();
    view.dom.addEventListener('tegg-open-link', receive);
    const group = parent.querySelector('.md-metadata-row > dd') as HTMLElement;
    expect(group.hasAttribute('tabindex')).toBe(false);
    group.click();
    Array.from(parent.querySelectorAll('dt')).find(dt => dt.textContent === 'other')!.click();
    expect(parent.querySelector('.md-metadata-value-form')).toBeNull();
    const row = parent.querySelector<HTMLElement>('dd[aria-label="Edit links"]')!;
    const links = row.querySelectorAll('a');
    expect(links).toHaveLength(2);
    links[0].querySelector('svg')!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    links[1].click();
    expect(receive.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual(['https://example.com', 'wikilink:Target']);
    expect(parent.querySelector('.md-metadata-value-form')).toBeNull();
    row.click();
    expect(parent.querySelector<HTMLInputElement>('.md-metadata-tag-add')?.getAttribute('aria-label')).toBe('New tag for group / links');
    Array.from(parent.querySelectorAll<HTMLButtonElement>('.md-metadata-tag-footer button')).find(b => b.textContent === 'Cancel')!.click();
    parent.querySelector<HTMLElement>('dd[aria-label="Edit tags"]')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    expect(parent.querySelector<HTMLInputElement>('.md-metadata-tag-add')?.getAttribute('aria-label')).toBe('New tag for group / tags');
    expect(view.state.doc.toString()).toBe(source);
  });

  it("edits, removes and adds tags as one undoable row change", () => {
    const source = '---\ntags: [one, two] # keep\n---\nBody';
    const { parent, view } = mount(source);
    parent.querySelector<HTMLElement>('dd[aria-label="Edit tags"]')!.click();
    parent.querySelector<HTMLButtonElement>('button[aria-label="Edit tag 1: one"]')!.click();
    parent.querySelector<HTMLInputElement>('.md-metadata-tag-input')!.value = 'updated';
    // Switching directly between existing tags commits the first local draft.
    parent.querySelector<HTMLButtonElement>('button[aria-label="Edit tag 2: two"]')!.click();
    const edit = parent.querySelector<HTMLInputElement>('.md-metadata-tag-input')!;
    edit.value = 'second';
    edit.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', bubbles: true}));
    parent.querySelector<HTMLButtonElement>('button[aria-label="Remove tag 2: second"]')!.click();
    const add = parent.querySelector<HTMLInputElement>('.md-metadata-tag-add')!;
    add.value = 'new';
    add.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', bubbles: true, cancelable: true}));
    expect(view.state.doc.toString()).toBe(source);
    expect(add.value).toBe('');
    Array.from(parent.querySelectorAll<HTMLButtonElement>('.md-metadata-tag-footer button')).find(b => b.textContent === 'Save')!.click();
    expect(view.state.doc.toString()).toContain('tags: [ "updated", "new" ] # keep');
    parent.querySelector<HTMLElement>('dd[aria-label="Edit tags"]')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'z', metaKey: true, bubbles: true}));
    expect(view.state.doc.toString()).toBe(source);
  });

  it("keeps empty Tab navigation and IME input intact and cancels all tag edits", () => {
    const source = '---\ntags: [one]\n---\nBody';
    const { parent, view } = mount(source);
    parent.querySelector<HTMLElement>('dd[aria-label="Edit tags"]')!.click();
    const add = parent.querySelector<HTMLInputElement>('.md-metadata-tag-add')!;
    const tab = new KeyboardEvent('keydown', {key: 'Tab', bubbles: true, cancelable: true});
    add.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    add.value = '中文';
    const composing = new KeyboardEvent('keydown', {key: 'Tab', isComposing: true, bubbles: true, cancelable: true});
    add.dispatchEvent(composing);
    expect(composing.defaultPrevented).toBe(false);
    expect(add.value).toBe('中文');
    parent.querySelector<HTMLButtonElement>('button[aria-label="Remove tag 1: one"]')!.click();
    Array.from(parent.querySelectorAll<HTMLButtonElement>('.md-metadata-tag-footer button')).find(b => b.textContent === 'Cancel')!.click();
    expect(view.state.doc.toString()).toBe(source);
    expect(parent.querySelector('.md-metadata-tag-fields')).toBeNull();
  });

  it("shows block YAML lists by default and opens source without rewriting comments", async () => {
    const source = "---\n# keep this comment\ntitle: Test\ntags:\n  - markdown\n  - syntax-review\n---\n\nBody";
    const { parent, view } = mount(source);
    expect(parent.querySelector(".cm-live-properties summary")).toBeNull();
    expect(Array.from(parent.querySelectorAll(".md-metadata-chip"), el => el.textContent)).toEqual(["markdown", "syntax-review"]);
    parent.querySelector<HTMLButtonElement>(".md-metadata-edit")!.click();
    expect(view.state.doc.toString()).toBe(source);
    await vi.waitFor(() => expect(view.state.selection.main.anchor).toBe(4));
    await vi.waitFor(() => expect(parent.querySelector(".cm-live-frontmatter-source")).not.toBeNull());
  });

  it("edits scalar values without changing keys or comments, and supports undo", () => {
    const source = '---\n# preserved\nauthor: {name: Leon, role: Writer} # inline\ntags: [one, two]\n---\nBody';
    const { parent, view } = mount(source);
    parent.querySelector<HTMLButtonElement>('button[aria-label="Edit author / name"]')!.click();
    const input = parent.querySelector<HTMLInputElement>('.md-metadata-value-input')!;
    input.value = "Ada: # text";
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    expect(view.state.doc.toString()).toBe(source.replace('name: Leon', 'name: "Ada: # text"'));
    expect(parent.querySelector('dt input')).toBeNull();
    parent.querySelector<HTMLButtonElement>('button[aria-label="Edit author / name"]')!.dispatchEvent(new KeyboardEvent("keydown", {key: "z", metaKey: true, bubbles: true}));
    expect(view.state.doc.toString()).toBe(source);
    parent.querySelector<HTMLButtonElement>('button[aria-label="Edit author / name"]')!.dispatchEvent(new KeyboardEvent("keydown", {key: "z", metaKey: true, shiftKey: true, bubbles: true}));
    expect(view.state.doc.toString()).toBe(source.replace('name: Leon', 'name: "Ada: # text"'));
  });

  it("lets Enter activate Cancel instead of saving the value", () => {
    const source = '---\ntitle: Original\n---\nBody';
    const { parent, view } = mount(source);
    parent.querySelector<HTMLButtonElement>('button[aria-label="Edit title"]')!.click();
    parent.querySelector<HTMLInputElement>('.md-metadata-value-input')!.value = 'Discard me';
    const cancel = Array.from(parent.querySelectorAll<HTMLButtonElement>('.md-metadata-value-form button')).find(button => button.textContent === 'Cancel')!;
    const enter = new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true});
    cancel.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(view.state.doc.toString()).toBe(source);
    cancel.click();
    expect(parent.querySelector('.md-metadata-value-input')).toBeNull();
    expect(view.state.doc.toString()).toBe(source);
  });

  it("saves a pending value before switching to YAML and returns with Done", async () => {
    const source = '---\nstatus: draft # keep\n---\nBody';
    const { parent, view } = mount(source);
    parent.querySelector<HTMLButtonElement>('button[aria-label="Edit status"]')!.click();
    parent.querySelector<HTMLInputElement>('.md-metadata-value-input')!.value = 'ready';
    parent.querySelector<HTMLButtonElement>('.md-metadata-edit')!.click();
    await vi.waitFor(() => expect(parent.querySelector('.cm-metadata-source-toolbar')).not.toBeNull());
    expect(view.state.doc.toString()).toBe(source.replace('draft', '"ready"'));
    parent.querySelector<HTMLButtonElement>('button[aria-label="Done editing YAML"]')!.click();
    await vi.waitFor(() => expect(parent.querySelector('.cm-live-properties')).not.toBeNull());
    expect(parent.querySelector('.cm-live-properties')?.textContent).toContain('ready');
  });

  it("validates numbers and ignores IME confirmation keys while editing a value", () => {
    const source = '---\ncount: 12\n---\nBody';
    const { parent, view } = mount(source);
    parent.querySelector<HTMLButtonElement>('button[aria-label="Edit count"]')!.click();
    const input = parent.querySelector<HTMLInputElement>('.md-metadata-value-input')!;
    input.value = "invalid";
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(view.state.doc.toString()).toBe(source);
    input.value = "24";
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", isComposing: true, bubbles: true}));
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", keyCode: 229, bubbles: true}));
    expect(view.state.doc.toString()).toBe(source);
    expect(parent.querySelector('.md-metadata-value-input')).toBe(input);
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    expect(view.state.doc.toString()).toBe(source.replace('12', '24'));
  });

  it.each(['---\ntitle: Test\n---\nBody', '---\ntitle: Test\n---'])('provides Done in explicit YAML mode and exits without moving the cursor elsewhere: %s', async source => {
    const { parent, view } = mount(source);
    parent.querySelector<HTMLButtonElement>('.md-metadata-edit')!.click();
    await vi.waitFor(() => expect(parent.querySelector('.cm-metadata-source-toolbar')).not.toBeNull());
    view.dispatch({ changes: { from: source.indexOf('Test'), to: source.indexOf('Test') + 4, insert: 'Updated' }, selection: {anchor: 5} });
    parent.querySelector<HTMLButtonElement>('button[aria-label="Done editing YAML"]')!.click();
    await vi.waitFor(() => expect(parent.querySelector('.cm-metadata-source-toolbar')).toBeNull());
    expect(parent.querySelector('.cm-live-properties')?.textContent).toContain('Updated');
    expect(view.state.doc.toString()).toBe(source.replace('Test', 'Updated'));
  });

  it("keeps Done available while a YAML delimiter is temporarily incomplete", async () => {
    const source = '---\ntitle: Test\n---\nBody';
    const { parent, view } = mount(source);
    parent.querySelector<HTMLButtonElement>('.md-metadata-edit')!.click();
    await vi.waitFor(() => expect(parent.querySelector('.cm-metadata-source-toolbar')).not.toBeNull());
    const closing = source.lastIndexOf('---');
    view.dispatch({changes: {from: closing, to: closing + 1, insert: ''}});
    expect(parent.querySelector('button[aria-label="Done editing YAML"]')).not.toBeNull();
    view.dispatch({changes: {from: closing, insert: '-'}});
    parent.querySelector<HTMLButtonElement>('button[aria-label="Done editing YAML"]')!.click();
    await vi.waitFor(() => expect(parent.querySelector('.cm-live-properties')).not.toBeNull());
  });

  it("commits a table cell once when Enter is followed by blur", () => {
    const source = "| Name |\n| --- |\n| old |\n\nend";
    const {parent, view} = mount(source);
    const errors: unknown[] = [];
    const capture = (event: ErrorEvent) => {errors.push(event.error); event.preventDefault();};
    window.addEventListener("error", capture);
    try {
      parent.querySelector<HTMLButtonElement>('button[aria-label="Edit table cell: old"]')!.click();
      const input = parent.querySelector<HTMLInputElement>('.cm-live-table-cell input:not([hidden])')!;
      input.value = "已验证";
      input.dispatchEvent(new KeyboardEvent("keydown", {key:"Enter",bubbles:true,cancelable:true}));
      const committed = view.state.doc.toString();
      // Browsers blur the old input as CodeMirror replaces its table widget.
      input.dispatchEvent(new FocusEvent("blur"));
      expect(errors).toEqual([]);
      expect(view.state.doc.toString()).toBe(committed);
      expect(committed).toContain("已验证");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally {window.removeEventListener("error", capture);}
  });

  it("does not treat IME candidate Enter or Escape as a table commit/cancel", () => {
    const {parent, view} = mount("| Name |\n| --- |\n| old |\n\nend");
    const button = parent.querySelector<HTMLButtonElement>('button[aria-label="Edit table cell: old"]')!;
    button.click();
    const input = parent.querySelector<HTMLInputElement>('.cm-live-table-cell input:not([hidden])')!;
    input.value = "中文候选";
    for (const key of ["Enter", "Escape"]) {
      const event = new KeyboardEvent("keydown", {key, isComposing: true, bubbles: true, cancelable: true});
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(input.hidden).toBe(false);
      expect(view.state.doc.toString()).toContain("old");
    }
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", keyCode: 229, bubbles: true}));
    expect(input.hidden).toBe(false);
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
    expect(view.state.doc.toString()).toContain("中文候选");
    expect(view.state.doc.toString()).not.toContain("old");
  });
  it("keeps heading spacing at block edges and merges only the next block's leading gap", () => {
    const source = '# First\n## Second\n\nParagraph\ncontinued\n\n## Before code\n\n```text\ncode\n```\n\n## Before list\n\n- one\n- two\n\nend';
    const { parent, view } = mount(source);
    const first = parent.querySelector('.cm-live-heading-1')!;
    expect(first.classList.contains('cm-live-heading-document-start')).toBe(true);
    expect(first.classList.contains('cm-live-heading-first')).toBe(true);
    expect(first.classList.contains('cm-live-heading-last')).toBe(true);
    const second = Array.from(parent.querySelectorAll('.cm-live-heading-2')).find(el => el.textContent === 'Second')!;
    expect(second.classList.contains('cm-live-after-heading')).toBe(true);
    const paragraph = Array.from(parent.querySelectorAll('.cm-live-paragraph')).find(el => el.textContent === 'Paragraph')!;
    expect(paragraph.classList.contains('cm-live-after-heading')).toBe(true);
    expect(paragraph.nextElementSibling?.classList.contains('cm-live-after-heading')).toBe(false);
    expect(parent.querySelector('.cm-live-code-block')?.closest('.cm-line')?.classList.contains('cm-live-after-heading')).toBe(true);
    const list = parent.querySelectorAll('.cm-live-list-block');
    expect(list[0].classList.contains('cm-live-after-heading')).toBe(true);
    expect(list[1].classList.contains('cm-live-after-heading')).toBe(false);
    // Entering the heading preserves its layout classes and the source.
    view.dispatch({selection: {anchor: source.indexOf('Second')}});
    expect(parent.querySelector('.cm-live-heading-2')?.classList.contains('cm-live-after-heading')).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("does not double metadata or rule spacing before headings, including body H1", () => {
    const source = '---\ntitle: Test\n---\n\n# Title\n\nBody\n\n# Section\n\n---\n\n## After rule\n\nend';
    const { parent } = mount(source);
    const headings = parent.querySelectorAll('.cm-live-heading-first');
    expect(headings[0].classList.contains('cm-live-heading-after-metadata')).toBe(true);
    expect(headings[1].classList.contains('cm-live-heading-document-start')).toBe(false);
    expect(headings[1].classList.contains('cm-live-heading-after-metadata')).toBe(false);
    expect(headings[2].classList.contains('cm-live-heading-after-spaced-block')).toBe(true);
  });

  it("applies heading spacing once to multiline Setext headings", () => {
    const { parent } = mount('First line\nSecond line\n===========\n\nend');
    const lines = parent.querySelectorAll('.cm-live-heading');
    expect(lines.length).toBe(3);
    expect(parent.querySelectorAll('.cm-live-heading-first')).toHaveLength(1);
    expect(parent.querySelectorAll('.cm-live-heading-last')).toHaveLength(1);
    expect(lines[1].classList.contains('cm-live-heading-first')).toBe(false);
    expect(lines[1].classList.contains('cm-live-heading-last')).toBe(false);
  });

  it("renders headings, paragraphs, emphasis, quotes, lists, and code", () => {
    verify(["headings-atx"], "# Heading\n\nend", (root) => {
      expect(root.querySelector(".cm-live-heading-1")?.textContent).toBe("Heading");
    });
    verify(["headings-setext"], "Heading\n=======\n\nend", (root) => {
      expect(root.querySelector(".cm-live-heading-1")?.textContent).toContain("Heading");
      expect(root.textContent).not.toContain("=======");
    });
    verify(["paragraphs", "line-breaks"], "First line\\\nSecond line\n\nend", (root) => {
      expect(root.textContent).toContain("First line");
      expect(root.textContent).not.toContain("First line\\");
    });
    verify(["emphasis"], "**Bold** *Italic*\n\nend", (root) => {
      expect(root.querySelector(".cm-live-strong")?.textContent).toBe("Bold");
      expect(root.querySelector(".cm-live-emphasis")?.textContent).toBe("Italic");
    });
    verify(["blockquotes"], "> Quote\n\nend", (root) => {
      expect(root.querySelector(".cm-live-quote-line")?.textContent).toContain("Quote");
      expect(root.textContent).not.toContain("> Quote");
    });
    verify(["ordered-list", "unordered-list", "nested-list"], "1. One\n   - Child\n\nend", (root) => {
      expect(root.querySelectorAll(".cm-live-list-marker")).toHaveLength(2);
    });
    verify(["inline-code", "indented-code"], "Run `check`\n\n    const ready = true;\n\nend", (root) => {
      expect(root.querySelector(".cm-live-inline-code")?.textContent).toBe("check");
      expect(root.querySelector(".cm-live-code-block")?.textContent).toContain("const ready");
    });
    verify(["horizontal-rule"], "Before\n\n---\n\nend", (root) => {
      expect(root.querySelector(".cm-live-rule")).not.toBeNull();
    });
  });

  it.each(["tegg", "github", "gfm"] as const)("keeps unresolved references literal in %s", profile => {
    const source = "[missing] and [label][unknown] and [empty][] and [*formatted*]\n\n[valid][id]\n\n[id]: https://example.com\n\nend";
    const {parent,view} = mount(source,source.length,profile);
    expect(parent.textContent).toContain("[missing] and [label][unknown] and [empty][] and [formatted]");
    expect(parent.querySelector(".cm-live-emphasis")?.textContent).toBe("formatted");
    expect(parent.querySelector(".cm-live-link")?.textContent).toBe("valid");
    expect(view.state.doc.toString()).toBe(source);
  });

  it("renders every link, image, escape, and safe HTML form cleanly", () => {
    verify(["links", "link-title", "autolink"], "[Tegg](https://tegg.studio \"Title\") and <https://example.com>\n\nend", (root) => {
      expect(root.textContent?.replace(/\s+/g, " ")).toContain("Tegg and https://example.com");
      expect(root.textContent).not.toContain("https://tegg.studio");
      expect(root.textContent).not.toContain("<https://example.com>");
    });
    verify(["reference-link"], "[Read][guide]\n\n[guide]: https://example.com \"Guide\"\n\nend", (root) => {
      expect(root.textContent).toContain("Read");
      expect(root.textContent).not.toContain("Read[guide]");
      expect(root.querySelector(".cm-live-reference-definition")?.textContent).toContain("guide → https://example.com");
    });
    verify(["images", "linked-image"], "![One](one.png)\n\n[![Two](two.png)](https://example.com)\n\nend", (root) => {
      expect(root.querySelectorAll(".cm-live-image")).toHaveLength(2);
      expect(root.textContent).not.toContain("](https://example.com)");
    });
    verify(["escaping"], "\\*literal\\* and \\[brackets\\]\n\nend", (root) => {
      expect(root.textContent).toContain("*literal* and [brackets]");
      expect(root.textContent).not.toContain("\\*");
      expect(root.querySelectorAll(".cm-live-escaped")).toHaveLength(4);
    });
    verify(["html"], "<em>HTML emphasis</em>\n\n<details>\n<summary>More</summary>\nSafe\n</details>\n\nend", (root) => {
      expect(root.querySelector(".cm-live-emphasis")?.textContent).toBe("HTML emphasis");
      expect(root.querySelector(".cm-live-html-block details")?.textContent).toContain("Safe");
    });
  });

  it("renders tables and highlighted fenced code", () => {
    verify(["tables", "table-alignment"], "| Left | Center | Right |\n| :--- | :---: | ---: |\n| **Bold** | `Code` | 42 |\n\nend", (root) => {
      expect(root.querySelector('[data-align="center"]')).not.toBeNull();
      expect(root.querySelector('[data-align="right"]')).not.toBeNull();
      expect(root.querySelector(".cm-live-table-preview strong")?.textContent).toBe("Bold");
      expect(root.querySelector(".cm-live-table-preview code")?.textContent).toBe("Code");
    });
    verify(["fenced-code", "syntax-highlight"], "```swift\nstruct Note { let title: String }\n```\n\nend", (root) => {
      expect(root.querySelector(".cm-live-code-block .hljs-keyword")?.textContent).toBe("struct");
      expect(root.querySelector<HTMLInputElement>(".md-code-language")?.value).toBe("swift");
    });
    verify(["fenced-code-tilde"], "~~~json\n{\"ready\": true}\n~~~\n\nend", (root) => {
      expect(root.querySelector(".cm-live-code-block .hljs-literal")?.textContent).toBe("true");
    });
  });

  it("renders extended document and inline syntax", () => {
    verify(["footnotes"], "Text[^local]\n\n[^local]: Footnote text\n\nend", (root) => {
      expect(root.querySelector(".cm-live-footnote-ref")?.textContent).toBe("[1]");
      expect(root.querySelector(".cm-live-footnote-definition p")?.textContent).toBe("Footnote text");
      expect(root.querySelector(".cm-live-footnote-definition button")?.textContent).toBe("Edit Source");
    });
    verify(["heading-id"], "#### Installation {#install}\n\nend", (root) => {
      expect(root.textContent).toContain("Installation");
      expect(root.textContent).not.toContain("{#install}");
    });
    verify(["definition-list"], "Markdown\n: Lightweight markup\n\nend", (root) => {
      expect(root.querySelector(".cm-live-definition-term")?.textContent).toContain("Markdown");
      expect(root.querySelector(".cm-live-definition-description")?.textContent).toContain("Lightweight markup");
      expect(root.textContent).not.toContain(": Lightweight");
    });
    verify(["strikethrough", "task-list"], "~~Removed~~\n\n- [ ] Todo\n- [x] Done\n\nend", (root) => {
      expect(root.querySelector(".cm-live-strike")?.textContent).toBe("Removed");
      expect(root.querySelectorAll(".cm-live-task")).toHaveLength(2);
    });
    verify(["emoji-direct", "emoji-shortcode"], "📝 :rocket: :white_check_mark:\n\nend", (root) => {
      expect(root.textContent).toContain("📝 🚀 ✅");
      expect(root.textContent).not.toContain(":rocket:");
    });
    verify(["highlight", "subscript", "superscript"], "==Mark== H~2~O X^2^\n\nend", (root) => {
      expect(root.querySelector(".cm-live-highlight")?.textContent).toBe("Mark");
      expect(root.querySelector(".cm-live-sub")?.textContent).toBe("2");
      expect(root.querySelector(".cm-live-sup")?.textContent).toBe("2");
    });
    verify(["bare-url"], "https://example.com and `https://example.com`\n\nend", (root) => {
      expect(root.querySelector(".cm-live-link")?.textContent).toContain("https://example.com");
      expect(root.querySelector(".cm-live-inline-code")?.textContent).toBe("https://example.com");
    });
  });

  it("renders Tegg technical extensions without consuming fenced examples", () => {
    verify(["frontmatter"], "---\ntitle: Test\n---\n\nBody", (root) => {
      expect(root.querySelector(".cm-live-properties")?.textContent).toContain("Metadata");
    });
    verify(["wiki-link"], "[[Target|Display Name]]\n\nend", (root) => {
      expect(root.querySelector(".cm-live-wikilink")?.textContent).toBe("Display Name");
      expect(root.textContent).not.toContain("[[Target");
    });
    verify(["callout"], "> [!WARNING] Warning\n> Handle carefully.\n\nend", (root) => {
      const callout = root.querySelector(".cm-live-callout-warning");
      expect(callout?.querySelector(".callout-title")?.textContent).toBe("Warning");
      expect(callout?.querySelector("p")?.textContent).toBe("Handle carefully.");
      expect(callout?.textContent).not.toContain("[!WARNING]");
    });
    verify(["math-inline", "math-block"], "Inline $E=mc^2$\n\n$$\nx^2\n$$\n\nend", (root) => {
      expect(root.querySelector(".cm-live-math-inline .katex")).not.toBeNull();
      expect(root.querySelector('.cm-preview-widget[aria-label="Math formula"] .katex')).not.toBeNull();
    });
    verify(["mermaid"], "```mermaid\nflowchart LR\nA-->B\n```\n\nend", (root) => {
      expect(root.querySelector('[data-rendered-diagram="mermaid"]')?.textContent).toContain("A-->B");
    });
    verify(["graphviz"], "```dot\ndigraph G { A -> B }\n```\n\nend", (root) => {
      expect(root.querySelector('[data-rendered-diagram="dot"]')?.textContent).toContain("A -> B");
    });
    const nested = mount("````markdown\n```mermaid\nflowchart LR\nA-->B\n```\n````\n\nend").parent;
    expect(nested.querySelector('[data-rendered-diagram="mermaid"]')).toBeNull();
    expect(nested.querySelector(".cm-live-code-block")?.textContent).toContain("```mermaid");
  });

  it("hides internal guide markers and covers every published syntax marker", () => {
    const { parent } = mount("<!-- tegg-syntax: headings-atx -->\n\nVisible", "<!-- tegg-syntax: headings-atx -->\n\nVisible".length);
    expect(parent.textContent).not.toContain("tegg-syntax");
    expect([...covered].sort()).toEqual([...supportedSyntaxMarkers].sort());
  });

  it("keeps callout identity visible while typing at the end of its body", () => {
    const source = "> [!warning] **Careful**\n> body";
    const {parent, view} = mount(source);
    view.focus();
    view.dispatch({selection: {anchor: source.length}});
    expect(parent.querySelector('.cm-live-callout-source[data-callout-kind="warning"]')).not.toBeNull();
    expect(parent.querySelector('.callout-editor-header strong')?.textContent).toBe("Careful");
    expect(parent.querySelectorAll('.callout-type-button')).toHaveLength(1);
    view.dispatch({changes: {from: source.length, insert: "!"}});
    expect(parent.querySelector('.callout-type-button')).not.toBeNull();
    expect(view.state.doc.toString()).toBe(source + "!");
  });

  it("keeps nested identities and opens the type menu without modifying source or caret", () => {
    const source = "> [!note] Outer\n> body\n>\n> > [!bug] Inner\n> > child";
    const {parent, view} = mount(source);
    view.focus();
    view.dispatch({selection: {anchor: source.length}});
    expect(parent.querySelectorAll('.callout-type-button')).toHaveLength(2);
    expect(parent.querySelector('[data-callout-kind="bug"]')).not.toBeNull();
    const receive = vi.fn();
    view.dom.addEventListener("tegg-callout-menu", receive);
    parent.querySelector<HTMLButtonElement>('.callout-type-button')!.click();
    expect(receive).toHaveBeenCalledOnce();
    expect(view.state.doc.toString()).toBe(source);
    expect(view.state.selection.main.head).toBe(source.length);
    view.dispatch({selection: {anchor: source.indexOf("note")}});
    expect(parent.textContent).toContain("[!note]");
    expect(parent.querySelectorAll('.callout-type-button')).toHaveLength(2);
  });

  it("keeps inline syntax hidden while the cursor is inside a semantic range", () => {
    const source = "Before **bold** after";
    const cursor = source.indexOf("bold") + 1;
    const { parent, view } = mount(source, cursor);
    view.focus();
    view.dispatch({ selection: { anchor: cursor } });
    expect(parent.textContent).toBe("Before bold after");
    expect(view.state.doc.toString()).toBe(source);
  });

  it("keeps frontmatter projected when the cursor is at its half-open end boundary", () => {
    const source = "---\ntitle: Test\n---\n\n# Heading";
    const boundary = source.indexOf("\n\n") + 1;
    const { parent, view } = mount(source, boundary);
    view.focus();
    expect(parent.querySelector("section.cm-live-properties")).not.toBeNull();
    expect(parent.querySelector(".cm-live-frontmatter-source")).toBeNull();
  });

  it("keeps consecutive blank lines visible regardless of selection or focus", () => {
    const source = "# Heading\n\n\nParagraph\n\n";
    const {parent, view} = mount(source);
    for (const anchor of [0, 10, 11, source.length]) {
      view.dispatch({selection: {anchor}});
      view.focus();
      expect(parent.querySelector(".cm-live-blank-line")).toBeNull();
      expect(parent.querySelectorAll(".cm-line")).toHaveLength(6);
      expect(view.state.doc.toString()).toBe(source);
      view.contentDOM.blur();
      expect(parent.querySelectorAll(".cm-line")).toHaveLength(6);
    }
  });

  it("keeps two Enter operations and their empty lines undoable", () => {
    const {parent, view} = mount("Text", 4);
    view.focus();
    insertNewline(view);
    insertNewline(view);
    expect(view.state.doc.toString()).toBe("Text\n\n");
    view.dispatch({selection: {anchor: 0}});
    expect(parent.querySelectorAll(".cm-line")).toHaveLength(3);
    expect(parent.querySelector(".cm-live-blank-line")).toBeNull();
    undo(view);
    expect(view.state.doc.toString()).toBe("Text\n");
    undo(view);
    expect(view.state.doc.toString()).toBe("Text");
  });

  it("maps a rendered-line click through the DOM instead of overlapping zero-height lines", () => {
    const source = "###### Heading level 6\n\n<!-- hidden -->\n\n### 1.2 Setext Headings";
    const { parent, view } = mount(source, source.length);
    view.focus();
    view.dispatch({ selection: { anchor: source.length } });
    const heading = parent.querySelector<HTMLElement>(".cm-live-heading-6")!;
    const textNode = [...heading.childNodes].find((node) => node.textContent?.includes("Heading level 6"))!;
    const range = document.createRange();
    range.setStart(textNode, Math.min(8, textNode.textContent?.length ?? 0));
    range.collapse(true);
    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: () => range,
    });

    heading.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      clientX: 12,
      clientY: 12,
      detail: 1,
    }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));

    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("###### Heading level 6");
    expect(parent.textContent).toContain("Heading level 6");
    expect(parent.textContent).not.toContain("######");
    Reflect.deleteProperty(document, "caretRangeFromPoint");
  });

  it("activates the exact source range when clicking replacement widgets", () => {
    const source = "Before :rocket:\n\n---\n\nAfter";
    const { parent, view } = mount(source, source.length);
    view.focus();
    view.dispatch({ selection: { anchor: source.length } });

    parent.querySelector<HTMLElement>(".cm-live-emoji")?.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
    }));
    expect(view.state.selection.main.head).toBe(source.indexOf(":rocket:"));

    view.dispatch({ selection: { anchor: source.length } });
    parent.querySelector<HTMLElement>(".cm-live-rule")?.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
    }));
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("---");
  });

  it("keeps table alignment when a visual source patch adds a row", () => {
    const source = "before\n\n- [ ] Task\n\n| Left | Right |\n| :--- | ---: |\n| A | B |\n\nafter";
    const { parent, view } = mount(source);
    parent.querySelector<HTMLInputElement>(".cm-live-task")
      ?.click();
    const addRow = [...parent.querySelectorAll("button")].find((button) => button.textContent === "Add Row");

    addRow?.click();

    expect(view.state.doc.toString()).toBe(
      "before\n\n- [x] Task\n\n| Left | Right |\n| :--- | ---: |\n| A | B |\n|  |  |\n\nafter",
    );
  });
});


describe("Link hover and spaced destinations", () => {
  it("keeps angle-wrapped filenames as editable links and routes a click", () => {
    const {parent, view} = mount("[返回主验证文档](<Mac Markdown 全格式逐项验证.md>)\n\nend");
    expect(parent.querySelector(".cm-live-html-inline")).toBeNull();
    const link = parent.querySelector<HTMLElement>(".cm-live-link")!;
    expect(link.textContent).toBe("返回主验证文档");
    const opened: string[] = [];
    view.dom.addEventListener("tegg-open-link", event => opened.push((event as CustomEvent).detail));
    link.dispatchEvent(new MouseEvent("mousedown", {bubbles: true}));
    link.dispatchEvent(new MouseEvent("click", {bubbles: true}));
    expect(decodeURI(opened[0])).toBe("Mac Markdown 全格式逐项验证.md");
  });
  it("retains one popup across child transitions and cancels every pending close on entry", () => {
    vi.useFakeTimers();
    try {
      const {parent} = mount("[**Label**](target.md)\n\nend");
      const link = parent.querySelector<HTMLElement>(".cm-live-link")!;
      link.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
      const panel = document.querySelector<HTMLElement>(".md-link-popover")!;
      expect(panel).not.toBeNull();
      link.dispatchEvent(new MouseEvent("mouseout", {bubbles: true}));
      link.dispatchEvent(new MouseEvent("mouseout", {bubbles: true}));
      panel.dispatchEvent(new MouseEvent("mouseenter"));
      vi.advanceTimersByTime(400);
      expect(panel.isConnected).toBe(true);
      link.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
      expect(document.querySelector(".md-link-popover")).toBe(panel);
      panel.dispatchEvent(new MouseEvent("mouseleave"));
      vi.advanceTimersByTime(400);
      expect(panel.isConnected).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});

describe("Multiline HTML paragraph layout", () => {
  it("keeps subsequent paragraphs visible around a hard break and inline HTML", () => {
    const source = 'First paragraph.\nSoft break.\n\nSecond paragraph.  \nSecond line.\n\nHard break.\\\nAfter break.<br>After HTML break.\n\n## Following heading\n\nFollowing content.';
    const {parent} = mount(source);
    expect(parent.textContent).toContain('Following content.');
    expect(parent.textContent).toContain('After HTML break.');
    expect(parent.querySelector('.cm-live-html-inline')).toBeNull();
  });
});


describe("Live paragraph breaks", () => {
  it.each(["\\\n", "  \n", "<br>", "<br/>", "<BR />"])("keeps %j hidden on focus and deletes it as one boundary", marker => {
    const source = "First" + marker + "Second";
    const {parent, view} = mount(source, 5 + marker.length);
    view.focus();
    expect(parent.querySelector(".cm-live-technical-source")).toBeNull();
    if (marker.trim()) expect(parent.textContent).not.toContain(marker.trim());
    expect(view.state.doc.toString()).toBe(source);
    expect(deleteLiveBreak(view, true)).toBe(true);
    expect(view.state.doc.toString()).toBe("FirstSecond");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    view.dispatch({selection: {anchor: 5}});
    expect(deleteLiveBreak(view, false)).toBe(true);
    expect(view.state.doc.toString()).toBe("FirstSecond");
  });
  it("inserts a hard break in ordinary text and leaves code alone", () => {
    const {view} = mount("FirstSecond", 5);
    expect(insertLiveBreak(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("First\\\nSecond");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("FirstSecond");
    const code = mount("`code`", 3).view;
    expect(insertLiveBreak(code)).toBe(false);
  });
  it("preserves escaped HTML and actual multiline HTML preview", () => {
    const {parent} = mount("Before <em>HTML\ncontent</em> after.\n\nEnd");
    expect(parent.querySelector(".cm-live-emphasis")?.textContent).toContain("HTML");
    const escaped = mount("Text \\<br> literal.").parent;
    expect(escaped.textContent).toContain("<br>");
  });
});


it("keeps a newly inserted paragraph-end break hidden and deletable before typing", () => {
  const {parent, view} = mount("First", 5);
  expect(insertLiveBreak(view)).toBe(true);
  expect(parent.textContent).not.toContain("\\");
  expect(deleteLiveBreak(view, true)).toBe(true);
  expect(view.state.doc.toString()).toBe("First");
});
it("inserts at paragraph start without falling back to a soft break", () => {
  const {view} = mount("First", 0);
  expect(insertLiveBreak(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("\\\nFirst");
});
it("deletes a newly inserted break before an existing paragraph gap", () => {
  const {view} = mount("First\n\nAfter", 5);
  expect(insertLiveBreak(view)).toBe(true);
  expect(deleteLiveBreak(view, true)).toBe(true);
  expect(view.state.doc.toString()).toBe("First\n\nAfter");
});

describe("Stable inline formatting while editing", () => {
  it.each([
    ["**Bold**", "Bold", ".cm-live-strong"],
    ["__Bold__", "Bold", ".cm-live-strong"],
    ["*Italic*", "Italic", ".cm-live-emphasis"],
    ["_Italic_", "Italic", ".cm-live-emphasis"],
    ["***Both***", "Both", ".cm-live-strong"],
    ["~~Old~~", "Old", ".cm-live-strike"],
    ["==Highlight==", "Highlight", ".cm-live-highlight"],
    ["`code`", "code", ".cm-live-inline-code"],
    ["<mark>Highlight</mark>", "Highlight", ".cm-live-highlight"],
    ["<u>Underline</u>", "Underline", ".cm-live-underline"],
  ])("keeps %s styled through focus, selection and text edits", (source, label, selector) => {
    const from = source.indexOf(label);
    const {parent, view} = mount(source, from + 1);
    view.focus();
    expect(parent.textContent).toBe(label);
    expect(parent.querySelector(selector)).not.toBeNull();
    view.dispatch({selection: {anchor: from, head: from + label.length}});
    expect(parent.textContent).toBe(label);
    expect(parent.querySelector(".cm-live-technical-source")).toBeNull();
    view.dispatch({changes: {from, to: from + label.length, insert: "Edited"}, selection: {anchor: from + 3}, userEvent: "input.type"});
    expect(parent.textContent).toBe("Edited");
    expect(parent.querySelector(selector)).not.toBeNull();
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });
  it("keeps mixed strike, Markdown highlight and HTML highlight in editable text", () => {
    const source = "~~Old~~ New ==**Bold**== <mark><u>HTML</u></mark>";
    const {parent, view} = mount(source, 3);
    view.focus();
    expect(parent.textContent).toBe("Old New Bold HTML");
    expect(parent.querySelectorAll(".cm-live-highlight").length).toBeGreaterThanOrEqual(2);
    expect(parent.querySelector(".cm-live-underline")?.textContent).toBe("HTML");
    expect(parent.querySelector(".cm-live-html-inline")).toBeNull();
  });
  it.each(["<mark>missing", "<u><mark>bad</u></mark>", '<mark class="custom">HTML</mark>'])("retains the source workflow for unsupported HTML %s", source => {
    const {parent} = mount(source + "\n\nEnd");
    expect(parent.querySelector(".cm-live-html-inline")).not.toBeNull();
  });
});


it("deletes adjacent visible text without tearing hidden formatting delimiters", () => {
  const {view} = mount("A **Bold** Z", 4);
  expect(deleteBesideInlineSyntax(view, true)).toBe(true);
  expect(view.state.doc.toString()).toBe("A**Bold** Z");
  expect(undo(view)).toBe(true);
  view.dispatch({selection: {anchor: 8}});
  expect(deleteBesideInlineSyntax(view, false)).toBe(true);
  expect(view.state.doc.toString()).toBe("A **Bold**Z");
});

describe("stable subscript and emoji editing", () => {
  it.each(["H~2~O", "X^2^", "CO<sub>2</sub>", "n<sup>3</sup>"])("keeps %s formatted with the caret inside", source => {
    const {parent, view} = mount(source);
    view.focus();
    view.dispatch({selection: {anchor: source.indexOf(source.includes("3") ? "3" : "2")}});
    expect(parent.querySelector(".cm-live-sub, .cm-live-sup")).not.toBeNull();
    expect(parent.querySelector(".cm-live-technical-source")).toBeNull();
    expect(parent.textContent).not.toMatch(/<sub>|<sup>|~|\^/);
    expect(view.state.doc.toString()).toBe(source);
  });
  it("moves and deletes across complete shortcodes and restores them with undo", () => {
    const source = "A:smile:B";
    const {parent, view} = mount(source, 8);
    view.focus();
    cursorCharLeft(view);
    expect(view.state.selection.main.head).toBe(1);
    view.dispatch({selection: {anchor: 8}});
    deleteCharBackward(view);
    expect(view.state.doc.toString()).toBe("AB");
    undo(view);
    expect(view.state.doc.toString()).toBe(source);
    expect(parent.querySelector(".cm-live-emoji")?.textContent).toBe("😄");
  });
  it("does not interpret code or unsupported shortcodes", () => {
    const {parent} = mount("`:smile:` :not_a_real_emoji: ~two words~");
    expect(parent.querySelector(".cm-live-emoji, .cm-live-sub")).toBeNull();
  });
});

describe("script format commands", () => {
  it.each(["H~2~O", "H<sup>2</sup>O"])("switches %s to a subscript without losing surrounding text", source => {
    const {view, parent} = mount(source);
    const from = source.indexOf("2");
    view.dispatch({selection: {anchor: from, head: from + 1}});
    executeEditorCommand(view, "subscript");
    expect(parent.textContent).toContain("H2O");
    expect(editorToolbarState(view.state).subscript).toBe(source.includes("<sup>"));
    expect(view.state.doc.toString()).not.toContain("<sup>");
    undo(view);
    expect(view.state.doc.toString()).toBe(source);
  });
  it("applies subscript to a mixed selection and preserves bold", () => {
    const source = "甲**乙**<sup>丙</sup>";
    const {view, parent} = mount(source);
    view.dispatch({selection: {anchor: 0, head: source.length}});
    executeEditorCommand(view, "subscript");
    expect(editorToolbarState(view.state).subscript).toBe(true);
    expect(editorToolbarState(view.state).superscript).toBe(false);
    expect(parent.textContent).toContain("甲乙丙");
    expect(parent.querySelector(".cm-live-strong")?.textContent).toBe("乙");
  });
  it("edits emoji shortcodes with validation, cancellation and undo", () => {
    HTMLDialogElement.prototype.showModal = function() { this.open = true; };
    HTMLDialogElement.prototype.close = function() { this.open = false; };
    const {view, parent} = mount("A:smile:B");
    parent.querySelector(".cm-live-emoji")!.dispatchEvent(new MouseEvent("dblclick", {bubbles: true}));
    const field = document.querySelector<HTMLInputElement>(".md-emoji-editor input")!;
    field.value = ":missing_emoji:"; field.dispatchEvent(new Event("input"));
    expect(document.querySelector<HTMLButtonElement>('.md-emoji-editor button[type="submit"]')!.disabled).toBe(true);
    field.value = ":joy:"; field.dispatchEvent(new Event("input"));
    document.querySelector(".md-emoji-editor form")!.dispatchEvent(new Event("submit", {cancelable: true}));
    expect(view.state.doc.toString()).toBe("A:joy:B");
    expect(document.querySelector(".md-emoji-editor")).toBeNull();
    undo(view); expect(view.state.doc.toString()).toBe("A:smile:B");
    parent.querySelector(".cm-live-emoji")!.dispatchEvent(new MouseEvent("contextmenu", {bubbles: true}));
    document.querySelector<HTMLButtonElement>('.md-emoji-editor button[type="button"]')!.click();
    expect(view.state.doc.toString()).toBe("A:smile:B");
  });
});

 it("keeps the last script character replacement well formed", () => {
   const {view, parent} = mount("H~2~O", 2);
   expect(deleteScriptContent(view, false)).toBe(true);
   const head = view.state.selection.main.head;
   view.dispatch({changes: {from: head, insert: "3"}, selection: {anchor: head + 1}});
   expect(view.state.doc.toString()).toBe("H<sub>3</sub>O");
   expect(parent.querySelector(".cm-live-sub")?.textContent).toBe("3");
 });

 describe("literal characters in Live Edit", () => {
   it("decodes entities without recursively interpreting the result", () => {
     const source = "&amp; &lt; &gt; &quot; &#124; &#x1F600; &amp;lt; &unknown;";
     const {parent, view} = mount(source, 2);
     view.focus();
     expect(parent.textContent).toContain('& < > " | 😀 &lt; &unknown;');
     expect(view.state.doc.toString()).toBe(source);
   });
   it("does not decode entities or escapes inside code", () => {
     const {parent} = mount("`&amp; \\*` \\&amp;");
     expect(parent.querySelector(".cm-live-inline-code")?.textContent).toBe("&amp; \\*");
     expect(parent.textContent).toContain("&amp;");
   });
   it("moves across an entity and deletes it as a unit", () => {
     const {view} = mount("A&amp;B", 6);
     cursorCharLeft(view); expect(view.state.selection.main.head).toBe(1);
     view.dispatch({selection: {anchor: 6}}); deleteCharBackward(view);
     expect(view.state.doc.toString()).toBe("AB");
     undo(view); expect(view.state.doc.toString()).toBe("A&amp;B");
   });
   it.each([
     ["&amp; &lt; &#124;", "& < |"],
     ["\\*literal\\*", "*literal*"],
     ["``Use `code` here.``", "Use `code` here."],
     ["`&amp;`", "&amp;"],
     ["` abc `", "abc"],
   ])("copies visible literal contents: %s", (source, expected) => {
     const {view} = mount(source);
     view.dispatch({selection: {anchor: 0, head: source.length}});
     expect(literalClipboardText(source, view.state)).toBe(expected);
     expect(view.state.doc.toString()).toBe(source);
   });
   it("copies a partial inline code selection without leaking markers", () => {
     const {view} = mount("`abcdef`");
     view.dispatch({selection: {anchor: 2, head: 4}});
     expect(literalClipboardText("bc", view.state)).toBe("bc");
   });
 });

describe("stable quote editing", () => {
  it("keeps one depth decoration per line while focus moves across nested quotes", () => {
    const source = "> First **bold**\n>\n> > Second\n> > > Third\n>\n> - Item\n\nOutside";
    const {view, parent} = mount(source);
    for (const anchor of [2, source.indexOf("Second"), source.indexOf("Third"), source.indexOf("Item"), source.length]) {
      view.dispatch({selection: {anchor}}); view.focus();
      const lines = [...parent.querySelectorAll<HTMLElement>(".cm-live-quote-line")];
      expect(lines.map(line => line.style.getPropertyValue("--md-quote-depth"))).toEqual(["1", "1", "2", "3", "1", "1"]);
      expect(parent.querySelector(".cm-live-quote-widget")).toBeNull();
      expect(parent.querySelector(".cm-live-list-marker")?.textContent).toBe("•");
      expect(lines.map(line => line.textContent).join("")).not.toContain(">");
      expect(view.state.doc.toString()).toBe(source);
    }
  });
  it("continues a quote, exits one level on an empty line, and restores with undo", () => {
    const {view} = mount("> > Text", 8);
    expect(editQuoteBoundary(view, true)).toBe(true);
    expect(view.state.doc.toString()).toBe("> > Text\n> > ");
    expect(editQuoteBoundary(view, true)).toBe(true);
    expect(view.state.doc.toString()).toBe("> > Text\n> ");
    expect(editQuoteBoundary(view, true)).toBe(true);
    expect(view.state.doc.toString()).toBe("> > Text\n");
    undo(view); expect(view.state.doc.toString()).toContain(">");
  });
  it("outdents at visible text start without deleting text", () => {
    const {view} = mount("> > Text", 4);
    expect(editQuoteBoundary(view, false)).toBe(true);
    expect(view.state.doc.toString()).toBe("> Text");
    undo(view); expect(view.state.doc.toString()).toBe("> > Text");
  });
  it("leaves quoted list continuation to the Markdown list commands", () => {
    const {view} = mount("> - Item", 8);
    expect(editQuoteBoundary(view, true)).toBe(false);
  });
});

describe("code block direct editing", () => {
  it("keeps the editor node while writing through to Markdown and undoing", () => {
    const {view,parent}=mount("```swift\nlet a = 1\n```\n\nend");
    const input=parent.querySelector<HTMLTextAreaElement>("textarea")!;
    input.focus(); input.value="let a = 2\n    print(a)";
    input.dispatchEvent(new Event("input",{bubbles:true}));
    expect(view.state.doc.toString()).toBe("```swift\nlet a = 2\n    print(a)\n```\n\nend");
    expect(parent.querySelector("textarea")).toBe(input);
    expect([...parent.querySelectorAll("button")].some(button=>button.textContent==="Done")).toBe(false);
    input.dispatchEvent(new KeyboardEvent("keydown",{key:"z",metaKey:true,bubbles:true,cancelable:true}));
    expect(input.value).toBe("let a = 1");
    expect(document.activeElement).toBe(input);
  });
  it("selects a language without touching code and preserves unknown languages", () => {
    const {view,parent}=mount("```unknown-syntax\nlet a = 1\n```");
    const language=parent.querySelector<HTMLSelectElement>(".md-code-language")!;
    expect(language.tagName).toBe("SELECT");
    expect(language.selectedOptions[0].textContent).toBe("unknown-syntax");
    language.value="python";language.dispatchEvent(new Event("change"));
    expect(view.state.doc.toString()).toBe("```python\nlet a = 1\n```");
    language.value="";language.dispatchEvent(new Event("change"));
    expect(view.state.doc.toString()).toBe("```\nlet a = 1\n```");
  });
  it("wraps visually without inserting newlines into the source", () => {
    const source="```text\n"+"long".repeat(80)+"\n```";
    const {view,parent}=mount(source);
    const wrap=parent.querySelector<HTMLButtonElement>('[aria-label="Wrap lines"]')!;
    wrap.click(); expect(parent.querySelector("textarea")!.wrap).toBe("soft");
    expect(view.state.doc.toString()).toBe(source);
    wrap.click(); expect(parent.querySelector("textarea")!.wrap).toBe("off");
  });
  it("copies just the code including tabs and blank lines", async () => {
    const writeText=vi.fn().mockResolvedValue(undefined);
    const previous=Object.getOwnPropertyDescriptor(navigator,"clipboard");
    Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});
    try {
      const {parent}=mount("```text\n\tfirst\n\nlast\n```");
      parent.querySelector<HTMLButtonElement>('[aria-label="Copy code"]')!.click();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith("\tfirst\n\nlast");
    } finally {
      if(previous) Object.defineProperty(navigator,"clipboard",previous);
      else Reflect.deleteProperty(navigator,"clipboard");
    }
  });
  it("does not expose quote prefixes to the direct code editor", () => {
    const source="> ```swift\n> let a = 1\n> ```";
    const {view,parent}=mount(source);
    expect(parent.querySelector("textarea")).toBeNull();
    expect(view.state.doc.toString()).toBe(source);
  });
  it("inserts indentation with Tab and finishes with Escape without dropping content", () => {
    const {view,parent}=mount("```text\na\n```");
    const input=parent.querySelector<HTMLTextAreaElement>("textarea")!;
    input.focus(); input.setSelectionRange(0,0);
    input.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true}));
    expect(input.value).toBe("    a");
    input.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));
    expect(view.state.doc.toString()).toBe("```text\n    a\n```");
  });
});
