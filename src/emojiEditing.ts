import {EditorView, WidgetType} from "@codemirror/view";
import emojiMap from "markdown-it-emoji/lib/data/full.mjs";
import {dispatchSourcePatches} from "./editorPatches";

const dialogs = new WeakMap<HTMLElement, HTMLDialogElement>();

export class EmojiWidget extends WidgetType {
  constructor(readonly emoji: string, readonly name: string, readonly from: number) { super(); }
  eq(other: EmojiWidget) { return this.emoji === other.emoji && this.name === other.name && this.from === other.from; }
  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.className = "cm-live-emoji";
    span.textContent = this.emoji;
    span.setAttribute("aria-label", `${this.name}. Edit emoji shortcode`);
    span.setAttribute("role", "button"); span.tabIndex = 0;
    span.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); this.edit(view, span); }
    });
    span.title = "Double-click or right-click to edit shortcode";
    span.addEventListener("mousedown", event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      const rect = span.getBoundingClientRect();
      const anchor = event.clientX > rect.left + rect.width / 2 ? this.from + this.name.length + 2 : this.from;
      view.dispatch({selection: {anchor}}); view.focus();
    });
    for (const type of ["dblclick", "contextmenu"]) span.addEventListener(type, event => {
      event.preventDefault(); event.stopPropagation(); this.edit(view, span);
    });
    return span;
  }
  edit(view: EditorView, owner: HTMLElement) {
    if (dialogs.has(owner)) return;
    const raw = `:${this.name}:`, snapshot = view.state.doc;
    const dialog = document.createElement("dialog");
    dialogs.set(owner, dialog);
    dialog.className = "md-emoji-editor";
    dialog.setAttribute("aria-label", "Edit emoji shortcode");
    const form = document.createElement("form");
    const label = document.createElement("label"); label.textContent = "Emoji shortcode";
    const field = document.createElement("input"); field.value = raw;
    field.setAttribute("aria-label", "Emoji shortcode"); field.spellcheck = false; field.autocomplete = "off";
    label.append(field);
    const preview = document.createElement("div"); preview.className = "md-emoji-preview"; preview.setAttribute("aria-live", "polite");
    const buttons = document.createElement("div"); buttons.className = "md-emoji-actions";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel";
    const save = document.createElement("button"); save.type = "submit"; save.textContent = "Save";
    const name = () => field.value.trim().replace(/^:|:$/g, "");
    const refresh = () => {
      const emoji = (emojiMap as Record<string, string>)[name()];
      save.disabled = !emoji;
      preview.textContent = emoji || "Unknown shortcode";
    };
    const close = () => { dialog.close(); dialog.remove(); dialogs.delete(owner); view.focus(); };
    cancel.addEventListener("click", close);
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    field.addEventListener("input", refresh);
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (save.disabled) return;
      if (view.state.doc !== snapshot || view.state.sliceDoc(this.from, this.from + raw.length) !== raw) {
        preview.textContent = "The document changed. Reopen the emoji to edit."; save.disabled = true; return;
      }
      const insert = `:${name()}:`;
      close();
      if (insert !== raw) dispatchSourcePatches(view, [{from: this.from, to: this.from + raw.length, expected: raw, insert}], {isolateHistory: true});
    });
    buttons.append(cancel, save); form.append(label, preview, buttons); dialog.append(form);
    document.body.append(dialog); refresh(); dialog.showModal(); field.focus(); field.select();
  }
  destroy(dom: HTMLElement) { dialogs.get(dom)?.remove(); dialogs.delete(dom); }
  ignoreEvent() { return true; }
}
