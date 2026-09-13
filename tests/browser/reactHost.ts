import {createElement as h, createContext, StrictMode, useContext} from "react";
import {createRoot} from "react-dom/client";
import {MarkdownReader, MarkdownEditor} from "@tegg/markdown/react";
import "@tegg/markdown/editor.css";
const Context = createContext("missing");
const root = createRoot(document.querySelector("main")!);
let instance: any = null;
const errors: string[] = [], changes: any[] = [], conflicts: any[] = [];
const host = {locale: "zh-CN" as const, engines: {}, onError(error: unknown) {errors.push(String(error));}, onChange(change: any) {changes.push(change);}, onConflict(incoming: any, local: any) {conflicts.push({incoming,local});}};
function Code({node}: any) {return h("div", {"data-testid": "custom-code"}, useContext(Context), " ", node.text);}
function show(mode: "reader" | "editor", source = "```text\noriginal code\n```") {
  instance = null;
  const props = {document: {documentId:"doc", revision:"r1", source, profile:"github" as const}, host, components:{code:Code}, onReady(value: any) {instance=value;}};
  const content = mode === "reader" ? h(MarkdownReader, props) : h(MarkdownEditor, {...props,mode:"source"});
  root.render(h(StrictMode, {}, h(Context.Provider, {value:"context-preserved"}, content)));
}
(window as any).host={show, errors, changes, conflicts, get instance(){return instance;}, unmount(){root.unmount();}};
show("reader");
