import { isScalar, type YAMLSeq } from "yaml";
import { metadataListPatch, type MetadataListEntry } from "./metadataEditing";
import type { SourcePatch } from "./sourcePatch";

export type MetadataEditorSession = { commit: () => boolean; focus: () => void };

export function createMetadataTags(source: string, node: YAMLSeq, path: (string | number)[], controls: {
  renderValue: (item: unknown, index: number) => HTMLElement;
  begin: (session: MetadataEditorSession) => boolean;
  end: () => void;
  change: (patch: SourcePatch) => boolean;
}): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "md-metadata-tags";
  const display = document.createElement("div");
  display.className = "md-metadata-value-display md-metadata-chips";
  for (const [index, item] of node.items.entries()) {
    const chip = document.createElement("span");
    chip.className = "md-metadata-chip";
    chip.append(controls.renderValue(item, index));
    display.append(chip);
  }
  if (!node.items.length) display.append(document.createTextNode("[]"));
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.hidden = true;
  trigger.className = "md-metadata-value-edit";
  trigger.dataset.metadataPath = JSON.stringify(path);
  trigger.setAttribute("aria-label", `Edit ${path.join(" / ")}`);
  display.append(trigger);
  wrapper.append(display);
  trigger.addEventListener("click", event => {
    event.preventDefault(); event.stopPropagation();
    const entries: MetadataListEntry[] = node.items.map((item, index) => ({ originalIndex: index, value: isScalar(item) ? String(item.value) : "" }));
    const form = document.createElement("div");
    form.className = "md-metadata-value-form md-metadata-tags-form";
    const chips = document.createElement("div");
    chips.className = "md-metadata-tag-fields";
    const add = document.createElement("input");
    add.className = "md-metadata-tag-add";
    add.placeholder = "New tag";
    add.setAttribute("aria-label", `New tag for ${path.join(" / ")}`);
    const hint = document.createElement("span");
    hint.id = `metadata-tags-help-${Math.random().toString(36).slice(2)}`;
    hint.className = "md-metadata-tags-help";
    hint.textContent = "Click to edit · × to remove · Tab to add";
    add.setAttribute("aria-describedby", hint.id);
    const error = document.createElement("span");
    error.className = "md-metadata-value-error";
    error.setAttribute("role", "alert");
    let pending: (() => void) | undefined;
    const button = (label: string, action: () => void) => {
      const result = document.createElement("button");
      result.type = "button";
      result.textContent = label;
      result.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); action(); });
      return result;
    };
    const addTag = () => {
      if (!add.value.trim()) return false;
      entries.push({ originalIndex: null, value: add.value.trim() });
      add.value = "";
      render();
      return true;
    };
    const restore = () => {
      controls.end(); form.remove(); display.hidden = false;
      wrapper.closest<HTMLElement>("dd")?.focus();
    };
    const commit = () => {
      pending?.(); addTag();
      if (entries.length === node.items.length && entries.every((entry, index) => entry.originalIndex === index && isScalar(node.items[index]) && entry.value === (node.items[index] as {value: unknown}).value)) {
        restore(); return true;
      }
      try {
        if (!controls.change(metadataListPatch(source, node, entries))) throw new Error("This list changed. Reopen it to edit the latest version.");
        controls.end(); return true;
      } catch (failure) {
        error.textContent = failure instanceof Error ? failure.message : "Could not save tags.";
        return false;
      }
    };
    const render = () => {
      chips.replaceChildren();
      entries.forEach((entry, index) => {
        const chip = document.createElement("span");
        chip.className = "md-metadata-tag-token";
        const label = button(entry.value || '""', () => {
          pending?.();
          const input = document.createElement("input");
          input.className = "md-metadata-tag-input";
          input.value = entry.value;
          input.size = Math.max(3, Math.min(24, entry.value.length + 1));
          input.setAttribute("aria-label", `Edit tag ${index + 1}`);
          const finish = () => { entry.value = input.value; pending = undefined; render(); };
          pending = finish;
          input.addEventListener("keydown", event => {
            event.stopPropagation();
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter" || event.key === "Tab" && !event.shiftKey) { event.preventDefault(); finish(); add.focus(); }
            else if (event.key === "Escape") { event.preventDefault(); pending = undefined; render(); add.focus(); }
          });
          const currentLabel = chips.querySelectorAll(".md-metadata-tag-token > button:first-child")[index] ?? label;
          currentLabel.replaceWith(input); input.focus(); input.select();
        });
        label.setAttribute("aria-label", `Edit tag ${index + 1}: ${entry.value}`);
        const remove = button("×", () => { pending?.(); entries.splice(index, 1); render(); add.focus(); });
        remove.setAttribute("aria-label", `Remove tag ${index + 1}: ${entry.value}`);
        chip.append(label, remove); chips.append(chip);
      });
      chips.append(add);
    };
    add.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      if ((event.key === "Tab" && !event.shiftKey || event.key === "Enter") && add.value.trim()) {
        event.preventDefault(); pending?.(); addTag(); add.focus();
      } else if (event.key === "Escape") { event.preventDefault(); restore(); }
    });
    form.addEventListener("keydown", event => { event.stopPropagation(); if (!event.isComposing && event.keyCode !== 229 && event.key === "Escape") { event.preventDefault(); restore(); } });
    const footer = document.createElement("div");
    footer.className = "md-metadata-tag-footer";
    footer.append(hint, button("Save", commit), button("Cancel", restore));
    form.append(chips, footer, error);
    if (!controls.begin({ commit, focus: () => add.focus() })) return;
    display.hidden = true; wrapper.append(form); render(); add.focus();
  });
  return wrapper;
}
