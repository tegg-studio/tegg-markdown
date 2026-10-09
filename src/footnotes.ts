import {setUIText, setUILabel} from "./uiContext";
import {enhanceMathTokens} from "./renderKit";
import {copySource, action, focusTarget, openPanel, scopeIds} from "./renderInteraction";
import {enhanceRenderedLinks} from "./renderedLinks";

export function enhanceFootnotes(root: HTMLElement, openLink: (href: string) => void, enhanced = true) {
  for (const reference of root.querySelectorAll<HTMLElement>(".footnote-ref a,.footnote-ref button")) {
    const id = reference.getAttribute("href")?.slice(1);
    const note = Array.from(root.querySelectorAll<HTMLElement>(".footnote-item")).find(item => item.id === id || item.dataset.footnoteLabel===reference.dataset.footnoteLabel);
    if (!note) continue;
    if(reference.textContent!=="?")setUILabel(reference, "Footnote {value}", {value: String(reference.textContent?.replace(/[\[\]]/g, ""))});
    if(!enhanced){reference.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();focusTarget(note);});continue;}
    reference.setAttribute("aria-haspopup", "dialog"); reference.setAttribute("aria-expanded", "false");
    let active:ReturnType<typeof openPanel>|undefined;let timer:ReturnType<typeof setTimeout>|undefined;
    const show=(focus=true)=>{if(active)return;clearTimeout(timer);
      reference.setAttribute("aria-expanded", "true");
      const panel = active = openPanel(reference, reference.getAttribute("aria-label")!,false,focus);
      panel.signal.addEventListener("abort", () => {active=undefined;clearTimeout(timer);reference.setAttribute("aria-expanded", "false");});
      const content = document.createElement("div"); content.className = "md-note-content"; content.innerHTML = note.querySelector(".footnote-body")?.innerHTML ?? note.querySelector(".footnote-content")?.innerHTML ?? note.innerHTML;
      content.querySelectorAll(".footnote-navigation,.footnote-number").forEach(node => node.remove()); scopeIds(content);
      for (const math of content.querySelectorAll<HTMLElement>("[data-tex-source]")) {
        math.dataset.teggMath = math.classList.contains("md-render-math-block") ? "block" : "inline";
        math.dataset.tex = math.dataset.texSource;
      }
      enhanceMathTokens(content);
      for (const button of content.querySelectorAll<HTMLButtonElement>(".md-render-code .md-code-copy")) button.addEventListener("click", () => {void copySource(button.closest(".md-render-code")?.querySelector("code")?.textContent ?? "", button);});
      enhanceRenderedLinks(content, openLink, root);
      panel.body.append(content, action("Full note", () => {panel.close(false); focusTarget(note);}));
      panel.dialog.addEventListener('mouseenter',()=>clearTimeout(timer));panel.dialog.addEventListener('mouseleave',()=>{timer=setTimeout(()=>panel.close(false),150);});
    };
    reference.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();show();});reference.addEventListener('mouseenter',()=>show(false));reference.addEventListener('mouseleave',()=>{if(active)timer=setTimeout(()=>active?.close(false),150);});
  }
}
