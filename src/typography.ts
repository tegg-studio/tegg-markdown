/** Instance sizing only; never scans or rewrites document text. */
export function appearanceScale(value = 1): number {
  return Number.isFinite(value) && value > 0 ? Math.max(.75, value) : 1;
}
export function appearanceWidth(value = 672): number {
  return Number.isFinite(value) ? Math.min(1200, Math.max(320, value)) : 672;
}
/** Refresh existing width projection after an observed surface is made visible. */
export function refreshTypography(root: HTMLElement): void {
  const width = root.clientWidth;
  root.style.setProperty("--md-canvas-width", `${width}px`);
  const layout = width < 480 ? "compact" : width < 960 ? "regular" : "wide";
  if (root.dataset.layout !== layout) root.dataset.layout = layout;
}
const bindings = new WeakMap<HTMLElement, () => void>();
export function observeTypography(root: HTMLElement): () => void {
  const previous = bindings.get(root);
  if (previous) return previous;
  root.classList.add("tegg-surface");
  refreshTypography(root);
  let alive = true, frame = 0;
  const schedule = () => {
    if (!alive || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (alive && bindings.get(root) === dispose) refreshTypography(root);
    });
  };
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(entries => {
    // clientWidth includes padding: W is the canvas allocation, not the text column.
    if (entries.some(entry => entry.target === root)) schedule();
  });
  observer?.observe(root);
  const dispose = () => {
    if (!alive) return;
    alive = false;
    observer?.disconnect();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (bindings.get(root) === dispose) bindings.delete(root);
  };
  bindings.set(root, dispose);
  return dispose;
}
