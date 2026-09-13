/** @vitest-environment jsdom */
import {afterEach, describe, expect, it, vi} from "vitest";
import {TeggMarkdownEditor} from "./editor";
import {TeggMarkdownReader} from "./sdkReader";
import {resourceContext} from "./editorHost";
const instances: {destroy():void}[] = [];
const make = (source="one", onChange=vi.fn()) => {
  const root=document.createElement("div");document.body.append(root);
  const editor = new TeggMarkdownEditor(root,{documentId:"doc",revision:"r1",source},{onChange},"source");
  instances.push(editor);return {editor,root,onChange};
};
afterEach(() => {for(const instance of instances.splice(0)) instance.destroy();document.body.replaceChildren();});
describe("standalone editor Host contract", () => {
  it("shows attribution in all three modes without modifying saved source", () => {
    const {editor,root}=make("# Hello");
    for(const mode of ["reader","live","source"] as const) {
      expect(editor.setMode(mode)).toBe(true);
      expect(root.querySelector(".tegg-attribution")?.textContent).toBe("Powered by Tegg Markdown");
      expect(editor.snapshot().source).toBe("# Hello");
    }
  });
  it("reports edits with version identity and preserves undo across mode switches", async () => {
    const {editor,onChange}=make();
    editor.view.dispatch({changes:{from:3,insert:" two"}});
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({source:"one two",baseRevision:"r1",sequence:1,documentId:"doc"}));
    editor.setMode("reader");editor.setMode("source");editor.command("undo");
    expect(editor.source).toBe("one");
  });
  it("rejects incoming revisions while dirty and supports explicit resolution", () => {
    const {editor}=make();
    editor.view.dispatch({changes:{from:3,insert:" local"}});
    expect(editor.update({documentId:"doc",revision:"r2",source:"remote"})).toBe("conflict");
    expect(editor.source).toBe("one local");
    editor.replaceDocument({documentId:"doc",revision:"r2",source:"resolved"});
    expect(editor.dirty).toBe(false); expect(editor.command("undo")).toBe(false);
  });
  it("acknowledges the saved snapshot while retaining subsequent unsaved changes", () => {
    const {editor}=make();
    editor.view.dispatch({changes:{from:3,insert:" A"}});
    const saved=editor.snapshot();
    editor.view.dispatch({changes:{from:5,insert:" B"}});
    expect(editor.acknowledgeSaved(saved,"r2")).toBe(true);
    expect(editor.dirty).toBe(true);expect(editor.snapshot().baseRevision).toBe("r2");
    expect(editor.acknowledgeSaved(saved,"old")).toBe(false);
    expect(editor.acknowledgeSaved(editor.snapshot(),"r3")).toBe(true);
    expect(editor.dirty).toBe(false);
  });
  it("does not accept a save result for a replaced document", () => {
    const {editor}=make();const old=editor.snapshot();
    editor.replaceDocument({documentId:"new",revision:"r1",source:"new"});
    expect(editor.acknowledgeSaved(old,"r2")).toBe(false);
  });
  it("isolates resources, drafts and lifecycle between instances", () => {
    const {editor:a,root}=make("A");const {editor:b}=make("B");
    a.replaceDocument({documentId:"a",revision:"0",source:"A",documentPath:"/a/"});
    b.replaceDocument({documentId:"b",revision:"0",source:"B",documentPath:"/b/"});
    expect(a.view.state.facet(resourceContext).documentPath).toBe("/a/");
    expect(b.view.state.facet(resourceContext).documentPath).toBe("/b/");
    a.destroy();expect(root.childElementCount).toBe(0);
    b.view.dispatch({changes:{from:1,insert:" survives"}});expect(b.source).toBe("B survives");
  });
  it("changes callout type without the native application bridge", () => {
    const {editor,root}=make("> [!NOTE] Title\n> body");editor.setMode("live");
    editor.view.dom.dispatchEvent(new CustomEvent("tegg-callout-menu",{bubbles:true,detail:{from:0,x:10,y:10}}));
    const menu=root.querySelector<HTMLSelectElement>(".tegg-sdk-callout-menu")!;
    expect(menu).not.toBeNull();menu.value="warning";menu.dispatchEvent(new Event("change"));
    expect(editor.source).toBe("> [!warning] Title\n> body");editor.command("undo");
    expect(editor.source).toBe("> [!NOTE] Title\n> body");
  });
  it("keeps CRLF when editing and supports save/destroy/reopen", () => {
    const {editor}=make("a\r\nb\r\n");
    editor.view.dispatch({changes:{from:0,insert:"中文 "}});
    const saved=editor.snapshot();editor.destroy();
    const reopened=make(saved.source).editor;
    expect(reopened.source).toBe("中文 a\r\nb\r\n");
  });
  it("does not replace the editor or switch modes during composition", () => {
    const {editor}=make();
    editor.view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));
    expect(editor.setMode("live")).toBe(false);
    expect(editor.update({documentId:"doc",revision:"2",source:"remote"})).toBe("composing");
    expect(editor.source).toBe("one");
  });
  it("keeps streaming input in Reader until the Host settles it", () => {
    const {editor}=make();
    editor.replaceDocument({documentId:"stream",revision:"1",source:"partial",contentState:"streaming"});
    expect(editor.mode).toBe("reader");expect(editor.setMode("live")).toBe(false);
    editor.update({documentId:"stream",revision:"2",source:"complete",contentState:"settled"});
    expect(editor.setMode("live")).toBe(true);
  });
  it("renders the independent Reader with attribution and destroys only its frame", async () => {
    const root=document.createElement("div");document.body.append(root);
    const other=document.createElement("p");root.append(other);
    const reader=new TeggMarkdownReader(root);instances.push(reader);
    await reader.render({source:"# Reader"});
    expect(root.querySelector("h1")?.textContent).toBe("Reader");
    expect(root.querySelector(".tegg-attribution")).not.toBeNull();
    reader.destroy();expect(root.children.length).toBe(1);expect(root.firstChild).toBe(other);
  });
});

