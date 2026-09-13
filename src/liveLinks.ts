import {setUIText, setUILabel} from "./uiContext";
import {ensureSyntaxTree, syntaxTree} from "@codemirror/language";
import {EditorView, ViewPlugin} from "@codemirror/view";
import {markdownParser} from "./markdownParser";
import {analyzeSource} from "./sourceAnalysis";
import {parseWikiLink} from "./profile";
import {dispatchSourcePatches} from "./editorPatches";

type Link = {from: number; to: number; raw: string; label: string; target: string; wiki: boolean; labelSource?: string; title?: string};
export function linkAt(view: EditorView, position: number): Link | null {
  const source = view.state.doc.toString();
  const tree = ensureSyntaxTree(view.state, position, 50) ?? syntaxTree(view.state);
  for (let node = tree.resolveInner(position, 1); node; node = node.parent!) {
    if (["FencedCode", "CodeBlock", "InlineCode", "Image"].includes(node.name)) return null;
  }
  const wiki = analyzeSource(view.state.doc).wikiLinks.find(item => position >= item.from && position <= item.to);
  if (wiki) {
    const raw = source.slice(wiki.from, wiki.to);
    const parsed = parseWikiLink(raw.slice(2, -2));
    return {...wiki, raw, label: parsed.label || parsed.target, target: parsed.target, wiki: true};
  }
  for (let node = tree.resolveInner(position, 1); node; node = node.parent!) {
    if (!["Link", "Autolink", "URL"].includes(node.name)) continue;
    if (node.name === "URL" && node.parent?.name === "Link") continue;
    if (node.parent?.name === "Image") return null;
    const raw = source.slice(node.from, node.to);
    const env = {};
    markdownParser.parse(source, env);
    const children = markdownParser.parseInline(raw, env)[0]?.children ?? [];
    const opening = children.find(token => token.type === "link_open");
    const target = opening?.attrGet("href");
    if (!target) continue;
    const label = children.filter(token => token.nesting === 0 && token.type !== "html_inline").map(token => token.content).join("");
    let labelSource: string | undefined;
    if (node.name === "Link") {
      for (let child = node.firstChild?.nextSibling; child; child = child.nextSibling) {
        if (child.name === "LinkMark" && source[child.from] === "]") { labelSource = source.slice(node.from + 1, child.from); break; }
      }
    }
    return {from: node.from, to: node.to, raw, label, target, wiki: false, labelSource, title: opening?.attrGet("title") ?? undefined};
  }
  return null;
}

export function linkActionLabel(target: string, wiki = false): string {
  if (/^https?:/i.test(target)) return "Open in browser";
  if (/^mailto:/i.test(target)) return "Open in mail app";
  if (target.startsWith("#")) return "Jump to heading";
  if (wiki) return "Open note";
  let path: string;
  try {
    const url = new URL(target, "file:///document.md");
    if (url.protocol !== "file:") return "Unsupported link";
    path = decodeURIComponent(url.pathname);
  } catch { return "Open link"; }
  if (/\.(md|markdown|mdown|mkdn)$/i.test(path)) return "Open note";
  // Keep these document types aligned with AppModel.openLink's default-app routing.
  if (/\.(pdf|txt|rtf|doc|docx|xls|xlsx|ppt|pptx|pages|numbers|key|png|jpg|jpeg|gif|webp|heic|svg|mp3|m4a|wav|mp4|mov)$/i.test(path)) return "Open file";
  return "Show in Finder";
}

export function linkReplacement(link: Link, label: string, target: string) {
  if (!target.trim() || /[\r\n<>]/.test(target) || /^(?:javascript|data|vbscript):/i.test(target.trim())) throw new Error("Enter a supported link destination.");
  if (/[\r\n]/.test(label)) throw new Error("Display text must be on one line.");
  if (link.wiki) {
    if (/[\[\]|]/.test(target) || /[\[\]|]/.test(label)) throw new Error("Wiki links cannot contain brackets or a vertical bar.");
    return `[[${target}${label === target ? "" : "|" + label}]]`;
  }
  const text = label === link.label && link.labelSource !== undefined ? link.labelSource : label.replace(/[\\\[\]]/g, "\\$&");
  const title = link.title === undefined ? "" : " " + JSON.stringify(link.title);
  return `[${text}](<${target.trim()}>${title})`;
}

