import {scriptFormatting} from "./scriptFormatting";
import {codeSelectionState, formatCodeSelection} from "./codeFormatting";
import {selectionFormats, selectionFormatting, formatSelection} from "./selectionFormatting";
import {analyzeSource} from "./sourceAnalysis";
import {inlineHtmlFormatting} from "./inlineHtml";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { SourcePatch } from "./sourcePatch";
import type { EditorView } from "@codemirror/view";
import { dispatchSourcePatches as dispatchPatches } from "./editorPatches";
import { calloutContext, calloutContextKey, setCalloutType } from "./calloutEditing";
import { resolveCallout, isKnownCallout } from "./callouts";

function dispatchSourcePatches(...args: Parameters<typeof dispatchPatches>) {
  dispatchPatches(args[0], args[1], { ...args[2], isolateHistory: true });
}

export type EditorToolbarState = {
  parsing?: boolean;
  mixed: string[];
  inlineFormattingEnabled: boolean;
  bold: boolean;
  italic: boolean;
  code: boolean;
  underline: boolean;
  strike: boolean;
  highlight: boolean;
  subscript?: boolean;
  superscript?: boolean;
  task: boolean;
  heading: number | null;
  callout: string | null;
  calloutEnabled: boolean;
  calloutContext: string;
};

const inlineNodes: Record<string, string> = {
  bold: "StrongEmphasis", italic: "Emphasis", code: "InlineCode", strike: "Strikethrough",
};

function inlineRange(state: EditorState, command: string) {
  const selection = state.selection.main;
  let result: { from: number; start: number; end: number; to: number } | null = null;
  const tree = ensureSyntaxTree(state, selection.to, 50) ?? syntaxTree(state);
  if (command === "highlight" || command === "underline" || command === "subscript" || command === "superscript") {
    const excluded: {from: number; to: number}[] = [];
    tree.iterate({enter(node) {
      if (["InlineCode", "CodeBlock", "FencedCode", "HTMLBlock"].includes(node.name)) { excluded.push({from: node.from, to: node.to}); return false; }
    }});
    const analysis = analyzeSource(state.doc);
    const candidates = [...(command === "highlight" ? analysis.highlights : []), ...[...inlineHtmlFormatting(state).pairs, ...scriptFormatting(state)].filter(pair => pair.tag === ({underline: "u", highlight: "mark", subscript: "sub", superscript: "sup"} as Record<string, string>)[command])];
    const match = candidates.filter(range => range.from >= analysis.frontmatter.to && !excluded.some(code => range.from >= code.from && range.from < code.to))
      .filter(range => (selection.from >= range.contentFrom && selection.to <= range.contentTo) || (selection.from === range.from && selection.to === range.to))
      .sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
    return match ? {from: match.from, start: match.contentFrom, end: match.contentTo, to: match.to} : null;
  }

  tree.iterate({ from: selection.from, to: selection.to, enter(node) {
    if (node.name !== inlineNodes[command]) return;
    const first = node.node.firstChild;
    const last = node.node.lastChild;
    if (!first || !last || first === last) return;
    const inside = selection.from >= first.to && selection.to <= last.from;
    const whole = selection.from === node.from && selection.to === node.to;
    if ((inside || whole) && (!result || node.to - node.from < result.to - result.from)) {
      result = { from: node.from, start: first.to, end: last.from, to: node.to };
    }
  }});
  const htmlTag = ({bold: "strong", italic: "em", strike: "del"} as Record<string, string>)[command];
  const html = inlineHtmlFormatting(state).pairs.filter(pair => pair.tag === htmlTag &&
    ((selection.from >= pair.contentFrom && selection.to <= pair.contentTo) || (selection.from === pair.from && selection.to === pair.to)))
    .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
  if (html && (!result || html.to - html.from < (result as {from: number; to: number}).to - (result as {from: number; to: number}).from)) {
    return {from: html.from, start: html.contentFrom, end: html.contentTo, to: html.to};
  }
  return result as { from: number; start: number; end: number; to: number } | null;
}

