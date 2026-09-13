import {setUIText, setUILabel} from "./uiContext";
import {WidgetType, type EditorView} from "@codemirror/view";
import {undo, redo} from "@codemirror/commands";
import {resourceContext} from "./editorHost";
import {highlightCode} from "./renderKit";
import {dispatchSourcePatches} from "./editorPatches";

export function readCode(raw: string) {
  const lines = raw.split("\n");
  const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(lines[0]);
  if (!opening) return {body: raw.replace(/^ {4}/gm, ""), language: "", opening: null, closing: "", closed: false};
  const last = lines[lines.length - 1];
  const closed = new RegExp(`^ {0,3}${opening[2][0]}{${opening[2].length},}\\s*$`).test(last);
  return {body: lines.slice(1, closed ? -1 : undefined).join("\n"), language: opening[3].trim().split(/\s+/)[0] || "", opening, closing: last, closed};
}
export function writeCode(raw: string, body: string, language?: string) {
  const model = readCode(raw);
  if (!model.opening) {
    if (language === undefined || !language) return body.split("\n").map(line => "    " + line).join("\n");
    return writeCode("```" + language + "\n\n```", body);
  }
  const [, indent, fence, info] = model.opening;
  const runs = body.match(new RegExp(fence[0] + "+", "g")) ?? [];
  const length = Math.max(fence.length, ...runs.map(run => run.length + 1));
  const marker = fence[0].repeat(length);
  const nextInfo = language === undefined ? info : info.replace(/^\s*\S*/, language);
  const close = length === fence.length ? model.closing : indent + marker;
  return indent + marker + nextInfo + "\n" + body + (model.closed ? "\n" + close : "");
}
export function mapCodePosition(before: string, after: string, position: number) {
  let from=0, oldEnd=before.length, newEnd=after.length;
  while(from<oldEnd && from<newEnd && before[from]===after[from]) from++;
  while(oldEnd>from && newEnd>from && before[oldEnd-1]===after[newEnd-1]) {oldEnd--;newEnd--;}
  if(position<from) return position;
  if(position>=oldEnd) return position+newEnd-oldEnd;
  return newEnd;
}
const names: Record<string,string> = {swift:"Swift", json:"JSON", python:"Python", javascript:"JavaScript", typescript:"TypeScript", html:"HTML", css:"CSS", text:"Plain Text", markdown:"Markdown", bash:"Shell", sql:"SQL", yaml:"YAML", xml:"XML", go:"Go", rust:"Rust", java:"Java", kotlin:"Kotlin", c:"C", cpp:"C++", csharp:"C#", ruby:"Ruby", php:"PHP"};
const cleanups = new WeakMap<HTMLElement,()=>void>();
const controls = new WeakMap<HTMLElement, {update(raw:string,from:number,to:number):void}>();
export class EditableCodeWidget extends WidgetType {
  constructor(readonly raw: string, readonly from: number, readonly to: number) {super();}
  eq(other: EditableCodeWidget) {return this.raw === other.raw && this.from === other.from && this.to === other.to;}
  updateDOM(dom: HTMLElement) {controls.get(dom)?.update(this.raw,this.from,this.to); return true;}
  toDOM(view: EditorView) {
    let raw = this.raw, from = this.from, to = this.to, composing = false;
    const wrapper = document.createElement("section");
    wrapper.contentEditable = "false";
    wrapper.className = "md-render-block md-render-code cm-live-code-block md-code-editor";
    const bar = document.createElement("div"); bar.className = "md-render-toolbar cm-preview-toolbar";
    const language = document.createElement("select"); language.className = "md-code-language";
    setUILabel(language, "Code language"); language.title = "Code language";
    const syncLanguage = () => {
      const current=readCode(raw).language;
      const choices: Record<string,string>={"":"Plain Text",...names};
      if(current==="text") delete choices[""]; else delete choices.text;
      if(current && !choices[current]) choices[current]=current;
      language.replaceChildren(...Object.entries(choices).map(([value,label])=>{
        const option=document.createElement("option"); option.value=value;option.textContent=label;return option;
      }));
      language.value=current;
    };
    const actions = document.createElement("div"); actions.className = "md-code-actions";
    const button = (label:string, run:()=>void) => { const b=document.createElement("button"); b.type="button"; b.textContent=label; b.addEventListener("click",run); return b; };
    const area = document.createElement("div"); area.className="md-code-area";
    const pre = document.createElement("pre"); pre.setAttribute("aria-hidden","true");
    const code = document.createElement("code"); pre.append(code);
    const input = document.createElement("textarea"); setUILabel(input, "Code content"); input.spellcheck=false; input.wrap="off";
    const resize = () => { if(!wrapper.isConnected) return; const left=input.scrollLeft; input.style.height="0px"; input.style.height=Math.max(input.scrollHeight, 48)+"px"; input.scrollLeft=left; pre.scrollLeft=left; pre.scrollTop=input.scrollTop; view.requestMeasure(); };
    const paint = () => { code.innerHTML=highlightCode(input.value + (input.value.endsWith("\n") ? "\n" : ""), readCode(raw).language, view.state.facet(resourceContext).engines); requestAnimationFrame(resize); };
    const commit = (next:string) => { if(next===raw) return; const focused=document.activeElement===input;
      const start=input.selectionStart,end=input.selectionEnd,direction=input.selectionDirection;
      dispatchSourcePatches(view,[{from,to,insert:next,expected:raw}]);
      if(focused && input.isConnected) {input.focus({preventScroll:true}); input.setSelectionRange(start,end,direction);} };
    const icon = (paths:string) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
    const copyIcon=icon('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>');
    const copy = button("", async ()=>{
      const text = readCode(raw).body;
      const request = new CustomEvent("tegg-copy-text", {detail:text, bubbles:true, cancelable:true});
      if (!copy.dispatchEvent(request)) return;
      let copied = false;
      try { await navigator.clipboard.writeText(text); copied = true; } catch {
        // Local WKWebView documents may not expose the async Clipboard API.
        const start=input.selectionStart, end=input.selectionEnd;
        const focused=document.activeElement as HTMLElement | null;
        input.focus(); input.select();
        try { copied=document.execCommand("copy"); } catch { copied=false; }
        input.setSelectionRange(start,end); focused?.focus({preventScroll:true});
      }
      copy.innerHTML=copied ? icon('<path d="m5 12 4 4L19 6"/>') : copyIcon;
      copy.title=copied ? "Copied" : "Copy failed — try again";
      setTimeout(()=>{copy.innerHTML=copyIcon;copy.title="Copy code";},1500);
    });
    copy.innerHTML=copyIcon;
    setUILabel(copy, "Copy code"); copy.title="Copy code";
    const wrap=button("",()=>{
      const enabled=input.wrap==="off";
      input.wrap=enabled?"soft":"off";
      wrapper.classList.toggle("md-code-wrap",enabled);
      wrap.setAttribute("aria-pressed",String(enabled));
      resize();
    });
    wrap.innerHTML=icon('<path d="M3 6h18M3 12h13a4 4 0 0 1 0 8h-4m3-3-3 3 3 3M3 18h4"/>');
    setUILabel(wrap, "Wrap lines");wrap.title="Wrap lines";wrap.setAttribute("aria-pressed","false");
    actions.append(wrap,copy); bar.append(language,actions); area.append(pre,input); wrapper.append(bar,area);
    input.value=readCode(raw).body;
    syncLanguage();
    input.addEventListener("compositionstart",()=>{composing=true;});
    input.addEventListener("compositionend",()=>{composing=false; commit(writeCode(raw,input.value)); paint();});
    input.addEventListener("input",()=>{paint(); if(!composing) commit(writeCode(raw,input.value));});
    input.addEventListener("scroll",()=>{pre.scrollLeft=input.scrollLeft;pre.scrollTop=input.scrollTop;});
    input.addEventListener("keydown",event=>{
      event.stopPropagation();
      if(event.isComposing) return;
      if(event.key==="Escape") {event.preventDefault(); input.blur();}
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="z") {
        event.preventDefault();
        (event.shiftKey?redo:undo)(view);
        if(input.isConnected) input.focus({preventScroll:true});
      }
      if(event.key==="Tab") {
        event.preventDefault(); const start=input.selectionStart,end=input.selectionEnd;
        if(!event.shiftKey && start===end) {input.setRangeText("    ",start,end,"end");}
        else { const lineStart=input.value.lastIndexOf("\n",start-1)+1; const selected=input.value.slice(lineStart,end); const changed=event.shiftKey?selected.replace(/^(?: {1,4}|\t)/gm,""):selected.replace(/^/gm,"    "); input.setRangeText(changed,lineStart,end,"select"); }
        input.dispatchEvent(new Event("input"));
      }
    });
    language.addEventListener("keydown",event=>event.stopPropagation());
    language.addEventListener("change",()=>{
      commit(writeCode(raw,readCode(raw).body,language.value));
      syncLanguage();
    });
    controls.set(wrapper,{update(next,start,end){
      raw=next;from=start;to=end;
      const value=readCode(raw).body;
      if(input.value!==value) {
        const start=mapCodePosition(input.value,value,input.selectionStart);
        const end=mapCodePosition(input.value,value,input.selectionEnd);
        const direction=input.selectionDirection;
        input.value=value;input.setSelectionRange(start,end,direction);
      }
      if(document.activeElement!==language) syncLanguage();
      paint();
    }});
    if(typeof ResizeObserver !== "undefined") {
      let width = -1;
      const observer=new ResizeObserver(entries=>{
        const next=entries[0]?.contentRect.width ?? 0;
        if(next!==width) {width=next;resize();}
      });
      observer.observe(area);
      cleanups.set(wrapper,()=>observer.disconnect());
    }
    paint(); return wrapper;
  }
  destroy(dom: HTMLElement){cleanups.get(dom)?.();controls.delete(dom);}
  ignoreEvent(){return true;}
}
