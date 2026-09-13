import type { EditorView } from "@codemirror/view";
import { calloutIcon, isKnownCallout, resolveCallout } from "./callouts";

export function calloutTypeButton(view: EditorView, from: number, type: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "callout-type-button";
  button.setAttribute("aria-label", `Change ${isKnownCallout(type) ? resolveCallout(type).label : type} callout type`);
  button.setAttribute("aria-haspopup", "menu");
  button.title = "Change Callout Type";
  button.append(calloutIcon(type));
  button.addEventListener("mousedown", event => event.preventDefault());
  button.addEventListener("click", event => {
    event.preventDefault(); event.stopPropagation();
    const rect = button.getBoundingClientRect();
    view.dom.dispatchEvent(new CustomEvent("tegg-callout-menu", {bubbles: true,
      detail: {from, x: rect.left, y: rect.bottom, viewportWidth: window.innerWidth}}));
  });
  button.addEventListener("keydown", event => event.stopPropagation());
  return button;
}
