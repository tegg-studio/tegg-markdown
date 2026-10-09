import type { EditorView } from "@codemirror/view";
import { calloutIcon, isKnownCallout, resolveCallout } from "./callouts";
import {contextFor,message, setUILabel} from "./uiContext";

export function calloutTypeButton(view: EditorView, from: number, type: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "callout-type-button";
  button.disabled = view.state.readOnly;
  setUILabel(button, "Change {value} callout type", {value:isKnownCallout(type) ? resolveCallout(type).label : type});
  button.setAttribute("aria-haspopup", "menu");
  button.title = message(button, "Change {value} callout type");
  button.append(calloutIcon(type));
  button.addEventListener("mousedown", event => event.preventDefault());
  const open = () => {
    if (view.state.readOnly) return;
    const rect = button.getBoundingClientRect();
    view.dom.dispatchEvent(new CustomEvent("tegg-callout-menu", {bubbles: true,
      detail: {from, x: rect.left, y: rect.bottom, viewportWidth: window.innerWidth}}));
  };
  // WebKit can deliver a real touch-up without a compatibility click inside
  // its editable container. Complete the same button action on that tap.
  let down: {id: number; x: number; y: number; doc: typeof view.state.doc; moved: boolean} | undefined;
  let consumed: {x: number; y: number; time: number} | undefined;
  button.addEventListener("pointerdown", event => {
    consumed = undefined;
    down = event.pointerType === "touch" && contextFor(view.dom).mobile && !view.state.readOnly
      ? {id: event.pointerId, x: event.clientX, y: event.clientY, doc: view.state.doc, moved: false} : undefined;
  });
  button.addEventListener("pointermove", event => {
    if (down?.id === event.pointerId && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 8) down.moved = true;
  });
  button.addEventListener("pointercancel", () => { down = undefined; consumed = undefined; });
  button.addEventListener("contextmenu", () => { down = undefined; });
  button.addEventListener("pointerup", event => {
    const start = down; down = undefined;
    if (!start || start.id !== event.pointerId || start.moved || view.state.readOnly || view.state.doc !== start.doc || !button.isConnected) return;
    const rect = button.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    event.preventDefault(); event.stopPropagation();
    consumed = {x: event.clientX, y: event.clientY, time: Date.now()};
    open();
  });
  button.addEventListener("click", event => {
    event.preventDefault(); event.stopPropagation();
    const previous = consumed; consumed = undefined;
    // Match the existing table touch compatibility bounds; fresh pointerdown
    // clears this token and keyboard/assistive activation has detail zero.
    if (previous && event.detail && Date.now() - previous.time < 700 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 8) return;
    open();
  });
  button.addEventListener("keydown", event => event.stopPropagation());
  return button;
}
