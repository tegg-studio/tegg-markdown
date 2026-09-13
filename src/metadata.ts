import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import { createMetadataTags } from "./metadataTags";
import { metadataValuePatch } from "./metadataEditing";
import type { SourcePatch } from "./sourcePatch";
import { parseWikiLink } from "./profile";

const panelCleanups = new WeakMap<HTMLElement, () => void>();
let panelSequence = 0;

export function disposeMetadataPanel(panel: HTMLElement) {
  panelCleanups.get(panel)?.();
  panelCleanups.delete(panel);
}

type MetadataEditingOptions = {
  onChange?: (patch: SourcePatch) => boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
};

/** Render a projection only. YAML comments, types and formatting stay in the source. */
export function createMetadataPanel(source: string, onEdit?: () => void, options: MetadataEditingOptions = {}): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "frontmatter md-render-properties";
  panel.setAttribute("aria-label", "Metadata");
  const actions = document.createElement("div");
  actions.className = "md-metadata-actions";
  let activeEditor: { commit: () => boolean; focus: () => void } | undefined;
  if (onEdit) {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "md-metadata-edit";
    edit.textContent = "Edit YAML";
    edit.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    edit.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      panel.dataset.metadataTransition = "source";
      if (!activeEditor || activeEditor.commit()) onEdit();
      else delete panel.dataset.metadataTransition;
    });
    actions.append(edit);
  }

  const viewport = document.createElement("div");
  viewport.className = "md-metadata-viewport";
  viewport.id = `metadata-content-${++panelSequence}`;
  const content = document.createElement("div");
  content.className = "md-metadata-content";
  viewport.append(content);
  panel.append(viewport);

  function sourcePreview(text: string, reason: string) {
    const wrapper = document.createElement("div");
    wrapper.className = "md-metadata-fallback";
    const label = document.createElement("div");
    label.className = "md-metadata-source-label";
    label.textContent = reason;
    const pre = document.createElement("pre");
    pre.className = "md-metadata-source";
    pre.setAttribute("aria-label", "YAML source");
    pre.textContent = text;
    wrapper.append(label, pre);
    return wrapper;
  }

  let remaining = 1000;
  function valueNode(node: unknown, depth = 0, path: (string | number)[] = [], editable = true): HTMLElement {
    if (--remaining < 0 || depth > 12) throw new Error("complex");
    // Aliases and explicitly tagged/anchored values retain their original notation
    // in the source view; never expand an alias graph or silently erase its meaning.
    if (node && typeof node === "object" && ("anchor" in node || "tag" in node)) throw new Error("notation");
    if (node == null || isScalar(node)) {
      const text = document.createElement("span");
      text.className = "md-metadata-scalar";
      const value = node == null ? null : node.value;
      const ambiguousText = typeof value === "string" &&
        (value === "" || /^(?:true|false|null|~)$/i.test(value) ||
          /^[-+]?(?:0[ox][0-9a-f]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.[\d_]+)(?:e[-+]?\d+)?|\.inf|\.nan)$/i.test(value) || /^[\[\]{}]/.test(value));
      text.textContent = value === null ? "null" : ambiguousText ? JSON.stringify(value) : String(value);
      text.dataset.metadataType = value === null ? "null" : typeof value;
      if (typeof value === "string") {
        let href: string | undefined;
        let wikiTarget: string | undefined;
        if (/^https?:\/\/\S+$/i.test(value)) {
          try {
            const url = new URL(value);
            if (url.hostname && !url.username && !url.password) href = value;
          } catch { /* Malformed URLs stay readable text. */ }
        } else if (/^\[\[[^\n]+\]\]$/.test(value)) {
          const wiki = parseWikiLink(value.slice(2, -2));
          if (wiki.target) { href = "#"; wikiTarget = wiki.target; }
        }
        if (href) {
          const link = document.createElement("a");
          link.className = "md-metadata-link";
          link.setAttribute("href", href);
          if (wikiTarget) link.dataset.wikiTarget = encodeURIComponent(wikiTarget);
          link.textContent = wikiTarget ? parseWikiLink(value.slice(2, -2)).label || wikiTarget : value;
          const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          icon.setAttribute("viewBox", "0 0 24 24");
          icon.setAttribute("aria-hidden", "true");
          icon.setAttribute("focusable", "false");
          icon.classList.add("md-metadata-link-icon");
          const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
          arrow.setAttribute("d", "M7 17 17 7M7 7h10v10");
          icon.append(arrow);
          link.append(icon);
          link.addEventListener("mousedown", event => event.preventDefault());
          text.replaceChildren(link);
        }
      }
      if (editable && options.onChange && isScalar(node) && node.range) {
        const display = document.createElement("span");
        display.className = "md-metadata-value-display";
        const editValue = document.createElement("button");
        editValue.type = "button";
        editValue.className = "md-metadata-value-edit";
        editValue.dataset.metadataPath = JSON.stringify(path);
        editValue.setAttribute("aria-description", `Current value: ${text.textContent}`);
        editValue.setAttribute("aria-label", `Edit ${path.join(" / ") || "value"}`);
        if (text.querySelector("a")) {
          display.append(...Array.from(text.childNodes));
          editValue.hidden = true;
          display.append(editValue);
        } else {
          editValue.append(...Array.from(text.childNodes));
          display.append(editValue);
        }
        text.append(display);
        editValue.addEventListener("mousedown", event => { event.preventDefault(); event.stopPropagation(); });
        editValue.addEventListener("click", event => {
          event.preventDefault(); event.stopPropagation();
          if (activeEditor) { activeEditor.focus(); return; }
          const form = document.createElement("span");
          form.className = "md-metadata-value-form";
          const input = document.createElement(typeof value === "boolean" ? "select" : typeof value === "string" && value.includes("\n") ? "textarea" : "input");
          input.className = "md-metadata-value-input";
          input.setAttribute("aria-label", `Value for ${path.join(" / ") || "value"}`);
          if (input instanceof HTMLSelectElement) {
            for (const choice of ["true", "false"]) input.add(new Option(choice, choice));
          } else if (input instanceof HTMLTextAreaElement) {
            input.rows = Math.min(6, Math.max(2, String(value).split("\n").length));
          }
          input.value = value === null ? "" : String(value);
          const initial = input.value;
          const error = document.createElement("span");
          error.className = "md-metadata-value-error";
          error.setAttribute("role", "alert");
          const restore = () => {
            activeEditor = undefined;
            form.remove();
            display.hidden = false;
            (editValue.hidden ? text.closest<HTMLElement>("dd") : editValue)?.focus();
          };
          const commit = () => {
            if (input.value === initial) { restore(); return true; }
            try {
              const patch = metadataValuePatch(source, node, input.value);
              if (!options.onChange!(patch)) throw new Error("This value changed. Reopen it to edit the latest version.");
              activeEditor = undefined;
              return true;
            } catch (failure) {
              error.textContent = failure instanceof Error ? failure.message : "Could not save this value.";
              input.setAttribute("aria-invalid", "true");
              input.focus();
              return false;
            }
          };
          const action = (label: string, run: () => void) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); run(); });
            return button;
          };
          form.addEventListener("keydown", event => {
            event.stopPropagation();
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === "Escape") { event.preventDefault(); restore(); }
            else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement) && (!(input instanceof HTMLTextAreaElement) || event.metaKey || event.ctrlKey)) {
              event.preventDefault(); commit();
            }
          });
          form.append(input, action("Save", commit), action("Cancel", restore), error);
          display.hidden = true;
          text.append(form);
          activeEditor = { commit, focus: () => input.focus() };
          input.focus();
          if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) input.select();
        });
      }
      return text;
    }
    if (isMap(node)) {
      if (!node.items.length) return literal("{}");
      const grid = document.createElement("dl");
      grid.className = "md-metadata-grid";
      const pairs = depth === 0 ? [...node.items].sort((a, b) =>
        Number(isScalar(b.key) && String(b.key.value).toLowerCase() === "tags") -
        Number(isScalar(a.key) && String(a.key.value).toLowerCase() === "tags")) : node.items;
      for (const pair of pairs) {
        if (!isScalar(pair.key) || typeof pair.key.value !== "string") throw new Error("key");
        const key = document.createElement("dt");
        key.textContent = pair.key.value;
        const value = document.createElement("dd");
        const row = document.createElement("div");
        row.className = "md-metadata-row";
        if (depth === 0 && pair.key.value.toLowerCase() === "tags") row.dataset.metadataTags = "true";
        if (isMap(pair.value) && pair.value.items.length > 0 || isSeq(pair.value) && !pair.value.items.every(item => item == null || isScalar(item))) {
          row.classList.add("md-metadata-group");
        }
        try {
          value.append(valueNode(pair.value, depth + 1, [...path, pair.key.value]));
        } catch (error) {
          // Complexity limits apply to the whole panel, not independently per row.
          if (error instanceof Error && error.message === "complex") throw error;
          const end = pair.value && typeof pair.value === "object" && "range" in pair.value
            ? (pair.value.range as [number, number, number] | undefined)?.[2] : undefined;
          if (!pair.key.range || end == null) throw error;
          const original = source.slice(pair.key.range[1], end).replace(/^[ \t]*:[ \t]*/, "").trimEnd();
          value.append(sourcePreview(original, "YAML"));
        }
        // Only this field owns its row interaction; a nested map owns its own rows.
        const rowEditor = value.querySelector<HTMLButtonElement>(
          ":scope > .md-metadata-scalar > .md-metadata-value-display > .md-metadata-value-edit[hidden], " +
          ":scope > .md-metadata-tags > .md-metadata-value-display > .md-metadata-value-edit[hidden]");
        if (rowEditor) {
          value.tabIndex = 0;
          value.dataset.metadataPath = rowEditor.dataset.metadataPath;
          value.classList.add("md-metadata-editable-row");
          value.setAttribute("aria-label", `Edit ${pair.key.value}`);
          value.addEventListener("mousedown", event => { if (!(event.target as Element).closest("a, button, input, textarea, select")) event.preventDefault(); });
          value.addEventListener("click", event => {
            if ((event.target as Element).closest("a, button, input, textarea, select, .md-metadata-value-form")) return;
            rowEditor.click();
          });
          value.addEventListener("keydown", event => {
            if (event.target !== value || event.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); rowEditor.click(); }
          });
        }
        row.append(key, value);
        grid.append(row);
      }
      return grid;
    }
    if (isSeq(node)) {
      if (options.onChange && node.items.every(item => isScalar(item) && typeof item.value === "string" && !item.anchor && !item.tag)) {
        return createMetadataTags(source, node, path, {
          // Share scalar/link rendering and the panel's node/depth budget with Reader.
          renderValue: (item, index) => valueNode(item, depth + 1, [...path, index + 1], false),
          begin: session => { if (activeEditor) { activeEditor.focus(); return false; } activeEditor = session; return true; },
          end: () => { activeEditor = undefined; },
          change: options.onChange,
        });
      }
      if (!node.items.length) return literal("[]");
      const simple = node.items.every(item => item == null || isScalar(item));
      const list = document.createElement(simple ? "div" : "ol");
      list.className = simple ? "md-metadata-chips" : "md-metadata-list";
      for (const [index, item] of node.items.entries()) {
        const entry = document.createElement(simple ? "span" : "li");
        entry.className = simple ? "md-metadata-chip" : "md-metadata-item";
        entry.append(valueNode(item, depth + 1, [...path, index + 1]));
        list.append(entry);
      }
      return list;
    }
    throw new Error("notation");
  }
  function literal(text: string) {
    const span = document.createElement("span");
    span.textContent = text;
    return span;
  }

  try {
    // Bound parser work as well as rendered nodes, independently of document size.
    if (source.length > 32768) throw new Error("large");
    const doc = parseDocument(source, { version: "1.2", schema: "core", intAsBigInt: true });
    if (doc.errors.length || doc.warnings.some(warning => warning.code !== "TAG_RESOLVE_FAILED")) throw new Error("yaml");
    content.append(valueNode(doc.contents));
  } catch (error) {
    const reason = error instanceof Error && ["large", "complex"].includes(error.message)
      ? "Metadata is too large or deeply nested to display as fields. Showing YAML source."
      : "Metadata could not be displayed as fields. Showing YAML source.";
    content.append(sourcePreview(source, reason));
  }
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "md-metadata-toggle";
  toggle.setAttribute("aria-controls", viewport.id);
  actions.prepend(toggle);
  panel.append(actions);
  let expanded = options.expanded ?? false;
  const rows = Array.from(content.querySelectorAll<HTMLElement>(":scope > .md-metadata-grid > .md-metadata-row"));
  const tags = rows.find(row => row.dataset.metadataTags === "true");
  const update = () => {
    viewport.hidden = !expanded && !tags;
    panel.classList.toggle("md-metadata-collapsed-empty", !expanded && !tags);
    toggle.textContent = expanded ? "Show Less" : tags ? "Show More" : "Show Metadata";
    toggle.setAttribute("aria-expanded", String(expanded));
    for (const row of rows) {
      row.hidden = !expanded && row !== tags;
      row.inert = row.hidden;
    }
  };
  toggle.addEventListener("mousedown", event => { event.preventDefault(); event.stopPropagation(); });
  toggle.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    if (activeEditor) { activeEditor.focus(); return; }
    expanded = !expanded;
    options.onExpandedChange?.(expanded);
    update();
    if (!expanded && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: "start" });
  });
  update();
  return panel;
}
