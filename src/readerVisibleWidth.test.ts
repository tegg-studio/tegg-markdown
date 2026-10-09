/** @vitest-environment jsdom */
import {afterEach,describe,expect,it,vi,type Mock} from "vitest";
import {undoDepth,redoDepth} from "@codemirror/commands";
import {TeggMarkdownEditor} from "./editor";
import {observeTypography,refreshTypography} from "./typography";

const editors:TeggMarkdownEditor[]=[];
afterEach(()=>{for(const editor of editors.splice(0))editor.destroy();vi.unstubAllGlobals();vi.restoreAllMocks();document.body.replaceChildren();});

describe("visible Reader width projection",()=>{
  it("refreshes a revealed surface without creating another observer or changing disposal",()=>{
    let callback:ResizeObserverCallback|undefined;
    const observe=vi.fn(),disconnect=vi.fn(),created=vi.fn();
    vi.stubGlobal("ResizeObserver",class {constructor(cb:ResizeObserverCallback){created();callback=cb;}observe=observe;disconnect=disconnect;});
    const root=document.createElement("div");root.hidden=true;document.body.append(root);
    let width=1280;Object.defineProperty(root,"clientWidth",{get:()=>root.hidden?0:width});
    const stop=observeTypography(root);
    expect(root.dataset.layout).toBe("compact");expect(root.style.getPropertyValue("--md-canvas-width")).toBe("0px");
    root.hidden=false;refreshTypography(root);
    expect(root.dataset.layout).toBe("wide");expect(root.style.getPropertyValue("--md-canvas-width")).toBe("1280px");
    const projected=root.getAttribute("style");
    callback!([{target:root} as unknown as ResizeObserverEntry],{} as ResizeObserver);
    expect(root.getAttribute("style")).toBe(projected);expect(created).toHaveBeenCalledOnce();expect(observe).toHaveBeenCalledOnce();
    width=390;refreshTypography(root);expect(root.dataset.layout).toBe("compact");expect(root.style.getPropertyValue("--md-canvas-width")).toBe("390px");
    stop();expect(disconnect).toHaveBeenCalledOnce();
  });

  it("projects the actual shown Reader width synchronously while retaining document, selection and history",async()=>{
    const entries:Array<{callback:ResizeObserverCallback;targets:Set<Element>;disconnect:Mock<()=>void>}>=[];
    vi.stubGlobal("ResizeObserver",class {
      record:{callback:ResizeObserverCallback;targets:Set<Element>;disconnect:Mock<()=>void>};
      constructor(callback:ResizeObserverCallback){this.record={callback,targets:new Set(),disconnect:vi.fn<()=>void>()};entries.push(this.record);}
      observe(target:Element){this.record.targets.add(target);}
      disconnect(){this.record.disconnect();}
    });
    let width=1280;
    vi.spyOn(HTMLElement.prototype,"clientWidth","get").mockImplementation(function(this:HTMLElement){return this.hidden?0:width;});
    const root=document.body.appendChild(document.createElement("div"));
    const editor=new TeggMarkdownEditor(root,{documentId:"visible-width",revision:"r1",source:"# Title\n\nbody"},{},"live");editors.push(editor);
    editor.view.dispatch({changes:{from:editor.view.state.doc.length,insert:"!"},selection:{anchor:2,head:6}});
    const reader=root.querySelector<HTMLElement>(".tegg-reader")!;
    const binding=entries.find(entry=>entry.targets.has(reader))!;expect(binding).toBeDefined();
    const doc=editor.view.state.doc;
    const stable=()=>({source:editor.source,selection:editor.view.state.selection.toJSON(),undo:undoDepth(editor.view.state),redo:redoDepth(editor.view.state)});
    const before=stable();expect(before.undo).toBe(1);
    for(const [allocated,layout] of [[1280,"wide"],[479,"compact"],[480,"regular"],[959,"regular"],[960,"wide"]] as const){
      if(editor.mode!=="live")expect(editor.setMode("live")).toBe(true);
      binding.callback([{target:reader} as unknown as ResizeObserverEntry],{} as ResizeObserver);
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      expect(reader.hidden).toBe(true);expect(reader.style.getPropertyValue("--md-canvas-width")).toBe("0px");
      width=allocated;
      expect(editor.setMode("reader")).toBe(true);
      // No animation frame or ResizeObserver delivery separates show from these assertions.
      expect(reader.hidden).toBe(false);expect(reader.dataset.layout).toBe(layout);
      expect(reader.style.getPropertyValue("--md-canvas-width")).toBe(`${allocated}px`);
      expect(editor.view.state.doc).toBe(doc);expect(stable()).toEqual(before);
      await editor.ready();expect(stable()).toEqual(before);
    }
    expect(entries.filter(entry=>entry.targets.has(reader))).toHaveLength(1);
    editor.destroy();expect(binding.disconnect).toHaveBeenCalledOnce();
  });
});
