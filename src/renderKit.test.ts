/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import {ChangeSet} from "@codemirror/state";
import {ContentDisplaySession} from "./contentDisplaySession";
import {renderMarkdown,locateRenderedSourceRange} from "./markdown";
import {inspectDocument,inspectionLocation,expandInspectionLocation} from "./documentInspection";
import {mapRenderedClipboardRange} from "./renderedSourceClipboard";
import {
  createCodeBlock,
  createHtmlPreview,
  createRenderToolbar,
  renderClassNames,
  renderMathInto,
  sanitizeRenderedHtml,
} from "./renderKit";

describe("shared RenderKit", () => {
  it("uses one sanitized HTML policy for projections", () => {
    const html = sanitizeRenderedHtml('<em>safe</em><script>alert(1)</script><img src="x" onerror="alert(2)">');

    expect(html).toContain("<em>safe</em>");
    expect(html).not.toContain("script");
    expect(html).not.toContain("onerror");
  });

  it("creates canonical highlighted code DOM with an injected action", () => {
    const action = vi.fn();
    const block = createCodeBlock(
      { kind: "code", source: "const ready = true", language: "javascript" },
      { label: "Edit Source", run: action },
    );

    expect(block.classList.contains(renderClassNames.code)).toBe(true);
    expect(block.querySelector(`.${renderClassNames.toolbar}`)?.textContent).toContain("JavaScript");
    expect(block.querySelector(".hljs-keyword")?.textContent).toBe("const");
    block.querySelector(".md-code-copy")?.dispatchEvent(new MouseEvent("click"));
    expect(action).toHaveBeenCalledOnce();
  });

  it("uses the same KaTeX primitive for inline and block math", () => {
    const inline = document.createElement("span");
    const block = document.createElement("div");

    renderMathInto(inline, { kind: "math", source: "E=mc^2", display: "inline" });
    renderMathInto(block, { kind: "math", source: "x^2", display: "block" });

    expect(inline.classList.contains(renderClassNames.mathInline)).toBe(true);
    expect(block.classList.contains(renderClassNames.mathBlock)).toBe(true);
    expect(inline.querySelector(".katex")).not.toBeNull();
    expect(block.querySelector(".katex-display")).not.toBeNull();
  });

  it("creates safe semantic HTML preview nodes", () => {
    const inline = createHtmlPreview(
      { kind: "html", source: "<strong>safe</strong>", display: "inline" },
    );
    const block = createHtmlPreview(
      { kind: "html", source: "<details open onclick='bad()'>More</details>", display: "block" },
    );

    expect(inline.classList.contains(renderClassNames.htmlInline)).toBe(true);
    expect(block.classList.contains(renderClassNames.htmlBlock)).toBe(true);
    expect(block.innerHTML).not.toContain("onclick");
  });

  it("keeps toolbar construction independent from Reader and Live Edit", () => {
    const run = vi.fn();
    const toolbar = createRenderToolbar("Formula", { label: "Edit Source", run });
    toolbar.querySelector("button")?.click();

    expect(toolbar.className).toBe(renderClassNames.toolbar);
    expect(run).toHaveBeenCalledOnce();
  });
});


