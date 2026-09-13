import {TeggMarkdownEditor, TeggMarkdownReader, type EditorMode} from "../../src/sdk";
const initial = '# Hello, Markdown\n\nEdit this **source-first** document. 中文输入。\n\n| Task | Status |\n| --- | --- |\n| Read | Ready |\n| Edit | Ready |\n\n> [!NOTE]\n> Your Host owns saving.\n\n$$\nx^2 + y^2 = z^2\n$$\n\n\`\`\`js\nconsole.log("Hello");\n\`\`\`\n';
const status = document.querySelector<HTMLElement>("#status")!;
const viewer = new TeggMarkdownReader(document.querySelector<HTMLElement>("#reader")!);
let editor: TeggMarkdownEditor;
const host = {
  onChange: () => {status.textContent = "Unsaved changes"; void viewer.render({source:editor.source});},
  openLink: (href: string) => {status.textContent = "Host received link: " + href;},
  onError: (error: unknown) => {status.textContent = "Error: " + String(error);}
};
const create = (source: string, revision: string) => new TeggMarkdownEditor(
  document.querySelector<HTMLElement>("#editor")!, {documentId:"example",revision,source},host,
  document.querySelector<HTMLSelectElement>("#mode")!.value as EditorMode);
editor = create(initial,"0"); void viewer.render({source:initial});
document.querySelector("#mode")!.addEventListener("change", event => {
  if (!editor.setMode((event.target as HTMLSelectElement).value as EditorMode)) status.textContent = "Finish composing before switching mode.";
});
document.querySelector("#save")!.addEventListener("click", () => {
  try {
    const saved = editor.snapshot(); const revision = crypto.randomUUID();
    localStorage.setItem("tegg-markdown-example", JSON.stringify({source:saved.source,revision}));
    editor.acknowledgeSaved(saved,revision); status.textContent = "Saved locally";
  } catch (error) {host.onError(error);}
});
document.querySelector("#reopen")!.addEventListener("click", () => {
  try {
    const saved = JSON.parse(localStorage.getItem("tegg-markdown-example") ?? "null");
    if (!saved) {status.textContent="No saved document";return;}
    editor.destroy(); editor = create(saved.source,saved.revision);
    void viewer.render({source:saved.source}); status.textContent="Reopened saved Markdown";
  } catch (error) {host.onError(error);}
});
document.querySelector("#undo")!.addEventListener("click", () => editor.command("undo"));
document.querySelector("#redo")!.addEventListener("click", () => editor.command("redo"));
window.addEventListener("pagehide", () => {editor.destroy(); viewer.destroy();});
