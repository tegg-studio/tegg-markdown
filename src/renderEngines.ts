export type RenderEngines = {
  math?: (source: string, display: "inline" | "block") => string;
  highlight?: (source: string, language: string) => string | undefined;
  mermaid?: (source: string, target: HTMLElement, current: () => boolean) => Promise<string>;
  graphviz?: (source: string, target: HTMLElement, current: () => boolean) => Promise<string>;
};
let defaults: RenderEngines = {};
const scoped = new WeakMap<HTMLElement, RenderEngines>();
/** Used by the compatibility entry. Explicit per-instance engines take precedence. */
export function configureDefaultEngines(engines: RenderEngines) {defaults = {...engines};}
export function bindEngines(root: HTMLElement, engines?: RenderEngines) {
  if (engines) scoped.set(root, engines);
  return () => scoped.delete(root);
}
export function enginesFor(root?: HTMLElement): RenderEngines {
  for (let current = root; current; current = current.parentElement ?? undefined) {
    const engines = scoped.get(current); if (engines) return engines;
  }
  return defaults;
}
