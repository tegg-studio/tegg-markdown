export function observeSurfaceAppearance(root: HTMLElement, changed: () => void): () => void {
  const key = () => `${root.dataset.theme ?? ""}:${getComputedStyle(root).getPropertyValue("--background")}:${window.matchMedia?.("(prefers-color-scheme: dark)").matches}`;
  let previous = key();
  const update = () => { const next = key(); if (next !== previous) { previous = next; changed(); } };
  const observer = new MutationObserver(update);
  for(let node: HTMLElement | null = root; node; node=node.parentElement) observer.observe(node, {attributes:true,attributeFilter:["data-theme","style","class"]});
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener?.("change", update);
  return () => { observer.disconnect(); media?.removeEventListener?.("change", update); };
}
