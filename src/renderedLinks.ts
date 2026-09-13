import {focusTarget} from "./renderInteraction";

/** Reader and live widgets share one controlled link-activation path. */
export function enhanceRenderedLinks(root: HTMLElement, openLink: (href: string) => void, documentRoot: HTMLElement = root) {
  for (const link of root.querySelectorAll<HTMLAnchorElement>("a")) {
    link.rel = "noopener noreferrer";
    if (link.dataset.wikiTarget) link.setAttribute("href", "#");
    link.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const href = link.dataset.wikiTarget
        ? `wikilink:${link.dataset.wikiTarget}` : link.getAttribute("href") ?? "";
      if (!href || /^(?:javascript|data|vbscript):/i.test(href)) return;
      if (href.startsWith("#")) {
        const navigation = new CustomEvent("tegg-open-link", {bubbles: true, cancelable: true, detail: href});
        if (!link.dispatchEvent(navigation)) return;
        try {
          const id = link.dataset.returnTo ?? decodeURIComponent(href.slice(1));
          focusTarget(Array.from(documentRoot.querySelectorAll<HTMLElement>("[id]")).find(element => element.id === id || element.dataset.originalId === id));
        } catch { /* Malformed fragments remain inert. */ }
        return;
      }
      openLink(href);
    });
  }
}
