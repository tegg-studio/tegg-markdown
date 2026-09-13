import {enhanceMathTokens} from "./renderKit";
import {copySource, action, focusTarget, openPanel, scopeIds} from "./renderInteraction";
import {enhanceRenderedLinks} from "./renderedLinks";

export function enhanceFootnotes(root: HTMLElement, openLink: (href: string) => void, enhanced = true) {
  for (const reference of root.querySelectorAll<HTMLAnchorElement>(".footnote-ref a")) {
    const id = reference.getAttribute("href")?.slice(1);
    const note = Array.from(root.querySelectorAll<HTMLElement>(".footnote-item")).find(item => item.id === id);
    if (!note) continue;
    reference.setAttribute("aria-label", `Footnote ${reference.textContent?.replace(/[\[\]]/g, "")}`);
    const backlinks = note.querySelectorAll<HTMLAnchorElement>(".footnote-backref");
    for (const back of backlinks) {
      back.setAttribute("aria-label", "Return to reference");
    }
    if (!enhanced) continue;
    reference.setAttribute("aria-haspopup", "dialog"); reference.setAttribute("aria-expanded", "false");
    reference.addEventListener("click", event => {
      event.preventDefault(); event.stopImmediatePropagation();
      reference.setAttribute("aria-expanded", "true");
      const panel = openPanel(reference, reference.getAttribute("aria-label")!);
      panel.signal.addEventListener("abort", () => reference.setAttribute("aria-expanded", "false"));
      const content = document.createElement("div"); content.className = "md-note-content"; content.innerHTML = note.innerHTML;
      content.querySelectorAll(".footnote-backref").forEach(node => node.remove()); scopeIds(content);
      for (const math of content.querySelectorAll<HTMLElement>("[data-tex-source]")) {
        math.dataset.teggMath = math.classList.contains("md-render-math-block") ? "block" : "inline";
        math.dataset.tex = math.dataset.texSource;
      }
      enhanceMathTokens(content);
      for (const button of content.querySelectorAll<HTMLButtonElement>(".md-render-code button")) button.addEventListener("click", () => {void copySource(button.closest(".md-render-code")?.querySelector("code")?.textContent ?? "", button);});
      enhanceRenderedLinks(content, openLink, root);
      panel.body.append(content, action("Full note", () => {panel.close(false); focusTarget(note);}));
      // A repeated citation must return to the citation which opened this panel.
      for (const back of backlinks) back.dataset.returnTo = reference.id;
    });
  }
}
