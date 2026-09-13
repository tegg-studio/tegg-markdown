/** @vitest-environment jsdom */
import {beforeAll, afterEach, describe, expect, it, vi} from "vitest";
import {renderMarkdown} from "./markdown";
import {TechnicalMarkdownReader} from "./reader";
import {markdownParser} from "./markdownParser";
import {inlineMathAt} from "./mathSyntax";
import {scopeIds, disposeInteractions, openObjectViewer} from "./renderInteraction";
import {renderDiagram} from "./renderKit";
import {findTechnicalBlocks} from "./profile";
import {EditorState} from "@codemirror/state";
import {EditorView} from "@codemirror/view";
import {markdown} from "@codemirror/lang-markdown";
import {GFM} from "@lezer/markdown";
import {livePreview} from "./livePreview";

beforeAll(() => {
 vi.stubGlobal("ResizeObserver", class {observe(){} unobserve(){} disconnect(){}});
 Range.prototype.getClientRects ??= () => ({length:0, item:()=>null, [Symbol.iterator]: function*(){}}) as DOMRectList;
 Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(() => {disposeInteractions(document.body); document.body.replaceChildren();});
function root() {const r=document.createElement("article");r.className="tegg-surface"; document.body.append(r);return r;}
const integral=String.raw`\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}`;

describe("extension rendering contracts", () => {
 it("protects exact TeX before Markdown sup/sub and keeps MathML", async () => {
  const r=root(); await renderMarkdown(`$$\n${integral}\n$$\n\n中文$e^{-x^2}$公式。`,r);
  expect([...r.querySelectorAll('annotation[encoding="application/x-tex"]')].map(n=>n.textContent)).toEqual([integral,'e^{-x^2}']);
  expect(r.querySelectorAll(".katex-mathml math")).toHaveLength(2);
  expect(r.querySelector(".katex-html [style]")).not.toBeNull();
 });
 it("does not interpret currency, escaped dollars, code or HTML attributes", async () => {
  const r=root(); const source=String.raw`$5 与 $10，\$x$，`+'`$x$`'+' <a title="$x$">title</a>\n\n    $x$\n';
  await renderMarkdown(source,r);expect(r.querySelectorAll('.katex')).toHaveLength(0);expect(r.textContent).toContain('$5 与 $10');
  for (const text of ['$ x$','$x $','$x$2','$$x$$','$x\ny$']) expect(inlineMathAt(text,0)).toBeNull();
 });
 it("recognizes math within quotes, callouts and lists without consuming following text", async () => {
  const r=root();await renderMarkdown('> [!NOTE]\n> $$\n> x^2\n> $$\n\n- List\n\n  $$\n  y^2\n  $$\n\nTail',r);
  expect(r.querySelectorAll('.katex')).toHaveLength(2);expect(r.textContent).toContain('Tail');
  expect(r.querySelector('blockquote .katex')).not.toBeNull(); expect(r.querySelector('li .katex')).not.toBeNull();
 });
 it("leaves unclosed math readable and preserves subsequent paragraphs", async () => {
  const r=root();await renderMarkdown('$$\nx^2\n\n## Following\n\nStill here',r);
  expect(r.querySelector('.katex')).toBeNull();expect(r.querySelector('h2')?.textContent).toBe('Following');
 });
 it("isolates macros and exposes a visible error with original TeX", async () => {
  const r=root(); await renderMarkdown(String.raw`$\gdef\foo{ok}\foo$ then $\foo$`,r);
  expect(r.querySelectorAll('[data-render-state="error"]')).toHaveLength(1);
  expect(r.querySelector('[data-render-state="error"] code')?.textContent).toBe(String.raw`\foo`);
 });
 it("keeps unsafe HTML and TeX commands inert", async () => {
  const r=root(); await renderMarkdown('<script>window.executed=true</script>\n\n<img src="x" onerror="bad()">\n\n'+String.raw`$\href{javascript:alert(1)}{bad}$`,r);
  expect(r.querySelector('script,[onerror],a[href^="javascript:"]')).toBeNull();
 });
 it("copies TeX without delimiters or KaTeX-generated text", async () => {
  const writeText=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{value:{writeText},configurable:true});
  const r=root();await renderMarkdown(`$$\n${integral}\n$$`,r);
  [...r.querySelectorAll('button')].find(b=>b.textContent==='Copy TeX')!.click();expect(writeText).toHaveBeenCalledWith(integral);
 });
 it("uses unique IDs in two instances of the same document and resolves author anchors", async () => {
  const a=root(),b=root(),source='Text[^a]\n\n[^a]: **Note**\n\n# Heading {#public}\n\n[Jump](#public)';
  await renderMarkdown(source,a); await renderMarkdown(source,b);
  const ids=[...document.querySelectorAll('[id]')].map(n=>n.id); expect(new Set(ids).size).toBe(ids.length);
  (b.querySelector('a[href$="public"]') ?? [...b.querySelectorAll('a')].find(a=>a.textContent==='Jump'))!.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
  expect(document.activeElement).toBe(b.querySelector('h1'));
 });
 it("previews complete notes, returns to the actual repeated reference and cleans up", async () => {
  const r=root(); await renderMarkdown('First[^a], second[^a].\n\n[^a]: **Note**\n\n    Second paragraph\n\n    - List\n\n    `$code$`',r);
  const refs=r.querySelectorAll<HTMLAnchorElement>('.footnote-ref a');refs[1].click();
  expect(r.querySelector('dialog strong')?.textContent).toContain('Footnote');
  expect(r.querySelector('dialog li')?.textContent).toBe('List');expect(r.querySelector('dialog code')?.textContent).toBe('$code$');
  [...r.querySelectorAll<HTMLButtonElement>('dialog button')].find(b=>b.textContent==='Full note')!.click();
  expect(document.activeElement).toBe(r.querySelector('.footnote-item'));
  r.querySelector<HTMLAnchorElement>('.footnote-backref')!.click();expect(document.activeElement).toBe(refs[1]);
  refs[0].click();await renderMarkdown('New revision',r);expect(document.querySelector('dialog')).toBeNull();
 });
 it("preserves missing note markers and exposes base navigation when enhancements disabled", async () => {
  const r=root();await renderMarkdown('Missing[^none] and note[^a].\n\n[^a]: Definition',r,{enhancedInteractions:false});
  expect(r.textContent).toContain('[^none]');r.querySelector<HTMLAnchorElement>('.footnote-ref a')!.click();
  expect(document.activeElement).toBe(r.querySelector('.footnote-item'));expect(r.querySelector('dialog')).toBeNull();
 });
 it("destroys open Reader panels", async () => {
  const r=root(),reader=new TechnicalMarkdownReader(r);await reader.render({source:'Note[^a]\n\n[^a]: Text'});
  r.querySelector<HTMLAnchorElement>('.footnote-ref a')!.click();reader.destroy();expect(document.querySelector('dialog')).toBeNull();
 });
 it("remaps SVG paint, href and accessible title/description references", () => {
  const r=root();r.innerHTML='<svg aria-labelledby="title" aria-describedby="desc"><title id="title">Title</title><desc id="desc">Description</desc><defs><clipPath id="clip"></clipPath></defs><g clip-path="url(#clip)"><use href="#clip" /></g></svg>';
  scopeIds(r);const svg=r.querySelector('svg')!;expect(svg.getAttribute('aria-labelledby')).toBe(r.querySelector('title')!.id);expect(svg.getAttribute('aria-describedby')).toBe(r.querySelector('desc')!.id);
  expect(r.querySelector('g')!.getAttribute('clip-path')).toBe(`url(#${r.querySelector('clipPath')!.id})`);
 });
 it("keeps explicit captions and never derives captions from alt/title", async () => {
  const r=root(); await renderMarkdown('<figure><img src="missing.png" alt="Alt"><figcaption>Caption</figcaption></figure>\n\n![Ordinary](x.png "Title")\n\nParagraph',r);
  expect(r.querySelectorAll('figcaption')).toHaveLength(1);expect(r.querySelector('figcaption')?.textContent).toBe('Caption');
  r.querySelector('figure img')!.dispatchEvent(new Event('error'));expect(r.querySelector('.md-image-unavailable')?.textContent).toContain('Alt');expect(r.textContent).toContain('Caption');
 });
 it("marks oversized diagrams explicitly and retains their source elsewhere", async () => {
  const r=root();await renderDiagram({kind:'diagram',engine:'mermaid',source:'中'.repeat(21846)},r);expect(r.dataset.renderState).toBe('over-budget');
 });
 it("shares context-aware block math scanning with Live Edit", () => {
  const source='- List\n\n  $$\n  x^2\n  $$\n\nEnd';const blocks=findTechnicalBlocks(source);expect(blocks).toHaveLength(1);expect(blocks[0].source).toBe('x^2');
  expect(markdownParser.render('$$x^2$$')).toContain('data-tegg-math="block"');
 });
 it("does not create overlapping Live Edit math widgets for adjacent expressions", async () => {
  const parent=root(), source='$x$+$y$\n\nend';
  const view=new EditorView({parent,state:EditorState.create({doc:source,selection:{anchor:source.length},extensions:[markdown({extensions:GFM}),livePreview]})});
  try {await vi.waitFor(()=>expect(parent.querySelectorAll('.cm-live-math-inline')).toHaveLength(2));expect(parent.textContent).toContain('+');} finally {view.destroy();}
 });
 it("opens complete Live Edit footnotes without changing source or selection", async () => {
  const parent=root(),source='First[^a] and missing[^none]\n\n[^a]: **One**\n\n    Two\n\n    - Three\n\nend';
  const view=new EditorView({parent,state:EditorState.create({doc:source,selection:{anchor:source.length},extensions:[markdown({extensions:GFM}),livePreview]})});
  try {
   await vi.waitFor(()=>expect(parent.querySelector('.cm-live-footnote-ref')).not.toBeNull());
   const selection=view.state.selection.toJSON();parent.querySelector<HTMLButtonElement>('.cm-live-footnote-ref')!.click();
   expect(parent.querySelector('dialog li')?.textContent).toBe('Three');expect(view.state.doc.toString()).toBe(source);expect(view.state.selection.toJSON()).toEqual(selection);
   expect(parent.textContent).toContain('[^none]');
  } finally {view.destroy();}
  expect(document.querySelector('dialog')).toBeNull();
 });
});
