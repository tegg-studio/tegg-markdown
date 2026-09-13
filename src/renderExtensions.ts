export type RenderNode = Readonly<{
  kind: "table" | "code" | "link" | "image";
  text: string; language?: string; href?: string; src?: string; alt?: string; title?: string;
  headers?: readonly string[]; rows?: readonly (readonly string[])[];
}>;
export type RenderContext = {documentId: string; revision: string; signal: AbortSignal; renderDefault(): HTMLElement};
export type RendererInstance = {destroy(): void; update?(node: RenderNode): void};
export type ReadonlyRenderer = (container: HTMLElement, node: RenderNode, context: RenderContext) => void | RendererInstance | Promise<void | RendererInstance>;
export type ReadonlyRenderers = Partial<Record<RenderNode["kind"] | `fence:${string}`, ReadonlyRenderer>>;
type Mounted = {node: RenderNode; key: string; renderer: ReadonlyRenderer; container: HTMLElement; context: RenderContext; controller: AbortController; instance?: RendererInstance; ready: Promise<void>; dispose(): void};
const mounted = new WeakMap<HTMLElement, Mounted[]>();
function report(callback: ((error: unknown) => void) | undefined, error: unknown) {try {callback?.(error);} catch { /* A Host error reporter cannot prevent resource cleanup. */ }}
export function disposeRenderers(root: HTMLElement) {for(const entry of mounted.get(root) ?? []) entry.dispose(); mounted.delete(root);}
export async function mountRenderers(root: HTMLElement, renderers: ReadonlyRenderers, context: Omit<RenderContext, "renderDefault">, onError?: (error: unknown) => void) {
  if (context.signal.aborted) return;
  const remaining: Mounted[] = [], next: Mounted[] = [];
  for(const entry of mounted.get(root) ?? []) {
    if(root.contains(entry.container)) {
      const renderer=(entry.node.language && renderers[`fence:${entry.node.language}`]) || renderers[entry.node.kind];
      if(renderer === entry.renderer) {next.push(entry);continue;}
      entry.container.replaceWith(entry.context.renderDefault());entry.dispose();
    } else remaining.push(entry);
  }
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("table, pre > code, a, img"))) {
    if (!root.contains(element) || element.closest("[data-tegg-slot], .frontmatter, .md-object-panel")) continue;
    const kind = element.tagName === "TABLE" ? "table" : element.tagName === "CODE" ? "code" : element.tagName === "A" ? "link" : "image";
    const language = kind === "code" ? element.className.match(/language-([^\s]+)/)?.[1] ?? "text" : undefined;
    const renderer = (language && renderers[`fence:${language}`]) || renderers[kind]; if (!renderer) continue;
    const node: RenderNode = Object.freeze({kind, text: element.textContent ?? "", language, href: element.getAttribute("href") ?? undefined, src: element.getAttribute("src") ?? undefined, alt: element.getAttribute("alt") ?? undefined, title: element.getAttribute("title") ?? undefined,
      ...(kind === "table" ? {headers: Object.freeze(Array.from(element.querySelectorAll("thead th"), cell => cell.textContent ?? "")), rows: Object.freeze(Array.from(element.querySelectorAll("tbody tr"), row => Object.freeze(Array.from(row.querySelectorAll("td"), cell => cell.textContent ?? ""))))} : {})});
    const target = kind === "code" ? element.closest<HTMLElement>(".md-render-code") ?? element.parentElement! : element;
    const key = context.documentId + ":" + JSON.stringify(node);
    const match = remaining.findIndex(entry => entry.key === key && entry.renderer === renderer && !entry.controller.signal.aborted);
    if (match >= 0) {
      const entry = remaining.splice(match,1)[0];
      const changedRevision = entry.context.revision !== context.revision; entry.context.revision = context.revision;
      if(changedRevision) try {entry.instance?.update?.(node);} catch(error) {entry.dispose();report(onError,error);continue;}
      target.replaceWith(entry.container); next.push(entry); continue;
    }
    const container = document.createElement(kind === "link" || kind === "image" ? "span" : "div"); container.dataset.teggSlot = kind; target.replaceWith(container); container.append(target);
    const controller = new AbortController();
    const entry: Mounted = {node, key, renderer, container, controller, context: {...context, signal: controller.signal, renderDefault: () => target}, ready: Promise.resolve(), dispose() {
      if(controller.signal.aborted) return; controller.abort();
      try {entry.instance?.destroy();} catch(error) {report(onError,error);}
    }};
    entry.ready = Promise.resolve().then(() => {
      if(controller.signal.aborted) return;
      container.replaceChildren(); return renderer(container,node,entry.context);
    }).then(instance => {
      if(instance) {if(controller.signal.aborted) instance.destroy(); else entry.instance = instance;}
    }).catch(error => {if(!controller.signal.aborted) {container.replaceChildren(target); report(onError,error);}});
    next.push(entry);
  }
  for(const entry of remaining) entry.dispose(); mounted.set(root,next);
  await new Promise<void>(resolve => {
    const cancel = () => resolve(); context.signal.addEventListener("abort",cancel,{once:true});
    Promise.all(next.map(entry=>entry.ready)).finally(()=>{context.signal.removeEventListener("abort",cancel);resolve();});
  });
}