function selectedLines(state: EditorState) {
  const selection = state.selection.main;
  const start = state.doc.lineAt(selection.from);
  const end = state.doc.lineAt(Math.max(selection.from, selection.to - 1));
  return Array.from({length: end.number - start.number + 1}, (_, i) => state.doc.line(start.number + i));
}

const toolbarCache=new WeakMap<EditorState,{tree:ReturnType<typeof syntaxTree>;value:EditorToolbarState}>();
export function editorToolbarState(state:EditorState):EditorToolbarState{
  const tree=syntaxTree(state),old=toolbarCache.get(state);if(old?.tree===tree)return {...old.value,mixed:[...old.value.mixed]};
  const value=computeToolbarState(state);toolbarCache.set(state,{tree:syntaxTree(state),value});return {...value,mixed:[...value.mixed]};
}
function computeToolbarState(state: EditorState): EditorToolbarState {
  // Toolbar observation must not repeatedly spend full parser budgets on input.
  // Commands can re-evaluate after the normal background parser catches up.
  if(state.doc.length>65536&&!ensureSyntaxTree(state,Math.min(state.doc.length,state.selection.main.to+1),5))return {
    parsing:true,mixed:[],inlineFormattingEnabled:false,bold:false,italic:false,code:false,underline:false,strike:false,highlight:false,subscript:false,superscript:false,task:false,heading:null,callout:null,calloutEnabled:false,calloutContext:calloutContextKey(state),
  };
  const context = calloutContext(state);
  const lines = selectedLines(state);
  const tree = ensureSyntaxTree(state, lines[lines.length - 1].to, 50) ?? syntaxTree(state);
  const levels = lines.map(line => {
    // Read the parsed block: hashes inside code are not headings, and Setext
    // headings have no opening hash prefix at all.
    let node = tree.resolveInner(line.from + line.text.length, -1);
    for (;;) {
      const match = node.name.match(/^(?:ATX|Setext)Heading([1-6])$/);
      if (match) return Number(match[1]);
      if (!node.parent) return 0;
      node = node.parent;
    }
  });
  const codeState = codeSelectionState(state);
  const coverage = state.selection.main.empty ? null : selectionFormatting(state);
  return {
    inlineFormattingEnabled: codeState !== "on",
    mixed: [...(coverage ? selectionFormats.filter(format => coverage.status(format) === "mixed") : []), ...(codeState === "mixed" ? ["code"] : [])],
    bold: coverage ? coverage.status("bold") === "on" : inlineRange(state, "bold") !== null,
    italic: coverage ? coverage.status("italic") === "on" : inlineRange(state, "italic") !== null,
    code: codeState === "on",
    underline: coverage ? coverage.status("underline") === "on" : inlineRange(state, "underline") !== null,
    strike: coverage ? coverage.status("strike") === "on" : inlineRange(state, "strike") !== null,
    highlight: coverage ? coverage.status("highlight") === "on" : inlineRange(state, "highlight") !== null,
    subscript: coverage ? coverage.status("subscript") === "on" : inlineRange(state, "subscript") !== null,
    superscript: coverage ? coverage.status("superscript") === "on" : inlineRange(state, "superscript") !== null,
    task: lines.every(line => /^\s*[-*+]\s+\[[ xX]\]\s/.test(line.text)),
    heading: levels.every(level => level === levels[0]) ? levels[0] : null,
    callout: context.target ? (isKnownCallout(context.target.type) ? resolveCallout(context.target.type).id : context.target.type) : null,
    calloutEnabled: context.enabled,
    calloutContext: calloutContextKey(state),
  };
}

function removeInlineFormat(editor: EditorView, command: string) {
  const range = inlineRange(editor.state, command);
  if (!range) return false;
  const selected = editor.state.selection.main;
  const patches = [
    { from: range.from, to: range.start, insert: "", expected: editor.state.sliceDoc(range.from, range.start) },
    { from: range.end, to: range.to, insert: "", expected: editor.state.sliceDoc(range.end, range.to) },
  ];
  const map = (position: number) => Math.max(range.from, Math.min(position, range.end) - (range.start - range.from));
  dispatchSourcePatches(editor, patches, {
    selection: { anchor: map(selected.anchor), head: map(selected.head) }, scrollIntoView: true,
  });
  editor.focus();
  return true;
}