export function linkPopoverPlacement(anchor: {left: number; top: number; bottom: number}, width: number, height: number, viewport: {width: number; height: number}, preferredSide?: "above" | "below") {
  const margin = 8, gap = 8;
  const below = Math.max(0, viewport.height - margin - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - margin);
  const useBelow = preferredSide === "below" && height <= below ? true : preferredSide === "above" && height <= above ? false : height <= below || below >= above;
  const maxHeight = useBelow ? below : above;
  return {
    left: Math.max(margin, Math.min(anchor.left, viewport.width - width - margin)),
    top: useBelow ? anchor.bottom + gap : anchor.top - gap - Math.min(height, maxHeight),
    maxHeight,
    side: useBelow ? "below" as const : "above" as const,
  };
}

const controllers = new WeakMap<EditorView, LinkController>();
export function editCurrentLink(view: EditorView) {
  const link = linkAt(view, view.state.selection.main.head);
  if (!link) return false;
  controllers.get(view)?.show(link, true);
  return controllers.has(view);
}
class LinkController {
  panel: HTMLDivElement | null = null;
  editing = false;
  timer = 0;
  activeLink: Link | null = null;
  cancelClose() { clearTimeout(this.timer); this.timer = 0; }
  scheduleClose() {
    this.cancelClose();
    if (!this.editing) this.timer = window.setTimeout(() => {
      if (!this.panel?.contains(document.activeElement)) this.close();
    }, 350);
  }
  over(event: MouseEvent) {
    const link = this.target(event);
    if (!link || this.editing) return;
    this.cancelClose();
    if (this.activeLink?.from !== link.from || this.activeLink?.to !== link.to) this.show(link);
  }
  out(event: MouseEvent) {
    const next = event.relatedTarget;
    if (next instanceof Node && this.panel?.contains(next)) { this.cancelClose(); return; }
    const element = next instanceof Element ? next.closest(".cm-live-link, .cm-live-wikilink") : null;
    if (element && element === (event.target as Element).closest(".cm-live-link, .cm-live-wikilink")) return;
    this.scheduleClose();
  }
  down: {x: number; y: number} | null = null;
  constructor(readonly view: EditorView) { controllers.set(view, this); document.addEventListener("mousedown", this.outside); }
  outside = (event: MouseEvent) => { if (this.panel && !this.panel.contains(event.target as Node)) this.close(); };
  close() { this.cancelClose(); this.panel?.remove(); this.panel = null; this.activeLink = null; this.editing = false; }
  target(event: MouseEvent) {
    const element = (event.target as Element).closest<HTMLElement>(".cm-live-link, .cm-live-wikilink");
    if (!element) return null;
    try { return linkAt(this.view, Math.min(this.view.state.doc.length, this.view.posAtDOM(element) + 1)); } catch { return null; }
  }
  open(link: Link) {
    if (/^(?:javascript|data|vbscript):/i.test(link.target)) return;
    this.view.dom.dispatchEvent(new CustomEvent("tegg-open-link", {bubbles: true, cancelable: true,
      detail: link.wiki ? `wikilink:${encodeURIComponent(link.target)}` : link.target}));
    this.close();
  }
  show(link: Link, editing = false) {
    const previous = editing && this.activeLink?.from === link.from && this.panel
      ? {left: parseFloat(this.panel.style.left), side: this.panel.dataset.side as "above" | "below"} : undefined;
    this.close(); this.editing = editing; this.activeLink = link;
    const panel = this.panel = document.createElement("div");
    panel.className = "md-link-popover" + (editing ? " md-link-editor" : "");
    panel.setAttribute("role", editing ? "dialog" : "group");
    setUILabel(panel,editing ? "Edit link" : "Link actions");
    panel.addEventListener("mouseenter", () => this.cancelClose());
    panel.addEventListener("mouseleave", () => this.scheduleClose());
    panel.addEventListener("focusin", () => this.cancelClose());
    panel.addEventListener("focusout", () => this.scheduleClose());
    panel.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Escape") { this.close(); this.view.focus(); } });
    const action = (text: string, run: () => void) => {
      const button = document.createElement("button"); button.type = "button"; setUIText(button,text);
      button.addEventListener("click", run); return button;
    };
    let readableTarget = link.target;
    try { readableTarget = decodeURI(link.target); } catch { /* Keep malformed escape sequences readable. */ }
    if (!editing) {
      const target = action("", () => this.open(link));
      target.className = "md-link-destination";
      target.title = readableTarget;
      setUILabel(target,"Open {value}",{value:readableTarget});
      const text = document.createElement("span"); text.className = "md-link-destination-text"; text.textContent = readableTarget;
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 16 16"); icon.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M9 2.5h4.5V7M13 3L7 9M6 3H3a.5.5 0 0 0-.5.5v9a1 1 0 0 0 1 1h9a.5.5 0 0 0 .5-.5v-3");
      icon.append(path); target.append(text, icon);
      const footer = document.createElement("div"); footer.className = "md-link-footer";
      const hint = document.createElement("span"); hint.className = "md-link-hint";
      hint.textContent = linkActionLabel(link.target, link.wiki);
      const edit = action("Edit link", () => this.show(link, true)); edit.className = "md-link-text-action";
      footer.append(hint, edit); panel.append(target, footer);
    } else {
      const form = document.createElement("form");
      const input = (name: string, value: string) => {
        const label = document.createElement("label"); setUIText(label,name);
        const field = document.createElement("input"); field.value = value; field.spellcheck = false; field.autocomplete = "off"; setUILabel(field,name);
        label.append(field); form.append(label); return field;
      };
      const title = input("Display text", link.label), target = input("Link destination", readableTarget);
      const error = document.createElement("div"); error.setAttribute("role", "alert");
      const save = (remove = false) => {
        try {
          if (this.view.state.sliceDoc(link.from, link.to) !== link.raw) throw new Error("The link changed. Reopen it to edit.");
          if (!remove && title.value === link.label && target.value === readableTarget) { this.close(); this.view.focus(); return; }
          const insert = remove ? title.value.replace(/[\\\[\]*_`]/g, "\\$&") : linkReplacement(link, title.value, target.value);
          this.close();
          dispatchSourcePatches(this.view, [{from: link.from, to: link.to, expected: link.raw, insert}], {isolateHistory: true});
          this.view.focus();
        } catch (failure) { error.textContent = (failure as Error).message; }
      };
      const buttons = document.createElement("div"); buttons.className = "md-link-footer md-link-editor-actions";
      const remove = action("Remove link", () => save(true)); remove.className = "md-link-text-action md-link-remove";
      const cancel = action("Cancel", () => { this.close(); this.view.focus(); });
      const submit = action("Save", () => {}); submit.type = "submit"; submit.className = "md-link-save";
      buttons.append(remove, cancel, submit);
      form.append(error, buttons); panel.append(form);
      form.addEventListener("submit", event => { event.preventDefault(); save(); });
      requestAnimationFrame(() => { title.focus(); title.select(); });
    }
    (this.view.dom.closest(".tegg-sdk-frame") ?? document.body).append(panel);
    const coords = this.view.coordsAtPos(link.from);
    const position = linkPopoverPlacement(coords ?? {left: 16, top: 30, bottom: 50}, panel.offsetWidth, panel.offsetHeight,
      {width: window.innerWidth, height: window.innerHeight}, previous?.side);
    panel.dataset.side = position.side;
    panel.style.left = `${previous ? Math.max(8, Math.min(previous.left, window.innerWidth - panel.offsetWidth - 8)) : position.left}px`;
    panel.style.top = `${position.top}px`;
    panel.style.maxHeight = `${position.maxHeight}px`;
    panel.style.overflowY = "auto";
  }
  update(update: import("@codemirror/view").ViewUpdate) { if (update.docChanged) this.close(); }
  destroy() { this.close(); document.removeEventListener("mousedown", this.outside); controllers.delete(this.view); }
}
export const liveLinks = ViewPlugin.fromClass(LinkController, {
  eventHandlers: {
    mousedown(event) { this.down = {x: event.clientX, y: event.clientY}; return false; },
    click(event) {
      if (event.button !== 0 || !this.down || Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 4 || !this.view.state.selection.main.empty) return false;
      const link = this.target(event); if (!link) return false;
      event.preventDefault(); this.open(link); return true;
    },
    mouseover(event) { this.over(event); return false; },
    mouseout(event) { this.out(event); return false; },
    contextmenu(event) { const link = this.target(event); if (!link) return false; event.preventDefault(); this.show(link); return true; },
    scroll() { if (!this.editing) this.close(); return false; },
  },
});
