// @vitest-environment jsdom
import {afterEach, describe, it, expect, vi} from "vitest";
import {TeggMarkdownReader} from "./sdkReader";
import {TechnicalMarkdownReader} from "./reader";
import {TeggMarkdownEditor} from "./editor";
import {bindUI, setUIText} from "./uiContext";
import {openPanel} from "./renderInteraction";
const instances: Array<{destroy(): void}> = [];
function root() {const node = document.createElement("div"); node.className = "tegg-surface"; document.body.append(node); return node;}
afterEach(() => {instances.splice(0).forEach(item => item.destroy()); document.body.replaceChildren();});
describe("Host extension lifecycle", () => {
  it("delivers authorized asynchronous image URLs without remounting unrelated slots",async()=>{
    const element=root(),code=vi.fn((container:HTMLElement)=>{container.textContent="custom code";}),image=vi.fn((container:HTMLElement,node:any)=>{container.textContent=node.alt+" "+node.src;});
    const reader=new TechnicalMarkdownReader(element,{resourcePolicy:{allowedOrigins:["https://assets.example"]},resolveResource:async()=>"https://assets.example/allowed.png",renderers:{code,image}});instances.push(reader);
    await reader.render({source:"```text\ncode\n```\n\n![Alt text](private.png)"});expect(code).toHaveBeenCalledTimes(1);expect(image).toHaveBeenCalledTimes(1);expect(element.textContent).toContain("Alt text https://assets.example/allowed.png");
  });
  it("restores the current default if a retained renderer update throws",async()=>{
    const element=root(),destroy=vi.fn(),onError=vi.fn();const reader=new TechnicalMarkdownReader(element,{onError,renderers:{code:(container)=>{container.textContent="custom";return {destroy,update(){throw new Error("update failure");}};}}});instances.push(reader);
    const source="```text\npreserved\n```";await reader.render({documentId:"doc",revision:"1",source});await reader.render({documentId:"doc",revision:"2",source});
    expect(element.querySelector("code")?.textContent).toContain("preserved");expect(destroy).toHaveBeenCalledTimes(1);expect(onError).toHaveBeenCalledTimes(1);
  });
  it("disposes renderer instances on document replacement and destroy", async () => {
    const destroy = vi.fn(), element = root();
    const reader = new TechnicalMarkdownReader(element, {renderers: {table: (container, node) => {container.textContent = node.headers?.join(",") ?? ""; return {destroy};}}}); instances.push(reader);
    await reader.render({source: "| Column |\n| --- |\n| data |"});
    expect(element.textContent).toContain("Column");
    await reader.render({source: "replacement"}); expect(destroy).toHaveBeenCalledTimes(1);
    reader.destroy(); reader.destroy(); expect(destroy).toHaveBeenCalledTimes(1);
  });
  it("cleans up a renderer that resolves after it was destroyed", async () => {
    let finish!: (value: {destroy():void}) => void; const destroy = vi.fn();
    const reader = new TechnicalMarkdownReader(root(), {renderers: {code: () => new Promise(resolve => {finish = resolve;})}}); instances.push(reader);
    const pending = reader.render({source: "```plain\ncontent\n```"});
    await new Promise(resolve => setTimeout(resolve, 0)); reader.destroy();
    finish({destroy}); await pending; await Promise.resolve();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
  it("restores the safe default if a renderer throws", async () => {
    const element = root(), onError = vi.fn();
    const reader = new TechnicalMarkdownReader(element, {onError, renderers: {table: () => {throw new Error("renderer failure");}}}); instances.push(reader);
    await reader.render({source: "| Original |\n| --- |\n| preserved |"});
    expect(element.querySelector("table")?.textContent).toContain("preserved"); expect(onError).toHaveBeenCalledOnce();
  });
});
describe("instance UI isolation", () => {
  it("maps selection offsets to original CRLF source rather than normalized editor offsets", () => {
    const source="# Header\r\n\r\n选中文字 😀";
    const editor=new TeggMarkdownEditor(root(),{documentId:"crlf",revision:"1",source},{},"source");instances.push(editor);
    const normalized=editor.view.state.doc.toString(),from=normalized.indexOf("选中");editor.view.dispatch({selection:{anchor:from,head:normalized.length}});
    expect(editor.selection()).toMatchObject({documentId:"crlf",revision:"1",text:"选中文字 😀",range:{from:source.indexOf("选中"),to:source.length}});
  });
  it("routes standalone Reader overlays and cleans them on destroy", async () => {
    const container=root(), overlay=root();const reader=new TeggMarkdownReader(container,{locale:"zh-CN",overlayContainer:overlay});instances.push(reader);
    await reader.render({source:"```text\ncode\n```"});const panel=openPanel(container.querySelector("button")!,"Formula");await Promise.resolve();
    expect(overlay.querySelector("dialog")?.textContent).toContain("关闭");reader.destroy();expect(overlay.querySelector("dialog")).toBeNull();
  });
  it("translates only SDK labels, including an external overlay", async () => {
    const owner = root(), overlay = root();
    const ui = bindUI(owner, {locale: "zh-CN", overlayContainer: overlay}); instances.push(ui);
    const button = document.createElement("button"); setUIText(button, "Copy"); owner.append(button);
    const documentText = document.createElement("p"); documentText.textContent = "Copy"; owner.append(documentText);
    await Promise.resolve(); expect(button.textContent).toBe("复制"); expect(documentText.textContent).toBe("Copy");
    const panel = openPanel(button, "Formula"); await Promise.resolve();
    expect(owner.querySelector("dialog")).toBeNull(); expect(overlay.querySelector("dialog")?.textContent).toContain("关闭");
    panel.close(); expect(overlay.querySelector(".tegg-overlay-root")).toBeNull();
  });
  it("does not let HTML inject translation markers", async () => {
    const element = root(), reader = new TechnicalMarkdownReader(element, {locale: "zh-CN"}); instances.push(reader);
    await reader.render({source: '<p data-tegg-ui-text="Close">original document</p>'});
    expect(element.textContent).toContain("original document");
  });
  it("preserves the draft identity and undo across language changes", () => {
    const editor = new TeggMarkdownEditor(root(), {documentId: "doc", revision: "1", source: "original"}, {}, "source"); instances.push(editor);
    editor.view.dispatch({changes: {from: 8, insert: " edited"}}); const snapshot = editor.snapshot();
    editor.setUI({locale: "zh-CN"}); expect(editor.snapshot()).toEqual(snapshot);
    expect(editor.acknowledgeSaved(snapshot, "2")).toBe(true); expect(editor.command("undo")).toBe(true); expect(editor.source).toBe("original");
  });
  it("does not show Tegg-only widgets in GFM Live Edit", () => {
    const element = root(), source = "---\ntitle: literal\n---\n\n$x$ [[note]] H~2~O ==literal==";
    const editor = new TeggMarkdownEditor(element, {documentId: "doc", revision: "1", source, profile: "gfm"}); instances.push(editor);
    expect(element.querySelector(".frontmatter, .katex, .cm-live-wikilink, .cm-live-highlight")).toBeNull();
    expect(editor.source).toBe(source); expect(editor.command("mathBlock")).toBe(false);
  });
});