export function executeEditorCommand(editor: EditorView, command: string) {
  if (command === "callout" || command.startsWith("callout:")) {
    setCalloutType(editor, command === "callout" ? "note" : command.slice(8));
    return;
  }
  if (command === "code" && (!editor.state.selection.main.empty || codeSelectionState(editor.state) === "on")) {
    const result = formatCodeSelection(editor.state);
    if (result?.patches.length) {
      dispatchSourcePatches(editor, result.patches, {selection: result.selection, scrollIntoView: true});
      editor.dispatch({selection: result.selection});
    }
    editor.focus();
    return;
  }
  if (editor.state.selection.main.empty && (command === "subscript" || command === "superscript")) {
    const opposite = inlineRange(editor.state, command === "subscript" ? "superscript" : "subscript");
    if (opposite && opposite.start < opposite.end) {
      editor.dispatch({selection: {anchor: opposite.start, head: opposite.end}});
      executeEditorCommand(editor, command);
      return;
    }
  }
  if (selectionFormats.includes(command as typeof selectionFormats[number]) && codeSelectionState(editor.state) === "on") return;
  if (!editor.state.selection.main.empty && selectionFormats.includes(command as typeof selectionFormats[number])) {
    const result = formatSelection(editor.state, command as typeof selectionFormats[number]);
    if (result) {
      const patches = ("patches" in result ? result.patches : [result.patch]).filter(patch => patch.insert !== patch.expected);
      if (!patches.length) { editor.focus(); return; }
      dispatchSourcePatches(editor, patches, {selection: result.selection, scrollIntoView: true});
      // Remember the post-command visible selection for Redo. A replacement's
      // default ChangeDesc mapping otherwise collapses it to the end of the block.
      editor.dispatch({selection: result.selection});
      editor.focus();
      return;
    }
  }
  if ((inlineNodes[command] || command === "highlight" || command === "underline" || command === "subscript" || command === "superscript") && removeInlineFormat(editor, command)) return;
  const selection = editor.state.selection.main;
  const selected = editor.state.sliceDoc(selection.from, selection.to);
  const wrappers: Record<string, [string, string, string]> = {
    bold: ["**", "**", "bold text"],
    italic: ["*", "*", "italic text"],
    subscript: ["<sub>", "</sub>", "text"], superscript: ["<sup>", "</sup>", "text"],
    underline: ["<u>", "</u>", "underlined text"],
    strike: ["~~", "~~", "strikethrough"],
    highlight: ["==", "==", "highlighted text"],
    code: ["`", "`", "code"],
    link: ["[", "](https://)", "link text"],
    image: ["![", "](image.png)", "alt text"],
    fileLink: ["[", "](file.md)", "file"],
    wikilink: ["[[", "]]", "Note"],
  };
  if (wrappers[command]) {
    const [before, after, placeholder] = wrappers[command];
    const content = selected || placeholder;
    dispatchSourcePatches(editor, [{
      from: selection.from,
      to: selection.to,
      insert: `${before}${content}${after}`,
      expected: selected,
    }], {
      selection: { anchor: selection.from + before.length, head: selection.from + before.length + content.length },
      scrollIntoView: true,
    });
    editor.focus();
    return;
  }

  const insertions: Record<string, string> = {
    table: "| Column 1 | Column 2 |\n| --- | --- |\n|  |  |",
    divider: "---",
    codeBlock: `\`\`\`text\n${selected || "code"}\n\`\`\``,
    mathBlock: `$$\n${selected || "formula"}\n$$`,
    mermaid: `\`\`\`mermaid\n${selected || "graph TD\n  A --> B"}\n\`\`\``,
    graphviz: `\`\`\`graphviz\n${selected || "digraph G { A -> B }"}\n\`\`\``,
    footnote: "[^1]\n\n[^1]: Footnote text",
  };
  if (insertions[command]) {
    const before = editor.state.sliceDoc(0, selection.from);
    const after = editor.state.sliceDoc(selection.to);
    const leading = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const trailing = after.length === 0 || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    const insertion = `${leading}${insertions[command]}${trailing}`;
    dispatchSourcePatches(editor, [{
      from: selection.from,
      to: selection.to,
      insert: insertion,
      expected: selected,
    }], {
      selection: { anchor: selection.from + insertion.length },
      scrollIntoView: true,
    });
    editor.focus();
    return;
  }

  const startLine = editor.state.doc.lineAt(selection.from);
  const endLine = editor.state.doc.lineAt(selection.empty ? selection.to : selection.to - 1);
  const block = editor.state.sliceDoc(startLine.from, endLine.to);

  if (command.startsWith("heading")) {
    const level = Number(command.slice("heading".length));
    if (!Number.isInteger(level) || level < 0 || level > 6) return;
    const marker = level === 0 ? "" : `${"#".repeat(level)} `;
    const tree = ensureSyntaxTree(editor.state, endLine.to, 50) ?? syntaxTree(editor.state);
    const patches: SourcePatch[] = [];
    const handled = new Set<number>();
    const patch = (from: number, to: number, insert: string) => {
      const expected = editor.state.sliceDoc(from, to);
      if (expected !== insert) patches.push({from, to, insert, expected});
    };
    for (const line of selectedLines(editor.state)) {
      let heading: SyntaxNode | null = null;
      let inCode = false;
      for (let node: SyntaxNode | null = tree.resolveInner(line.to, -1); node; node = node.parent) {
        if (/^(?:ATX|Setext)Heading[1-6]$/.test(node.name)) heading = node;
        if (node.name === "FencedCode" || node.name === "CodeBlock") inCode = true;
      }
      if (inCode) continue;
      if (heading) {
        if (handled.has(heading.from)) continue;
        handled.add(heading.from);
        if (heading.name.startsWith("Setext")) {
          const underline = heading.lastChild!;
          const text = editor.state.sliceDoc(heading.from, underline.from).trimEnd();
          // ATX is single-line; folding a Setext soft break preserves its rendered text.
          patch(heading.from, heading.to, marker + (level ? text.replace(/\n[ \t]*/g, " ") : text));
        } else {
          const opening = heading.firstChild!;
          let to = opening.to;
          while (/[ \t]/.test(editor.state.sliceDoc(to, to + 1)) && to < heading.to) to++;
          patch(opening.from, to, marker);
          const closing = heading.lastChild;
          if (level === 0 && closing?.name === "HeaderMark" && closing.from !== opening.from) {
            let from = closing.from;
            while (from > to && /[ \t]/.test(editor.state.sliceDoc(from - 1, from))) from--;
            patch(from, closing.to, "");
          }
        }
      } else if (marker) {
        patch(line.from, line.from, marker);
      }
    }
    if (patches.length) dispatchSourcePatches(editor, patches, {scrollIntoView: true});
    editor.focus();
    return;
  }

  const prefixes: Record<string, string> = {
    task: "- [ ] ",
    list: "- ",
    orderedList: "1. ",
    quote: "> ",
  };
  const removingTask = command === "task" && editorToolbarState(editor.state).task;
  const prefix = removingTask ? "" : prefixes[command];
  if (prefix === undefined) return;
  const transformed = block.split("\n").map((line) => {
    const match = line.match(/^(\s*)(.*)$/);
    if (!match) return `${prefix}${line}`;
    const content = match[2].replace(/^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s+)/, "");
    return `${match[1]}${prefix}${content}`;
  }).join("\n");
  dispatchSourcePatches(editor, [{
    from: startLine.from,
    to: endLine.to,
    insert: transformed,
    expected: block,
  }], {
    selection: { anchor: startLine.from + prefix.length, head: startLine.from + transformed.length },
    scrollIntoView: true,
  });
  editor.focus();
}
