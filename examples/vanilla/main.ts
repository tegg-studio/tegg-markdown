import {TeggMarkdownEditor, type EditorHost, type EditorMode, type EditorUIState, type OutlineSnapshot} from "../../src/sdk";
import "./style.css";
const initial = `# 让想法自然成文

这是一份真正的 Markdown 文档。可以直接编辑，也可以切到 **Source** 查看原文。

## 从文字开始

选中文字，试试上方的 **粗体**、*斜体*、==高亮== 或链接。三种模式共享同一份文档和撤销历史。

- [x] 阅读与编辑 Markdown
- [ ] 写下新的想法
- [ ] 导出为自己的 .md 文件

> [!NOTE] 源文件始终属于你
> 工具栏与可视编辑只修改对应的 Markdown。署名显示在界面中，不会写进文档。

## 把信息整理清楚

| 能力 | 状态 |
| --- | --- |
| 表格单元格编辑 | 双击或点击单元格 |
| 模式切换 | 保留编辑历史 |
| 本地保存 | 此浏览器存储 |

## 表达技术内容

\`\`\`js
const idea = "Make something useful.";
console.log(idea);
\`\`\`

$$
x^2 + y^2 = z^2
$$

## 继续探索

使用左侧大纲跳转，也可以[回到开头](#让想法自然成文)。

通过“插入”添加 Callout、表格、公式和图表。浏览器示例不包含 Mac 的文件库或 iCloud 同步。
`;
const $ = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
const status = $<HTMLElement>("status");
const mode = $<HTMLSelectElement>("mode");
const storageKey = "tegg-markdown-example";
let editor: TeggMarkdownEditor;
let filename = "欢迎使用.md";
let persistedSource: string | undefined;
const note = (message: string) => {status.textContent = message;};
const readSaved = (): {source:string;revision:string;filename?:string} | null => {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
  if (saved === null) return null;
  if (typeof saved.source !== "string" || typeof saved.revision !== "string") throw new Error("保存内容格式无效");
  return saved;
};
function showState(state: EditorUIState) {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-command]")) {
    const command = button.dataset.command!;
    const inline = ["bold","italic","underline","strike","highlight","subscript","superscript"];
    button.disabled = command === "undo" ? !state.canUndo : command === "redo" ? !state.canRedo : !state.toolbarEnabled || (inline.includes(command) && !state.inlineFormattingEnabled);
    if ([...inline,"code","task"].includes(command)) button.setAttribute("aria-pressed", state.mixed.includes(command) ? "mixed" : String(Boolean(state[command as keyof EditorUIState])));
  }
  $<HTMLSelectElement>("heading").disabled = !state.toolbarEnabled;
  $<HTMLSelectElement>("insert").disabled = !state.toolbarEnabled;
  $<HTMLSelectElement>("heading").value = state.heading === null ? "" : `heading${state.heading}`;
  mode.value = state.mode;
}
function showOutline(outline: OutlineSnapshot) {
  const nav = $("outline"); nav.replaceChildren();
  if (!outline.headings.length) {const p=document.createElement("p");p.textContent="添加标题即可生成大纲";nav.append(p);}
  for (const heading of outline.headings) {
    const button = document.createElement("button");button.textContent = heading.title || "无标题";
    button.style.paddingLeft = `${10 + (heading.level - 1) * 12}px`;
    button.addEventListener("click", () => {
      const current = editor.outline();
      const match = current.headings.find(item => item.id === heading.id && item.title === heading.title && item.level === heading.level);
      if (!match) {showOutline(current);note("大纲已更新，请重新选择标题。");return;}
      void editor.navigateHeading(match.id, current).then(ok => {if (!ok) {showOutline(editor.outline());note("文档已变化，请重新选择标题。");}});
    });
    nav.append(button);
  }
}
const host: EditorHost = {
  onChange: () => note(editor.dirty ? "有未保存的修改" : "与已保存版本一致"),
  onStateChange: showState, onOutlineChange: showOutline,
  openLink: href => {
    if (/^https?:\/\//i.test(href)) window.open(href,"_blank","noopener,noreferrer");
    else if (/^mailto:/i.test(href)) window.location.href = href;
    else note(href.startsWith("#") ? "没有找到这个标题" : "此链接需要宿主文件库支持：" + href);
  },
  copyText: text => navigator.clipboard.writeText(text),
  onError: error => note("操作失败：" + String(error))
};
editor = new TeggMarkdownEditor($("editor"),{documentId:"example",revision:"0",source:initial},host,"live");
const appearance = () => editor.setAppearance({fontScale:Number($<HTMLSelectElement>("font").value),contentWidth:Number($<HTMLSelectElement>("width").value)});
appearance();showState(editor.state);showOutline(editor.outline());
try {const saved=readSaved();persistedSource=saved?.source; if(saved) note("发现本地保存版本，可点击“恢复已保存版本”");} catch(error){host.onError!(error);}
mode.addEventListener("change", () => {if (!editor.setMode(mode.value as EditorMode)) {mode.value=editor.mode;note("请先完成输入法选词，再切换模式。");}});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-command]")) {
  button.addEventListener("mousedown", event => event.preventDefault());
  button.addEventListener("click", () => editor.command(button.dataset.command!));
}
for (const id of ["heading","insert"]) $<HTMLSelectElement>(id).addEventListener("change", event => {
  const select=event.target as HTMLSelectElement; if(select.value) editor.command(select.value); select.value=id === "heading" ? `heading${editor.state.heading ?? 0}` : "";
});
for (const id of ["font","width"]) $(id).addEventListener("change", appearance);
$<HTMLInputElement>("accessible").addEventListener("change", event => {const input=event.target as HTMLInputElement;if (!editor.setAccessibility(input.checked)) {input.checked=!input.checked;note("请先完成输入法选词。");}});
$("save").addEventListener("click", () => {
  try {
    const saved=editor.snapshot();const existing=readSaved();
    if (existing && existing.source !== persistedSource && !window.confirm("另一个页面可能修改了保存版本。用当前文档覆盖它？")) return;
    const revision=crypto.randomUUID(); localStorage.setItem(storageKey,JSON.stringify({source:saved.source,revision,filename}));
    persistedSource=saved.source; editor.acknowledgeSaved(saved,revision);note("已保存到此浏览器 · 可导出 .md 保留文件");
  } catch(error){host.onError!(error);}
});
function replace(source:string, revision:string, name:string) {
  if (editor.dirty && !window.confirm("当前文档有未保存的修改。放弃修改并打开其他版本？")) return false;
  if (editor.replaceDocument({documentId:"example",revision,source}) !== "applied") {note("请先完成输入法选词。");return false;}
  filename=name; $("filename").textContent=filename;showOutline(editor.outline());return true;
}
$("reopen").addEventListener("click", () => {
  try {const saved=readSaved();if (!saved) {note("还没有保存版本");return;}
    if(replace(saved.source,saved.revision,typeof saved.filename === "string" ? saved.filename : "文档.md")) {persistedSource=saved.source;note("已恢复浏览器中的保存版本");}
  } catch(error){host.onError!(error);}
});
$("open").addEventListener("click", () => $("file").click());
$<HTMLInputElement>("file").addEventListener("change", async event => {
  const input=event.target as HTMLInputElement;const file=input.files?.[0];if (!file) return;
  const snapshot=editor.snapshot();
  try {const source=await file.text();const current=editor.snapshot();
    if (current.generation !== snapshot.generation || current.sequence !== snapshot.sequence) {note("读取文件期间文档已变化，请重新打开文件。");return;}
    if(replace(source,crypto.randomUUID(),file.name)) note("已打开文件 · 修改后可导出 .md");
  } catch(error){host.onError!(error);} finally {input.value="";}
});
$("download").addEventListener("click", () => {
  const url=URL.createObjectURL(new Blob([editor.source],{type:"text/markdown;charset=utf-8"}));
  const link=document.createElement("a");link.href=url;link.download=/\.md$/i.test(filename) ? filename : filename+".md";link.click();setTimeout(() => URL.revokeObjectURL(url),1000);note("已导出 Markdown · 未写入署名或其他内容");
});
window.addEventListener("beforeunload", event => {if(editor.dirty){event.preventDefault();event.returnValue="";}});
window.addEventListener("pagehide", event => {if(!event.persisted) editor.destroy();});
