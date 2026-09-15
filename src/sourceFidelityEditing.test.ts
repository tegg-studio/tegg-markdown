// @vitest-environment jsdom
import {afterEach,describe,expect,it} from "vitest";
import {TeggMarkdownEditor} from "./editor";
import cases from "../tests/fixtures/reliable/fidelity-cases.json";
const instances:TeggMarkdownEditor[]=[];
afterEach(()=>{for(const editor of instances.splice(0))editor.destroy();document.body.replaceChildren();});
describe("source fidelity after real local edits and mode round trips",()=>{
 for(const profile of ["tegg","github","gfm"] as const)for(const newline of ["\n","\r\n"])for(const bom of ["","\ufeff"]){
  it.each(cases)(`${profile} ${newline==="\n"?"LF":"CRLF"} ${bom?"BOM":"no BOM"}: $name`,async({source:snippet})=>{
   const source=bom+(snippet+"\n\nSentinel\n").replace(/\n/g,newline),root=document.createElement("div");document.body.append(root);
   const editor=new TeggMarkdownEditor(root,{documentId:"fixture",revision:"r1",source,profile},{},"source");instances.push(editor);
   editor.setMode("live");editor.setMode("reader");await editor.ready();editor.setMode("source");expect(editor.source).toBe(source);
   const offset=editor.view.state.doc.toString().lastIndexOf("Sentinel"),session=editor.editing.begin("selection",{from:offset,to:offset+8});
   expect(editor.editing.commit(session.token,"Edited").ok).toBe(true);expect(editor.source).toBe(source.replace(/Sentinel(?=\r?\n$)/,"Edited"));
   const saved=editor.beginSave();expect(editor.acknowledgeSaved(saved,"r2")).toBe(true);editor.replaceDocument({documentId:"fixture",revision:"r2",source:saved.source,profile});
   expect(editor.source).toBe(source.replace(/Sentinel(?=\r?\n$)/,"Edited"));expect(editor.dirty).toBe(false);
  });
 }
});

describe("unsupported newline safety",()=>{
 it.each(["first\rsecond\r","first\r\nsecond\n","first\nsecond\r"])("does not silently rewrite unsupported separators",source=>{
  const root=document.createElement("div");document.body.append(root);
  const editor=new TeggMarkdownEditor(root,{documentId:"separators",revision:"1",source},{},"source");instances.push(editor);
  expect(editor.view.state.readOnly).toBe(true);expect(editor.command("bold")).toBe(false);expect(editor.source).toBe(source);
 });
});
