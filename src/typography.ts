/** Instance sizing only; never scans or rewrites document text. */
export function appearanceScale(value = 1): number {
  return Number.isFinite(value) && value > 0 ? Math.max(.75, value) : 1;
}
export function appearanceWidth(value = 672): number {
  return Number.isFinite(value) ? Math.min(1200, Math.max(320, value)) : 672;
}
const bindings = new WeakMap<HTMLElement, () => void>();
export function observeTypography(root: HTMLElement): () => void {
  const previous = bindings.get(root);
  if (previous) return previous;
  root.classList.add("tegg-surface");
  const update = (width: number) => {
    root.style.setProperty("--md-canvas-width", `${width}px`);
    const layout = width < 480 ? "compact" : width < 960 ? "regular" : "wide";
    if (root.dataset.layout !== layout) root.dataset.layout = layout;
  };
  update(root.clientWidth);
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(entries => {
    // clientWidth includes padding: W is the canvas allocation, not the text column.
    for (const entry of entries) update((entry.target as HTMLElement).clientWidth);
  });
  observer?.observe(root);
  const dispose = () => { observer?.disconnect(); bindings.delete(root); };
  bindings.set(root, dispose);
  return dispose;
}
