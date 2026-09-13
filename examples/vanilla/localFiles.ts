/** A user-selected, in-memory file set. No implicit filesystem or server access. */
export function relativePath(href: string, documentPath: string): {path: string; fragment: string} | undefined {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return;
  const [resource, ...fragments] = href.split("#");
  let decoded: string;
  try { decoded = decodeURIComponent(resource.split("?")[0]); } catch { return; }
  if (decoded.includes("\\") || decoded.includes("\0")) return;
  const parts = decoded.startsWith("/") ? [] : documentPath.split("/").slice(0,-1);
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) return; parts.pop(); }
    else parts.push(part);
  }
  return {path: resource ? parts.join("/") : documentPath, fragment: fragments.join("#")};
}
export class LocalFiles {
  readonly files = new Map<string, File>();
  private urls = new Map<string, string>();
  constructor(files: Iterable<File>) {
    for (const file of files) {
      // Directory selection provides one common root; references are relative to it.
      const path = file.webkitRelativePath ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name;
      if (path) this.files.set(path, file);
    }
  }
  get documents() { return [...this.files.keys()].filter(path => /\.(md|markdown|txt)$/i.test(path)).sort(); }
  document(href: string, from: string) {
    const resolved = relativePath(href, from);
    if (!resolved) return;
    const path = [resolved.path, resolved.path + ".md"].find(path => this.files.has(path) && /\.(md|markdown|txt)$/i.test(path));
    return path ? {...resolved, path, file:this.files.get(path)!} : undefined;
  }
  image(src: string, from: string): string {
    if (/^(https?:|data:image\/)/i.test(src)) return src;
    const resolved = relativePath(src, from);
    const file = resolved && this.files.get(resolved.path);
    // Missing local resources must not accidentally request the preview server.
    if (!file || !resolved) return "data:image/png;base64,";
    let url = this.urls.get(resolved.path);
    if (!url) { url = URL.createObjectURL(file); this.urls.set(resolved.path, url); }
    return url + (resolved.fragment ? "#" + resolved.fragment : "");
  }
  destroy() { for (const url of this.urls.values()) URL.revokeObjectURL(url); this.urls.clear(); }
}
