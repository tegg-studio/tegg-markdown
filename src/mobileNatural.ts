import { Facet, Prec } from "@codemirror/state";
import { Decoration, EditorView, keymap, ViewPlugin } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { executeEditorCommand } from "./editorToolbar";
import { dispatchSourcePatches } from "./editorPatches";

// Opt-in per editor. The macOS host never installs this facet or bridge.
export const mobileNatural = Facet.define<boolean, boolean>({combine: values => values.some(Boolean)});
export const naturalEditing = (view: EditorView) => view.state.facet(mobileNatural);

export function naturalMarkerRanges(view: EditorView) {
  const ranges: {from: number; to: number}[] = [];
  const tree = ensureSyntaxTree(view.state, view.state.doc.length, 40) ?? syntaxTree(view.state);
  tree.iterate({enter(node) {
    if (["Table", "Image", "HorizontalRule"].includes(node.name)) { ranges.push({from:node.from,to:node.to}); return false; }
    if (["FencedCode", "CodeBlock"].includes(node.name)) return false;
    if (["HeaderMark", "EmphasisMark", "StrikethroughMark", "CodeMark", "LinkMark", "QuoteMark", "ListMark", "TaskMarker"].includes(node.name)
      || (node.name === "URL" && node.node.parent?.name === "Link")) {
      let to = node.to;
      if (["HeaderMark", "ListMark", "QuoteMark"].includes(node.name)) {
        while (/^[ \t]$/.test(view.state.sliceDoc(to, to + 1))) to++;
      }
      ranges.push({from: node.from, to});
    }
  }});
  return ranges.sort((a,b) => a.from - b.from || a.to - b.to);
}

function removeAtBoundary(view: EditorView) {
  if (view.state.readOnly || view.composing || !view.state.selection.main.empty) return false;
  const pos = view.state.selection.main.from;
  const line = view.state.doc.lineAt(pos);
  const header = line.text.match(/^(#{1,6}) /);
  if (header && pos === line.from + header[0].length) {
    dispatchSourcePatches(view,[{from:line.from,to:pos,insert:"",expected:header[0]}],{selection:{anchor:line.from},isolateHistory:true}); return true;
  }
  let command: string | undefined;
  syntaxTree(view.state).iterate({from: pos, to: pos, enter(node) {
    const kind: Record<string,string> = {StrongEmphasis:"bold", Emphasis:"italic", Strikethrough:"strike", InlineCode:"code"};
    if (kind[node.name] && node.node.firstChild?.to === pos) command = kind[node.name];
  }});
  if (!command) return false;
  executeEditorCommand(view, command); return true;
}

export const mobileNaturalExtensions = [
  mobileNatural.of(true),
  EditorView.atomicRanges.of(view => Decoration.set(naturalMarkerRanges(view).map(range => Decoration.replace({}).range(range.from, range.to)), true)),
  Prec.high(keymap.of([
    {key:"Mod-b", run:view => {if(view.state.readOnly || view.composing) return false; executeEditorCommand(view,"bold"); return true;}},
    {key:"Mod-i", run:view => {if(view.state.readOnly || view.composing) return false; executeEditorCommand(view,"italic"); return true;}},
    {key:"Backspace", run:removeAtBoundary},
  ])),
  ViewPlugin.fromClass(class {
    private observer: ResizeObserver;
    private frame = 0;
    constructor(readonly view: EditorView) {
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(view.dom);
      window.visualViewport?.addEventListener("resize", this.resize);
    }
    resize = () => {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => {
        this.view.requestMeasure();
        if (this.view.hasFocus && !this.view.composing) this.view.dispatch({effects: EditorView.scrollIntoView(this.view.state.selection.main.head,{y:"nearest",yMargin:24})});
      });
    };
    destroy() { this.observer.disconnect(); window.visualViewport?.removeEventListener("resize",this.resize); cancelAnimationFrame(this.frame); }
  }),
];
