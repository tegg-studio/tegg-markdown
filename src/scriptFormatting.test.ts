import {describe, expect, it} from "vitest";
import {EditorState} from "@codemirror/state";
import {ensureSyntaxTree, syntaxTree} from "@codemirror/language";
import {markdown} from "@codemirror/lang-markdown";
import {GFM} from "@lezer/markdown";
import {scriptFormatting} from "./scriptFormatting";
import {markdownParser} from "./markdownParser";
import {editorToolbarState} from "./editorToolbar";

type Pair = ReturnType<typeof scriptFormatting>[number];
const excludedNames = ["InlineCode", "FencedCode", "CodeBlock", "HTMLBlock", "HTMLTag", "URL", "LinkTitle", "Escape"];
function parsed(source: string, anchor = 0) {
  const state = EditorState.create({doc: source, selection: {anchor}, extensions: [markdown({extensions: GFM})]});
  expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull();
  return state.update({}).state;
}
function exclusions(state: EditorState) {
  const ranges: {from: number; to: number; name: string}[] = [];
  syntaxTree(state).iterate({enter(node) {
    if (excludedNames.includes(node.name)) {ranges.push({from: node.from, to: node.to, name: node.name});return false;}
  }});
  return ranges;
}
// Retain the previous overlap algorithm as a differential oracle for the cursor change.
function previousOverlapScan(state: EditorState): Pair[] {
  const source = state.doc.toString(), excluded = exclusions(state), result: Pair[] = [];
  for (const match of source.matchAll(/(?<!~)~([^~\n]+)~(?!~)|\^([^\^\n]+)\^/g)) {
    const from = match.index!, to = from + match[0].length;
    if (excluded.some(range => from < range.to && to > range.from)) continue;
    const tag = match[1] !== undefined ? "sub" : "sup";
    const tokens = markdownParser.parseInline(match[0], {})[0]?.children ?? [];
    if (tokens.length === 3 && tokens[0].type === `${tag}_open` && tokens[2].type === `${tag}_close`) result.push({from, contentFrom: from + 1, contentTo: to - 1, to, tag});
  }
  return result;
}
function denseFixture(count: number) {
  let source = "";const expected: Pair[] = [];
  for (let index = 0; index < count; index++) {
    source += ["```md", "^fenced^ ~fenced~", "```", "", "    ^indented^ ~indented~", "",
      "`^inline^ ~inline~`", 'text <span data-example="^attribute^">tag</span>',
      '[link](https://example.test/~url~ "^title^")', "\\^escaped^", "", "<div>^block^ ~block~</div>", "", ""].join("\n");
    const fragment = `H~${index}~O X^${index + 1}^`, offset = source.length;
    for (const [mark, tag] of [["~", "sub"], ["^", "sup"]] as const) {
      const from = offset + fragment.indexOf(mark), to = offset + fragment.lastIndexOf(mark) + 1;
      expected.push({from, contentFrom: from + 1, contentTo: to - 1, to, tag});
    }
    source += fragment + "\n\n";
  }
  return {source, expected};
}

describe("script formatting exclusion cursor", () => {
  it("excludes dense code, HTML, destinations, titles and escapes while returning exact external ranges", () => {
    const {source, expected} = denseFixture(96), state = parsed(source);
    const excluded = exclusions(state);
    expect(new Set(excluded.map(range => range.name))).toEqual(new Set(excludedNames));
    for (let index = 1; index < excluded.length; index++) expect(excluded[index].from).toBeGreaterThanOrEqual(excluded[index - 1].to);
    expect(scriptFormatting(state)).toEqual(expected);
    expect(scriptFormatting(state)).toEqual(previousOverlapScan(state));
  });

  it.each([
    ["^left`code`right^", "sup"],
    ["~left`code`right~", "sub"],
    ['^left<span title="x">right^', "sup"],
    ['~left[link](target.md)right~', "sub"],
    ['^left[link](target.md "title")right^', "sup"],
    ["^left\\*right^", "sup"],
    ["^left`one`middle`two`right^", "sup"],
  ])("rejects a script match crossing an excluded boundary: %s", source => {
    const state = parsed(source);
    expect(scriptFormatting(state)).toEqual([]);expect(scriptFormatting(state)).toEqual(previousOverlapScan(state));
  });

  it.each(["`literal`^2^", "[link](url)^2^", '<span title="x">^2^</span>', "^2^`literal`", "^2^[link](url)"])("retains a real script exactly adjacent to an exclusion: %s", source => {
    const from = source.indexOf("^2^"), state = parsed(source);
    expect(scriptFormatting(state)).toEqual([{from, contentFrom: from + 1, contentTo: from + 2, to: from + 3, tag: "sup"}]);
    expect(scriptFormatting(state)).toEqual(previousOverlapScan(state));
  });

  it("keeps escaped markers and strikethrough literal while recognizing Unicode script content", () => {
    const source = "\\^escaped^\n~~strike~~\n`~code~`\nH~猫~O X^2^", state = parsed(source), sub = source.indexOf("~猫~"), sup = source.indexOf("^2^");
    expect(scriptFormatting(state)).toEqual([
      {from: sub, contentFrom: sub + 1, contentTo: sub + 2, to: sub + 3, tag: "sub"},
      {from: sup, contentFrom: sup + 1, contentTo: sup + 2, to: sup + 3, tag: "sup"},
    ]);
  });

  it("reuses the same-state cache, preserves selection semantics and scans a new document separately", () => {
    const source = "`literal ^9^` and X^2^", state = parsed(source), sup = source.indexOf("^2^");
    const original = [{from: sup, contentFrom: sup + 1, contentTo: sup + 2, to: sup + 3, tag: "sup"}];
    const first = scriptFormatting(state);expect(first).toEqual(original);expect(scriptFormatting(state)).toBe(first);
    const inside = state.update({selection: {anchor: sup + 1}}).state;
    expect(scriptFormatting(inside)).toEqual(original);expect(editorToolbarState(inside).superscript).toBe(true);
    const code = state.update({selection: {anchor: 10}}).state;
    expect(scriptFormatting(code)).toEqual(original);expect(editorToolbarState(code).superscript).toBe(false);
    const next = state.update({changes: [{from: 0, to: 1}, {from: 12, to: 13}]}).state;
    expect(next.doc.toString()).toBe("literal ^9^ and X^2^");expect(ensureSyntaxTree(next, next.doc.length, 1000)).not.toBeNull();
    expect(scriptFormatting(next)).toEqual([
      {from: 8, contentFrom: 9, contentTo: 10, to: 11, tag: "sup"},
      {from: 17, contentFrom: 18, contentTo: 19, to: 20, tag: "sup"},
    ]);
    expect(scriptFormatting(state)).toBe(first);expect(first).toEqual(original);
  });

  it("refreshes exclusions after a parse-progress transaction without changing the document", () => {
    const source = "plain paragraph\n\n".repeat(400) + "```md\n^literal^\n```\n\nX^2^";
    const state = EditorState.create({doc: source, extensions: [markdown({extensions: GFM})]});
    const earlyTree = syntaxTree(state);scriptFormatting(state);
    expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull();
    const advanced = state.update({}).state;expect(advanced.doc).toBe(state.doc);expect(syntaxTree(advanced).length).toBe(source.length);
    const from = source.lastIndexOf("^2^");expect(scriptFormatting(advanced)).toEqual([{from, contentFrom: from + 1, contentTo: from + 2, to: from + 3, tag: "sup"}]);
    expect(syntaxTree(advanced).length).toBeGreaterThanOrEqual(earlyTree.length);
  });
});
