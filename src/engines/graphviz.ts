export async function graphvizEngine(source: string, _target: HTMLElement, current: () => boolean): Promise<string> {
  const {graphvizRenderer} = await import("../graphviz");
  if (!current()) return "";
  return graphvizRenderer.render(source, current);
}
