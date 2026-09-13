import {createElement, createContext, useContext} from "react";
import {renderToString} from "react-dom/server";
import {MarkdownReader, MarkdownEditor, type RendererProps, type MarkdownEditorRef} from "@tegg/markdown/react";
const Theme = createContext("blue");
function Code({node}: RendererProps) {return createElement("code", {style:{color:useContext(Theme)}}, node.text);}
const reader = createElement(MarkdownReader, {document:{documentId:"doc",source:"# Hello",profile:"github"},components:{code:Code},host:{locale:"zh-CN"}});
const editor = createElement(MarkdownEditor, {document:{documentId:"doc",source:"# Hello",revision:"r1"},mode:"source",ref:(value:MarkdownEditorRef|null)=>{value?.getInstance();}});
if (!renderToString(createElement(Theme.Provider,{value:"blue"},reader,editor)).includes("div")) throw new Error("SSR shells missing");
