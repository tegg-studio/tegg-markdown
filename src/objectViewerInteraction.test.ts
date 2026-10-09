/** @vitest-environment jsdom */
import {it,expect,vi,beforeAll} from "vitest";
import {enhanceFigures} from "./renderInteraction";
import {sourcePreservingHtmlDraft} from "./richHtmlDraft";
import {renderMarkdown} from "./markdown";
beforeAll(()=>{vi.stubGlobal("ResizeObserver",class {observe(){}disconnect(){}});vi.stubGlobal("requestAnimationFrame",()=>1);});
it("an explicit image viewer button never enters source when adjacent safe HTML text changes",()=>{
 const source="<figure data-exact='yes'><img src='image.png' alt='Authored &amp; alt' width='80'><figcaption>Original text</figcaption></figure>";
 const root=document.createElement("div");root.innerHTML=source;enhanceFigures(root);expect(root.querySelectorAll('.md-image-view-actions')).toHaveLength(1);const draft=sourcePreservingHtmlDraft(root,source);const text=root.querySelector('figcaption')!.firstChild!;text.textContent="Changed text";draft.markChanged();expect(draft.serialize()).toBe(source.replace('Original text','Changed text'));
});

it("a noninteractive Reader retains image content and never gains a viewer action",async()=>{
 const root=document.createElement("div");await renderMarkdown("![Authored alt](image.png)",root,{enhancedInteractions:false});expect(root.querySelector("img")?.getAttribute("alt")).toBe("Authored alt");expect(root.querySelector(".md-image-view-actions")).toBeNull();expect(root.querySelector('[aria-haspopup="dialog"]')).toBeNull();
});

it("the proposed action belongs to a standalone image and never overlays inline images or emoji",()=>{
 const root=document.createElement("div");root.innerHTML='<p>Text <img src="emoji.png" alt="emoji"> after</p><p><img src="standalone.png" alt="figure"></p><figure><img src="captioned.png"><figcaption>Caption</figcaption></figure>';enhanceFigures(root);expect(root.children[0].querySelector(".md-image-view-actions")).toBeNull();expect(root.children[1].querySelector(".md-image-view-actions")).not.toBeNull();expect(root.children[2].querySelector(".md-image-view-actions")).not.toBeNull();
});

it("generated image failures never become source while authored same-class content remains exact",()=>{
 const source='<p>Original <img src="missing.png" alt="old"> text <span class="md-image-unavailable">Author content</span></p>';const root=document.createElement("div");root.innerHTML=source;enhanceFigures(root);root.querySelector("img")!.dispatchEvent(new Event("error"));expect(root.querySelector('[data-tegg-editor-projection="true"]')?.getAttribute("contenteditable")).toBe("false");const draft=sourcePreservingHtmlDraft(root,source);root.querySelector("p")!.firstChild!.textContent="Changed ";draft.markChanged();expect(draft.serialize()).toBe(source.replace("Original ","Changed "));
});
