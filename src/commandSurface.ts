import {ViewPlugin, type ViewUpdate, type EditorView} from "@codemirror/view";
import type {Extension} from "@codemirror/state";
import {ensureSyntaxTree, syntaxTree} from "@codemirror/language";
import type {SyntaxNode} from "@lezer/common";
import {blockContext} from "./blockContext";
import {objectAt, sameEditingIdentity, type EditingController, type EditingIdentity, type ObjectKind} from "./editingController";
import {getSupportedCommands} from "./commandRegistry";
import {dispatchSourcePatches} from "./editorPatches";
import {planStructuralInsert} from "./structuralCommands";
import {focusCodeAtSelection} from "./codeEditing";
import {message, setUIText, setUILabel} from "./uiContext";

type Item = {label: string; command: string; icon: string; markdown?: string; kind?: "code" | "block"};
const insertItems: readonly Item[] = [
  {label: "Heading 1", command: "heading1", icon: "H1"}, {label: "Heading 2", command: "heading2", icon: "H2"},
  {label: "Heading 3", command: "heading3", icon: "H3"}, {label: "Heading 4", command: "heading4", icon: "H4"},
  {label: "Heading 5", command: "heading5", icon: "H5"}, {label: "Heading 6", command: "heading6", icon: "H6"},
  {label: "Bullet list", command: "list", icon: "bullet"}, {label: "Numbered list", command: "orderedList", icon: "ordered"},
  {label: "Task list", command: "task", icon: "task"}, {label: "Quote", command: "quote", icon: "quote"},
  {label: "Code block", command: "codeBlock", icon: "code", markdown: "```text\n\n```", kind: "code"},
  {label: "Table", command: "table", icon: "table", markdown: "| Column 1 | Column 2 |\n| --- | --- |\n|  |  |"},
  {label: "Divider", command: "divider", icon: "divider", markdown: "---"},
  {label: "Math block", command: "mathBlock", icon: "math", markdown: "$$\n\n$$"},
  {label: "Mermaid", command: "mermaid", icon: "diagram", markdown: "```mermaid\n\n```", kind: "code"},
  {label: "Graphviz", command: "graphviz", icon: "diagram", markdown: "```graphviz\n\n```", kind: "code"},
];
const blockItems: readonly Item[] = [
  {label: "Paragraph", command: "heading0", icon: "T"},
  ...insertItems.filter(item => ["heading1", "heading2", "heading3", "heading4", "heading5", "heading6", "list", "orderedList", "task", "quote"].includes(item.command)),
  {label: "Move up", command: "moveBlockUp", icon: "up"},
  {label: "Move down", command: "moveBlockDown", icon: "down"},
];
const iconPaths: Readonly<Record<string, string>> = {
  bullet: "M2.5 4h.01M6 4h7M2.5 8h.01M6 8h7M2.5 12h.01M6 12h7",
  ordered: "M2 3.5h2v3M2 8.5h2l-2 3h2M7 4h6M7 8h6M7 12h6",
  task: "M2.5 3.5h3v3h-3zM3 5l.8.8 1.3-1.5M8 5h5M2.5 9.5h3v3h-3zM8 11h5",
  quote: "M3 5h4v4H4.5L3 12M9 5h4v4h-2.5L9 12",
  code: "M5.5 4L2 8l3.5 4M10.5 4L14 8l-3.5 4M9.5 2L6.5 14",
  table: "M2 2.5h12v11H2zM2 6.2h12M2 10h12M7 2.5v11",
  divider: "M2 8h12",
  math: "M12.5 3H4l4 5-4 5h8.5",
  diagram: "M2 2.5h4v3H2zM10 10.5h4v3h-4zM6 4h3v4h3v2.5",
  up: "M8 13V3M4 7l4-4 4 4",
  down: "M8 3v10M4 9l4 4 4-4",
};
function iconElement(icon: string) {
  if (!iconPaths[icon]) {
    const text = document.createElement("span"); text.textContent = icon;
    text.className = "tegg-command-type-glyph"; text.setAttribute("aria-hidden", "true"); return text;
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("aria-hidden", "true");
  svg.classList.add("tegg-command-glyph");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", iconPaths[icon]); svg.append(path); return svg;
}
type Menu = {kind: "slash" | "insert" | "block"; from: number; to: number; query: string; target: number; identity: EditingIdentity};

class Surface {
  private plus = document.createElement("button");
  private more = document.createElement("button");
  private list = document.createElement("div");
  private menu: Menu | null = null;
  private dismissed: {from: number; query: string} | null = null;
  private items: Item[] = [];
  private active = 0;
  constructor(readonly view: EditorView, readonly controller: EditingController) {
    this.plus.type = this.more.type = "button";
    this.plus.className = "tegg-command-plus"; this.more.className = "tegg-command-more";
    this.plus.textContent = "+"; this.more.append(iconElement("T"));
    this.list.className = "tegg-command-menu"; this.list.setAttribute("role", "listbox");
    for (const button of [this.plus, this.more]) button.addEventListener("mousedown", event => event.preventDefault());
    this.plus.addEventListener("click", event => {event.stopPropagation(); this.open("insert");});
    this.more.addEventListener("click", event => {event.stopPropagation(); this.open("block");});
    this.view.dom.append(this.plus, this.more, this.list);
    setUILabel(this.plus, "Insert block"); setUILabel(this.more, "Block actions"); setUILabel(this.list, "Block commands");
    this.view.dom.addEventListener("keydown", this.key, true);
    document.addEventListener("mousedown", this.outside, true);
    document.addEventListener("focusin", this.focusCheck, true);
    this.sync();
  }
  destroy() {this.view.dom.removeEventListener("keydown", this.key, true); document.removeEventListener("mousedown", this.outside, true); document.removeEventListener("focusin", this.focusCheck, true); this.plus.remove(); this.more.remove(); this.list.remove();}
  update(update: ViewUpdate) {
    if (update.docChanged && this.menu?.kind !== "slash") this.close();
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) this.sync();
  }
  private available() {
    return this.controller.identity.mode === "live" && !this.controller.unavailableReason &&
      this.controller.session?.status !== "editing" && this.controller.session?.status !== "stale" && !this.view.composing;
  }
  private safeTarget(position: number) {
    if (blockContext(this.view.state, position).protectedBlock) return false;
    const kind = objectAt(this.view.state, position, this.controller.identity.profile)?.kind;
    return !kind || !["code", "math", "mermaid", "graphviz", "table", "metadata", "footnote"].includes(kind);
  }
  private ownsFocus() {
    const active = document.activeElement;
    return this.view.hasFocus || active === this.plus || active === this.more || this.list.contains(active);
  }
  private leadingPosition(position: number) {
    const state = this.view.state;
    const tree = ensureSyntaxTree(state, position, 100) ?? syntaxTree(state);
    const nodes: SyntaxNode[] = [];
    for (let node: SyntaxNode | null = tree.resolveInner(position, -1); node; node = node.parent) nodes.push(node);
    const block = nodes.find(node => node.name === "ListItem") ??
      nodes.find(node => node.name === "Paragraph" || /^(?:ATXHeading[1-6]|SetextHeading[12])$/.test(node.name)) ??
      nodes.find(node => node.parent?.name === "Document");
    const first = state.doc.lineAt(block?.from ?? position);
    return blockContext(state, first.to).contentFrom;
  }
  private currentStyles(position: number) {
    const state = this.view.state;
    const context = blockContext(state, position);
    const tree = ensureSyntaxTree(state, context.lineTo, 100) ?? syntaxTree(state);
    const nodes: SyntaxNode[] = [];
    for (let node: SyntaxNode | null = tree.resolveInner(Math.min(position, context.lineTo), -1); node; node = node.parent) nodes.push(node);
    const heading = nodes.map(node => node.name.match(/^(?:ATX|Setext)Heading([1-6])$/)?.[1]).find(Boolean);
    const paragraph = heading ? {command: `heading${heading}`, icon: `H${heading}`, label: `Heading ${heading}`}
      : {command: "heading0", icon: "T", label: "Paragraph"};
    const item = nodes.find(node => node.name === "ListItem");
    const mark = item?.getChild("ListMark");
    let list: {command: string; icon: string; label: string} | null = null;
    if (mark) {
      const marker = state.sliceDoc(mark.from, mark.to);
      const task = /^\[[ xX]\]/.test(state.sliceDoc(mark.to, state.doc.lineAt(mark.to).to).trimStart());
      list = task ? {command: "task", icon: "task", label: "Task list"}
        : /^\d/.test(marker) ? {command: "orderedList", icon: "ordered", label: "Numbered list"}
        : {command: "list", icon: "bullet", label: "Bullet list"};
    }
    return {paragraph, list, quoted: context.containers.includes("quote")};
  }
  private currentType(position: number) {
    const styles = this.currentStyles(position);
    return styles.paragraph.command !== "heading0" ? styles.paragraph
      : styles.list ?? (styles.quoted ? {command: "quote", icon: "quote", label: "Quote"} : styles.paragraph);
  }
  private position() {
    const at = this.menu?.target ?? this.view.state.selection.main.anchor;
    const leadingAt = this.leadingPosition(at);
    const lineAt = blockContext(this.view.state, at).contentFrom;
    this.view.requestMeasure({
      read: view => {
        const caret = view.coordsAtPos(at), host = view.dom.getBoundingClientRect();
        const leading = view.coordsAtPos(leadingAt) ?? view.coordsAtPos(lineAt) ?? caret;
        const menu = this.list.getBoundingClientRect();
        const menuHeight = Math.min(420, this.list.scrollHeight || menu.height || this.items.length * 30 + 48);
        return caret && leading ? {caret, leading, host, menu, menuHeight, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight} : null;
      },
      write: geometry => {
        if (!geometry) return;
        const {caret, leading, host, menu, menuHeight, viewportWidth, viewportHeight} = geometry;
        const gutterLeft = leading.left - host.left - 24;
        for (const button of [this.plus, this.more]) {
          button.style.left = `${gutterLeft}px`;
          button.style.top = `${Math.max(0, leading.top - host.top)}px`;
        }
        const anchor = this.menu?.kind === "slash" ? caret : leading;
        // A narrow host can have a tall toolbar above the editor. Keep the
        // menu inside the editor's visible viewport, not beneath that toolbar.
        const visibleTop = Math.max(8, host.top + 4);
        const visibleBottom = Math.min(viewportHeight - 8, host.bottom - 4);
        const below = Math.max(0, visibleBottom - (anchor.bottom + 6));
        const above = Math.max(0, anchor.top - 6 - visibleTop);
        const flip = below < menuHeight && above > below;
        const height = Math.max(0, Math.min(menuHeight, flip ? above : below));
        this.list.style.maxHeight = `${height}px`;
        const top = flip ? anchor.top - 6 - height : anchor.bottom + 6;
        this.list.style.top = `${Math.max(visibleTop, Math.min(top, visibleBottom - height)) - host.top}px`;
        const width = menu.width || 194;
        this.list.style.left = `${Math.max(8, Math.min(anchor.left, viewportWidth - width - 8)) - host.left}px`;
      },
    });
  }
  private sync() {
    const selection = this.view.state.selection.main;
    if (this.menu && !sameEditingIdentity(this.menu.identity, this.controller.identity)) this.close();
    if (!this.available() || !this.ownsFocus() || !selection.empty || !this.safeTarget(selection.anchor)) {this.close(); this.plus.hidden = this.more.hidden = true; return;}
    const context = blockContext(this.view.state, selection.anchor);
    const content = this.view.state.sliceDoc(context.contentFrom, context.lineTo);
    const query = content.match(/^\/([^\s]*)$/);
    const atEnd = selection.anchor === context.lineTo;
    if (query && atEnd && (this.dismissed?.from !== context.contentFrom || this.dismissed.query !== query[1])) {
      if (this.menu?.kind !== "slash" || this.menu.query !== query[1]) this.active = 0;
      this.menu = {kind: "slash", from: context.contentFrom, to: context.lineTo, query: query[1], target: selection.anchor, identity: this.controller.identity};
      this.render();
    } else if (this.menu?.kind === "slash") this.close();
    if (!query) this.dismissed = null;
    if (this.menu && selection.anchor !== this.menu.target) this.close();
    this.plus.hidden = content.length !== 0 || !atEnd;
    this.more.hidden = content.length === 0;
    const current = this.currentType(selection.anchor);
    this.more.replaceChildren(iconElement(current.icon));
    this.more.dataset.blockType = current.command;
    setUILabel(this.more, "Block actions for {value}", {value: message(this.more, current.label)});
    this.position();
  }
  private open(kind: "insert" | "block") {
    const selection = this.view.state.selection.main;
    const trigger = kind === "insert" ? this.plus : this.more;
    if (!this.available() || !(this.view.hasFocus || document.activeElement === trigger) || !selection.empty) return;
    if (this.menu?.kind === kind) {this.close(); this.sync(); return;}
    const target = selection.anchor;
    if (!this.safeTarget(target)) return;
    const context = blockContext(this.view.state, target);
    const styles = this.currentStyles(target);
    const initial = styles.paragraph.command !== "heading0" ? styles.paragraph.command : styles.list?.command ?? "heading0";
    this.active = kind === "block" ? Math.max(0, blockItems.findIndex(item => item.command === initial)) : 0;
    this.menu = {kind, from: context.contentFrom, to: context.lineTo, query: "", target, identity: this.controller.identity};
    this.render();
  }
  private render() {
    if (!this.menu) return;
    const supported = new Set(getSupportedCommands(this.controller.identity.profile ?? "tegg"));
    const styles = this.menu.kind === "block" ? this.currentStyles(this.menu.target) : null;
    const choices = this.menu.kind === "block" ? blockItems.filter(item => item.command !== "quote" || !styles?.quoted) : insertItems;
    const query = this.menu.query.toLocaleLowerCase();
    this.items = choices.filter(item => supported.has(item.command) &&
      (item.label.toLocaleLowerCase().includes(query) || message(this.list, item.label).toLocaleLowerCase().includes(query)));
    this.active = Math.min(this.active, Math.max(0, this.items.length - 1));
    this.list.replaceChildren();
    let group = "";
    for (const [index, item] of this.items.entries()) {
      if (this.menu.kind === "block") {
        const nextGroup = item.command.startsWith("moveBlock") ? "Move block"
          : item.command === "quote" ? "Wrap in quote"
          : item.command === "list" || item.command === "orderedList" || item.command === "task" ? "List style"
          : "Paragraph style";
        if (nextGroup !== group) {
          const heading = document.createElement("div");
          heading.className = "tegg-command-group"; heading.setAttribute("role", "presentation");
          this.list.append(heading); setUIText(heading, nextGroup); group = nextGroup;
        }
      }
      const option = document.createElement("button"); option.type = "button";
      option.className = "tegg-command-option"; option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === this.active));
      const isCurrent = styles?.paragraph.command === item.command || styles?.list?.command === item.command;
      option.dataset.current = String(isCurrent);
      if (isCurrent) option.setAttribute("aria-current", "true");
      const icon = document.createElement("span"); icon.className = "tegg-command-option-icon";
      icon.append(iconElement(item.icon)); icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span"); label.className = "tegg-command-option-label";
      option.append(icon, label);
      if (isCurrent) {
        const check = document.createElement("span"); check.className = "tegg-command-option-current";
        check.textContent = "✓"; check.setAttribute("aria-hidden", "true"); option.append(check);
      }
      option.addEventListener("mousedown", event => event.preventDefault());
      option.addEventListener("click", event => {event.stopPropagation(); this.apply(index);});
      this.list.append(option);
      setUIText(label, this.menu.kind === "block" && item.command === "quote"
        ? styles?.list ? "Wrap list in quote" : "Wrap in quote" : item.label);
    }
    if (!this.items.length) {const empty = document.createElement("span"); this.list.append(empty); setUIText(empty, "No commands");}
    this.list.hidden = false;
    this.position();
  }
  private apply(index: number) {
    const menu = this.menu, item = this.items[index];
    if (!menu || !item || !sameEditingIdentity(menu.identity, this.controller.identity) ||
      !this.available() || !this.view.state.selection.main.empty ||
      this.view.state.selection.main.anchor !== menu.target || !this.safeTarget(menu.target)) {this.close(); return;}
    const state = this.view.state;
    if (menu.kind === "block") {
      const styles = this.currentStyles(menu.target);
      if (item.command === styles.paragraph.command || item.command === styles.list?.command) {this.close(); this.view.focus(); return;}
      this.view.dispatch({selection: {anchor: menu.target}});
      this.controller.command(item.command);
    } else {
      if (state.sliceDoc(menu.from, menu.to) !== (menu.kind === "slash" ? "/" + menu.query : "")) {this.close(); return;}
      const range = {from: menu.from, to: menu.to};
      const draftKind: ObjectKind | null = item.command === "mathBlock" ? "math"
        : item.command === "mermaid" ? "mermaid" : item.command === "graphviz" ? "graphviz" : null;
      if (draftKind) {
        this.view.dom.dispatchEvent(new CustomEvent("tegg-edit-object", {bubbles: true, cancelable: true,
          detail: {...range, kind: draftKind, create: true}}));
        this.close();
        return;
      }
      if (item.markdown !== undefined) {
        const plan = planStructuralInsert(state, range, item.markdown, item.kind);
        if (!plan) {this.close(); return;}
        dispatchSourcePatches(this.view, plan.patches, {selection: plan.selection, isolateHistory: true, scrollIntoView: true});
        if (item.kind === "code") {
          const doc=this.view.state.doc, anchor=this.view.state.selection.main.anchor, identity=this.controller.identity;
          requestAnimationFrame(() => {if(this.view.dom.isConnected&&this.view.state.doc===doc&&
            this.view.state.selection.main.anchor===anchor&&sameEditingIdentity(identity,this.controller.identity))
            focusCodeAtSelection(this.view);});
        }
      } else {
        const marker = item.command.startsWith("heading") ? `${"#".repeat(Number(item.command.slice(7)))} ` :
          item.command === "list" ? "- " : item.command === "orderedList" ? "1. " : item.command === "task" ? "- [ ] " : "> ";
        dispatchSourcePatches(this.view, [{...range, expected: state.sliceDoc(range.from, range.to), insert: marker}],
          {selection: {anchor: range.from + marker.length}, isolateHistory: true, scrollIntoView: true});
      }
    }
    this.close(); this.view.focus();
  }
  private close() {this.menu = null; this.items = []; this.list.hidden = true; this.list.replaceChildren();}
  private outside = (event: MouseEvent) => {
    if (!this.menu || this.list.contains(event.target as Node) ||
      this.plus.contains(event.target as Node) || this.more.contains(event.target as Node)) return;
    if (this.menu.kind === "slash") this.dismissed = {from: this.menu.from, query: this.menu.query};
    this.close();
  };
  private focusCheck = (event: FocusEvent) => {
    if (!this.menu || this.view.contentDOM.contains(event.target as Node) ||
      event.target === this.plus || event.target === this.more || this.list.contains(event.target as Node)) return;
    if (this.menu.kind === "slash") this.dismissed = {from: this.menu.from, query: this.menu.query};
    this.close();
  };
  private key = (event: KeyboardEvent) => {
    if (!this.menu || event.isComposing || this.view.composing) return;
    if (event.key === "Escape") {event.preventDefault(); event.stopPropagation(); if (this.menu.kind === "slash") this.dismissed = {from: this.menu.from, query: this.menu.query}; this.close(); this.view.focus(); return;}
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); event.stopPropagation();
      if (this.items.length) this.active = (this.active + (event.key === "ArrowDown" ? 1 : -1) + this.items.length) % this.items.length;
      this.render();
      this.list.querySelectorAll<HTMLElement>(".tegg-command-option")[this.active]?.scrollIntoView?.({block: "nearest"});
      return;
    }
    if (event.key === "Enter" && this.items.length) {event.preventDefault(); event.stopPropagation(); this.apply(this.active);}
  };
}

/** Attach once to a Live Edit view; the controller remains the sole mutation owner. */
export function createCommandSurface(controller: EditingController): Extension {
  return ViewPlugin.fromClass(class extends Surface {constructor(view: EditorView) {super(view, controller);}});
}
