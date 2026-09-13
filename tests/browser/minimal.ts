import {TeggMarkdownReader} from "@tegg/markdown/reader";
import "@tegg/markdown/reader.css";
const root = document.querySelector<HTMLElement>("main")!;
let reader = new TeggMarkdownReader(root, {engines: {}});
let many: TeggMarkdownReader[] = [];
const api = {
  async render(source: string, options = {}) {await reader.render({documentId: "doc", revision: "1", source, profile: "github", ...options});},
  destroy() {reader.destroy();many.forEach(item=>item.destroy());many=[];},
  recreate() {reader.destroy(); reader = new TeggMarkdownReader(root, {engines: {}});},
  async instances(count: number) {
    api.destroy(); root.replaceChildren();
    const readers: TeggMarkdownReader[] = [];
    for (let i=0;i<count;i++) {const node = document.createElement("div");root.append(node);const item = new TeggMarkdownReader(node,{engines:{},locale:i%2 ? "zh-CN" : "en-US"});await item.render({source:`# Instance ${i}\n\n- [x] retained\n\n\`\`\`text\ncode\n\`\`\``});readers.push(item);}
    many=readers; return () => api.destroy();
  },
  async cycles(count: number) {for(let i=0;i<count;i++){const node=document.createElement("div");root.append(node);const item=new TeggMarkdownReader(node,{engines:{}});await item.render({source:"# Cycle\n\ntext"});item.destroy();node.remove();}},
};
(window as any).host=api;
await api.render("# Markdown host\n\nHello **world**.\n\n| Header |\n| --- |\n| value |\n\n- [x] Done\n\n```js\nconst x = 1;\n```");
