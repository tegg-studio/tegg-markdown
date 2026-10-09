import {focusTarget} from "./renderInteraction";
import {contextFor} from "./uiContext";

/** Internal Live intent; Reader ordinary activation keeps its existing policy. */
export function isMacLiveLinkOpen(event:Pick<MouseEvent,"button"|"metaKey"|"ctrlKey"|"altKey"|"shiftKey">,owner:HTMLElement):boolean {
  if(event.button!==0||!event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return false;
  const mobile=contextFor(owner).mobile;
  if(mobile===true)return false;
  const navigator=owner.ownerDocument.defaultView?.navigator;
  return !!navigator&&/Mac/.test(navigator.platform)&&!(mobile===undefined&&navigator.maxTouchPoints>1);
}

/** Same controlled safety/fragment route, with the caller's source-backed target. */
export function activateRenderedLink(link:HTMLAnchorElement,href:string,openLink:(href:string)=>void,documentRoot:HTMLElement) {
  if(!href||/^(?:javascript|data|vbscript):/i.test(href))return;
  if(href.startsWith("#")) {
    const navigation=new CustomEvent("tegg-open-link",{bubbles:true,cancelable:true,detail:href});
    if(!link.dispatchEvent(navigation))return;
    try {
      const id=link.dataset.returnTo??decodeURIComponent(href.slice(1));
      focusTarget(Array.from(documentRoot.querySelectorAll<HTMLElement>("[id]")).find(element=>element.id===id||element.dataset.originalId===id));
    } catch { /* Malformed fragments remain inert. */ }
    return;
  }
  openLink(href);
}

/** Reader and non-text widgets retain their existing ordinary controlled route. */
export function enhanceRenderedLinks(root: HTMLElement, openLink: (href: string) => void, documentRoot: HTMLElement = root) {
  for (const link of root.querySelectorAll<HTMLAnchorElement>("a")) {
    link.rel = "noopener noreferrer";
    if (link.dataset.wikiTarget) link.setAttribute("href", "#");
    link.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const href = link.dataset.wikiTarget
        ? `wikilink:${link.dataset.wikiTarget}` : link.getAttribute("href") ?? "";
      activateRenderedLink(link, href, openLink, documentRoot);
    });
  }
}
