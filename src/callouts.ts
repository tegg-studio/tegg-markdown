import definitions from "./calloutTypes.generated";

/** One catalog is consumed by the native menu and all web rendering surfaces. */
export const calloutTypes = definitions;
export type CalloutDefinition = typeof definitions[number];
const types = new Map<string, CalloutDefinition>();
for (const definition of definitions) {
  for (const id of [definition.id, ...definition.aliases]) types.set(id, definition);
}
export function resolveCallout(id: string): CalloutDefinition {
  return types.get(id.toLowerCase()) ?? definitions[0];
}
export function isKnownCallout(id: string) { return types.has(id.toLowerCase()); }

export function parseCalloutHeader(text: string) {
  const match = /^\[!([A-Za-z][A-Za-z0-9_-]*)\]([+-])?(?:[ \t]+(.*))?$/.exec(text);
  if (!match) return null;
  return { rawType: match[1], type: match[1].toLowerCase(), title: match[3] ?? "", fold: match[2] ?? "" };
}

export function calloutIcon(id: string): HTMLElement {
  const icon = document.createElement("span");
  icon.className = "callout-icon";
  icon.setAttribute("aria-hidden", "true");
  // Only bundled, reviewed SVGs; never interpolate source text or user HTML.
  icon.innerHTML = resolveCallout(id).svg.replace(/>\s+</g, "><");
  return icon;
}

export function applyCalloutAppearance(element: HTMLElement, id: string) {
  const definition = resolveCallout(id);
  element.dataset.callout = id.toLowerCase();
  element.dataset.calloutKind = definition.id;
  element.style.setProperty("--callout-light", definition.light);
  element.style.setProperty("--callout-dark", definition.dark);
}