describe("Reader display-session bindings",()=>{
  const details='<details><summary>Fold</summary><p>Inside <!-- secret --> after</p></details>';
  const callout='> [!note]- Callout\r\n>\r\n> Body <!-- nested --> after';
  const code='```js\r\nconst value = 1\r\n```';
  const source='Before\r\n\r\n'+details+'\r\n\r\n'+callout+'\r\n\r\n'+code;
  function owner(){const root=document.body.appendChild(document.createElement('main')),life=new AbortController();return {root,life,close:()=>{life.abort();root.remove();}};}
  function range(value:string,block:string){const normalized=value.replace(/\r\n/g,'\n'),body=block.replace(/\r\n/g,'\n'),from=normalized.indexOf(body);return {from,to:from+body.length};}
  it('paints externally expanded mounted Details and Callout without replacing nodes or changing a text selection',async()=>{
    const o=owner(),session=new ContentDisplaySession();try{
      await renderMarkdown(source,o.root,{displaySession:session,reuseKey:'document',interactionSignal:o.life.signal});
      const detail=o.root.querySelector('details')!,quote=o.root.querySelector<HTMLElement>('blockquote.callout')!,text=o.root.querySelector('p')!.firstChild!,selection=document.getSelection()!;
      const caret=document.createRange();caret.setStart(text,2);caret.collapse(true);selection.removeAllRanges();selection.addRange(caret);
      const d=range(source,details),c=range(source,callout);session.setExpanded('html-details',d.from,d.to,true);session.setExpanded('callout',c.from,c.to,true);
      expect(detail.open).toBe(true);expect(quote.dataset.calloutExpanded).toBe('true');
      expect(o.root.querySelector('details')).toBe(detail);expect(selection.anchorNode).toBe(text);expect(selection.anchorOffset).toBe(2);
    }finally{o.close();}
  });
  it('rebases unchanged retained block bindings from the current CRLF projection and shares code wrap at the new positions',async()=>{
    const o=owner(),session=new ContentDisplaySession();try{
      await renderMarkdown(source,o.root,{displaySession:session,reuseKey:'document',interactionSignal:o.life.signal});
      const detail=o.root.querySelector('details')!,quote=o.root.querySelector<HTMLElement>('blockquote.callout')!,block=o.root.querySelector<HTMLElement>('.code-block')!;
      const next=source.replace('Before','Before longer');session.map(ChangeSet.of({from:6,insert:' longer'},source.replace(/\r\n/g,'\n').length));
      await renderMarkdown(next,o.root,{displaySession:session,reuseKey:'document',interactionSignal:o.life.signal});
      expect(o.root.querySelector('details')).toBe(detail);expect(o.root.querySelector('blockquote.callout')).toBe(quote);expect(o.root.querySelector('.code-block')).toBe(block);
      const d=range(next,details),c=range(next,callout),k=range(next,code);session.setExpanded('html-details',d.from,d.to,true);session.setExpanded('callout',c.from,c.to,true);session.setExpanded('code-wrap',k.from,k.to,true);
      expect(detail.open).toBe(true);expect(quote.dataset.calloutExpanded).toBe('true');expect(block.querySelector('pre')!.style.whiteSpace).toBe('pre-wrap');expect(block.querySelector('.md-code-wrap-action')!.getAttribute('aria-pressed')).toBe('true');
      const comment=next.indexOf('<!-- secret -->'),located=locateRenderedSourceRange(o.root,{from:comment,to:comment+'<!-- secret -->'.length});expect(located).not.toBeNull();expect(located?.textContent).toContain('Inside');
      block.querySelector<HTMLButtonElement>('.md-code-wrap-action')!.click();expect(session.expanded('code-wrap',k.from,k.to,true)).toBe(false);
      expect(source).toContain('Before\r\n');expect(next).toContain('Before longer\r\n');
    }finally{o.close();}
  });
  it('follows the existing session object after an edit moves positions before the retained Reader can render again',async()=>{
    const o=owner(),session=new ContentDisplaySession();try{
      await renderMarkdown(source,o.root,{displaySession:session,reuseKey:'document',interactionSignal:o.life.signal});
      const detail=o.root.querySelector('details')!,quote=o.root.querySelector<HTMLElement>('blockquote.callout')!,codeNode=o.root.querySelector<HTMLElement>('.code-block')!;
      const next=source.replace('Before','Before longer');session.map(ChangeSet.of({from:6,insert:' longer'},source.replace(/\r\n/g,'\n').length));
      const d=range(next,details),c=range(next,callout),k=range(next,code);session.setExpanded('html-details',d.from,d.to,true);session.setExpanded('callout',c.from,c.to,true);session.setExpanded('code-wrap',k.from,k.to,true);
      expect(detail.open).toBe(true);expect(quote.dataset.calloutExpanded).toBe('true');expect(codeNode.querySelector('.md-code-wrap-action')!.getAttribute('aria-pressed')).toBe('true');
      // A later render still owns the same nodes and the newly parsed positions.
      await renderMarkdown(next,o.root,{displaySession:session,reuseKey:'document',interactionSignal:o.life.signal});expect(o.root.querySelector('details')).toBe(detail);expect(detail.open).toBe(true);
    }finally{o.close();}
  });
  it('revokes removed and destroyed projection subscriptions and source-position writers',async()=>{
    const o=owner(),session=new ContentDisplaySession();try{
      await renderMarkdown(source,o.root,{displaySession:session,reuseKey:'document',interactionSignal:o.life.signal});
      const detail=o.root.querySelector('details')!,quote=o.root.querySelector<HTMLElement>('blockquote.callout')!,fold=quote.querySelector<HTMLButtonElement>('.callout-fold')!,d=range(source,details),c=range(source,callout);
      await renderMarkdown('Replacement',o.root,{displaySession:session,reuseKey:'document',interactionSignal:o.life.signal});
      session.setExpanded('html-details',d.from,d.to,true);session.setExpanded('callout',c.from,c.to,true);
      expect(detail.open).toBe(false);expect(quote.dataset.calloutExpanded).toBe('false');fold.click();expect(session.expanded('callout',c.from,c.to,false)).toBe(true);
      await renderMarkdown(source,o.root,{displaySession:session,reuseKey:'document',interactionSignal:o.life.signal});
      const k=range(source,code),liveBlock=o.root.querySelector<HTMLElement>('.code-block')!;o.life.abort();session.setExpanded('code-wrap',k.from,k.to,true);
      expect(liveBlock.querySelector('.md-code-wrap-action')!.getAttribute('aria-pressed')).toBe('false');
    }finally{o.close();}
  });
});