describe("Mac Host alignment", () => {
  it("publishes toolbar selection, history, save and Reader state", async () => {
    const {editor}=make("hello"); const states=vi.fn();
    const root=document.createElement("div");document.body.append(root);
    const second=new TeggMarkdownEditor(root,{documentId:"s",revision:"1",source:"hello"},{onStateChange:states},"source");instances.push(second);
    second.view.dispatch({selection:{anchor:0,head:5}});second.command("bold");await Promise.resolve();
    expect(states).toHaveBeenLastCalledWith(expect.objectContaining({bold:true,dirty:true,canUndo:true}));
    second.acknowledgeSaved(second.snapshot(),"2");await Promise.resolve();expect(states.mock.lastCall?.[0].dirty).toBe(false);
    second.setMode("reader");await Promise.resolve();expect(states.mock.lastCall?.[0].toolbarEnabled).toBe(false);
    expect(editor.source).toBe("hello");
  });
  it("rejects unknown commands and does not hijack a code widget input", () => {
    const {editor,root}=make("hello");expect(editor.command("heading99")).toBe(false);
    expect(editor.command("unknown")).toBe(false);expect(editor.command("callout:unknown")).toBe(false);
    const input=document.createElement("textarea");root.querySelector(".tegg-sdk-frame")!.append(input);input.focus();
    expect(editor.state.toolbarEnabled).toBe(false);expect(editor.command("bold")).toBe(false);expect(editor.source).toBe("hello");
  });
  it("navigates CRLF headings and rejects stale outline clicks", async () => {
    const {editor}=make("# One\r\n\r\n## Two\r\n");const outline=editor.outline();
    expect(await editor.navigateHeading(outline.headings[1].id,outline)).toBe(true);
    expect(editor.view.state.selection.main.head).toBe(7);
    editor.view.dispatch({changes:{from:0,insert:"intro\n"}});
    expect(await editor.navigateHeading(outline.headings[0].id,outline)).toBe(false);
    expect(editor.outline().headings[1].id).toBe(outline.headings[1].id);
  });
  it("focuses Reader headings and resolves fragments with the shared Mac parser", async () => {
    const {editor,root}=make("# First\n\n## Second heading");editor.setMode("reader");await editor.ready();
    expect(await editor.navigateFragment("second-heading")).toBe(true);
    expect(document.activeElement).toBe(root.querySelector("h2"));
    expect(await editor.navigateFragment("missing")).toBe(false);
  });
  it("isolates appearance and keeps it when the Reader renders again", async () => {
    const {editor,root}=make("# A");const {root:other}=make("# B");
    editor.setAppearance({fontScale:1.25,contentWidth:880,background:"rgb(20, 20, 20)",toolbarInset:40});
    editor.setMode("reader");await editor.ready();
    expect((root.querySelector(".tegg-reader") as HTMLElement).style.getPropertyValue("--reader-font-scale")).toBe("1.25");
    expect((root.querySelector(".tegg-sdk-editor") as HTMLElement).style.getPropertyValue("--reader-content-width")).toBe("880px");
    expect((other.querySelector(".tegg-sdk-editor") as HTMLElement).style.getPropertyValue("--reader-font-scale")).toBe("1");
  });
  it("retains source and undo when accessible editing is enabled", () => {
    const {editor}=make("hello");editor.view.dispatch({changes:{from:5,insert:" world"}});editor.setMode("live");
    expect(editor.setAccessibility(true)).toBe(true);expect(editor.mode).toBe("live");
    editor.command("undo");expect(editor.source).toBe("hello");
    editor.view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));
    expect(editor.setAccessibility(false)).toBe(false);
  });
  it("ignores native menu responses after the document changes", async () => {
    let finish!:(type:string)=>void;const root=document.createElement("div");document.body.append(root);
    const editor=new TeggMarkdownEditor(root,{documentId:"a",revision:"1",source:"> [!NOTE] title\n> body"},{selectCalloutType:() => new Promise(resolve => {finish=resolve;})});instances.push(editor);
    editor.view.dom.dispatchEvent(new CustomEvent("tegg-callout-menu",{bubbles:true,detail:{from:0,x:0,y:0}}));await Promise.resolve();
    editor.replaceDocument({documentId:"b",revision:"1",source:"new document"});finish("warning");await Promise.resolve();await Promise.resolve();
    expect(editor.source).toBe("new document");
  });
  it("drops pending outline and state callbacks after destroy", async () => {
    vi.useFakeTimers();const root=document.createElement("div");const onOutlineChange=vi.fn(),onStateChange=vi.fn();
    const editor=new TeggMarkdownEditor(root,{documentId:"a",revision:"1",source:"# A"},{onOutlineChange,onStateChange});editor.destroy();
    await Promise.resolve();vi.advanceTimersByTime(200);expect(onOutlineChange).not.toHaveBeenCalled();expect(onStateChange).not.toHaveBeenCalled();vi.useRealTimers();
  });
});
