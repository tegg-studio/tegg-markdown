/** @vitest-environment jsdom */
import {beforeAll, afterEach, expect, it, vi} from "vitest";
const engine = vi.hoisted(() => ({initialize: vi.fn(), render: vi.fn(async () => ({svg:'<svg viewBox="0 0 1200 600"><title>Flow</title><text>Graph</text></svg>'}))}));
vi.mock("mermaid", () => ({default: engine}));
import {TechnicalMarkdownReader} from "./reader";
import {disposeInteractions} from "./renderInteraction";
beforeAll(() => {vi.stubGlobal("ResizeObserver", class {observe(){} disconnect(){}});});
afterEach(() => {disposeInteractions(document.body); document.body.replaceChildren();});
function root() {const r=document.createElement("article");r.className="tegg-surface";document.body.append(r);return r;}
function button(r:ParentNode,text:string) {return [...r.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===text)!;}
it("keeps an open viewer and operation state across actual surface appearance changes", async () => {
 const r=root(),reader=new TechnicalMarkdownReader(r);
 await reader.render({source:'```mermaid\nflowchart LR\nA-->B\n```'});
 button(r,'View diagram').click();const panel=r.querySelector('dialog')!;
 button(panel,'100%').click();button(panel,'+').click();
 const stage=panel.querySelector<HTMLElement>('.md-object-stage')!;stage.scrollLeft=180;stage.scrollTop=40;
 const details=panel.querySelector('details')!;details.open=true;
 const background=panel.querySelector('select')!;background.value='#fff';background.dispatchEvent(new Event('change'));
 button(panel,'+').focus();const focused=document.activeElement;
 const count=engine.render.mock.calls.length;r.dataset.theme='dark';r.style.setProperty('--background','#202124');
 await vi.waitFor(()=>expect(engine.render.mock.calls.length).toBeGreaterThan(count));
 await vi.waitFor(()=>expect(r.querySelector('.diagram-canvas')?.getAttribute('data-render-state')).toBe('ready'));
 expect(r.querySelector('dialog')).toBe(panel);expect(panel.querySelector('output')?.textContent).toBe('125%');
 expect(stage.scrollLeft).toBe(180);expect(stage.scrollTop).toBe(40);expect(details.open).toBe(true);expect(background.value).toBe('#fff');expect(document.activeElement).toBe(focused);
 button(panel,'Close').click();expect(document.activeElement).toBe(button(r,'View diagram'));
 reader.destroy();
});
it("opens and copies a formula inside a footnote without detaching its return target", async () => {
 const r=root(),reader=new TechnicalMarkdownReader(r);await reader.render({source:'Note[^a]\n\n[^a]: Formula $x^2$'});
 r.querySelector<HTMLAnchorElement>('.footnote-ref a')!.click();const note=r.querySelector('dialog')!;
 note.querySelector<HTMLElement>('[aria-haspopup="dialog"]')!.click();expect(r.querySelectorAll('dialog')).toHaveLength(2);
 const panels=r.querySelectorAll('dialog');let copied='';r.addEventListener('tegg-copy-text', e=>{copied=(e as CustomEvent).detail;e.preventDefault();});
 button(panels[1],'Copy TeX').click();expect(copied).toBe('x^2');button(panels[1],'Close').click();
 expect(r.querySelector('dialog')).toBe(note);expect(note.contains(document.activeElement)).toBe(true);
 reader.destroy();expect(r.querySelector('dialog')).toBeNull();
});