describe('Reader scoped footnote source owners',()=>{
  const html='<details><summary>Folded</summary><p>Before <!-- Secret --> after</p></details>';
  const variants={single:'Use[^n]\n\n[^n]: '+html,nested:'Use[^n]\n\n[^n]: <details><summary>Outer</summary>'+html+'</details>',continuation:'Use[^n]\n\n[^n]: Intro\n\n    '+html,tab:'Use[^n]\n\n[^n]: Intro\n\n\t'+html,metadata:'---\ntitle: Fixed\n---\n\nUse[^n]\n\n[^n]: '+html};
  for(const [name,lf] of Object.entries(variants))for(const ending of ['LF','CRLF'])it('locates the actual '+name+' HTML paragraph with '+ending+' source coordinates',async()=>{
    const source=ending==='LF'?lf:lf.replace(/\n/g,'\r\n'),root=document.body.appendChild(document.createElement('main')),session=new ContentDisplaySession(),life=new AbortController();
    try{
      await renderMarkdown(source,root,{displaySession:session,interactionSignal:life.signal});
      const details=root.querySelectorAll<HTMLDetailsElement>('.footnote-body details'),paragraph=root.querySelector<HTMLElement>('.footnote-body details p')!,model=inspectDocument(source),entry=model.entries.find(item=>item.kind==='comment'&&item.label==='Secret')!;
      expect(details.length).toBeGreaterThan(0);expect(details[0].open).toBe(false);
      const actualNodes=[...details];expandInspectionLocation(inspectionLocation(model,entry,source,session,{projection:'reader'}),session);
      expect([...root.querySelectorAll('.footnote-body details')]).toEqual(actualNodes);expect([...details].every(node=>node.open)).toBe(true);
      expect(locateRenderedSourceRange(root,entry.ownerRange)).toBe(paragraph);expect(document.activeElement).toBe(paragraph);
      expect(entry.ownerRange).toEqual({from:source.indexOf('<p>'),to:source.indexOf('</p>')+4});
      const selection=document.createRange();selection.selectNode(details[0]);expect(mapRenderedClipboardRange(root,selection,source)).toEqual({from:source.indexOf('<details>'),to:source.lastIndexOf('</details>')+10});
    }finally{life.abort();root.remove();}
  });
  it('registers a real Markdown paragraph while author projection attributes cannot authorize another source owner',async()=>{
    const source='Use[^n]\r\n\r\n[^n]: Before <!-- Secret --> after\r\n\r\n    <p data-tegg-copy-key="forged" class="footnote-body">Another <!-- Other --> owner</p>',root=document.body.appendChild(document.createElement('main')),life=new AbortController();
    try{await renderMarkdown(source,root,{interactionSignal:life.signal});const model=inspectDocument(source),entry=model.entries.find(item=>item.label==='Secret')!,paragraph=root.querySelector<HTMLElement>('.footnote-body > p')!;expect(locateRenderedSourceRange(root,entry.ownerRange)).toBe(paragraph);expect(paragraph.textContent).toBe('Before  after');expect(root.querySelector('[data-tegg-copy-key]')).toBeNull();}finally{life.abort();root.remove();}
  });
});
