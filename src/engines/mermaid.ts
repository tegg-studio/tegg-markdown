let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
let mermaidTheme = "";
async function diagramMermaid(target: HTMLElement) {
  mermaidPromise ??= import("mermaid").then(module => module.default);
  const mermaid = await mermaidPromise;
  const surface = target.closest<HTMLElement>(".tegg-surface") ?? target;
  const explicit = surface.dataset.theme;
  const color = getComputedStyle(surface).getPropertyValue("--background").trim();
  const rgb = color.startsWith("#") ? color.slice(1).match(/.{2}/g)?.map(x => parseInt(x,16)) : color.match(/[\d.]+/g)?.slice(0,3).map(Number);
  const dark = explicit ? explicit === "dark" : rgb?.length === 3 ? rgb.reduce((a,b) => a+b, 0) < 384 : window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const theme = dark ? "dark" : "neutral";
  if (mermaidTheme !== theme) mermaid.initialize({
    startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true,
    theme, maxEdges: 500, maxTextSize: 64 * 1024,
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
  });
  mermaidTheme = theme;
  return mermaid;
}

export async function mermaidEngine(source: string, target: HTMLElement, current: () => boolean): Promise<string> {
  const engine = await diagramMermaid(target);
  if (!current()) return "";
  return (await engine.render(`mermaid-${crypto.randomUUID()}`, source)).svg;
}
