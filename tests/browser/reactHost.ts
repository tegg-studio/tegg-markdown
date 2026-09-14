import {createElement as h, createContext, StrictMode, useState, useContext} from "react";
import {createRoot} from "react-dom/client";
import {MarkdownReader, MarkdownEditor} from "@tegg/markdown/react";
import "@tegg/markdown/editor.css";
import {MarkdownToolbar} from "./Toolbar";
import type {EditorUIState} from "@tegg/markdown/editor";
const Context = createContext("missing");
const root = createRoot(document.querySelector("main")!);
let instance: any = null;
const errors: string[] = [], changes: any[] = [], conflicts: any[] = [];
const host = {locale: "zh-CN" as const, engines: {}, onError(error: unknown) {errors.push(String(error));}, onChange(change: any) {changes.push(change);}, onConflict(incoming: any, local: any) {conflicts.push({incoming,local});}};
function Code({node}: any) {return h("div", {"data-testid": "custom-code"}, useContext(Context), " ", node.text);}
function show(mode: "reader" | "editor", source = "```text\noriginal code\n```", layout: "host" | "internal" = "internal") {
  instance = null;
  const props = {document: {documentId:"doc", revision:"r1", source, profile:"github" as const}, host, components:{code:Code}, onReady(value: any) {instance=value;}};
  function EditorWithToolbar(){
    const [state,setState]=useState<EditorUIState|null>(null);
    return h("div",{style:{height:"420px",display:"flex",flexDirection:"column",overflow:"hidden"}},h(MarkdownToolbar,{editor:instance,state}),h(MarkdownEditor,{...props,mode:"source",className:"integration-editor",host:{...host,layout,onStateChange:setState}}));
  }
  const style=document.createElement("style");style.textContent=".integration-editor{flex:1;min-height:0;height:100%}";document.head.append(style);
  const content = mode === "reader" ? h("div",{style:layout === "internal" ? {height:"420px",overflow:"hidden"} : {height:"auto"}},h(MarkdownReader,{...props,className:"integration-editor",host:{...host,layout}})) : h(EditorWithToolbar);
  root.render(h(StrictMode, {}, h(Context.Provider, {value:"context-preserved"}, content)));
}
(window as any).host={show, errors, changes, conflicts, get instance(){return instance;}, unmount(){root.unmount();}};
show("reader");
