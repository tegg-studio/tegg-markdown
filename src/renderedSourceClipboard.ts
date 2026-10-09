/** Renderer-owned source coordinates. Author HTML attributes are never authority. */
export type RenderedSourceRange = Readonly<{
  from: number;
  to: number;
  object?: boolean;
  /** Mark the actual Callout title node, not the complete Callout wrapper. */
  calloutTitle?: boolean;
}>;

const sourceRanges = new WeakMap<Node, RenderedSourceRange>();
const opaqueNodes = new WeakMap<Node, object>();
const literalNodes = new WeakMap<Node, object>();

export function registerRenderedSourceRange(node: Node, range: RenderedSourceRange): () => void {
  const value = Object.freeze({...range});
  sourceRanges.set(node, value);
  return () => { if (sourceRanges.get(node) === value) sourceRanges.delete(node); };
}

/** Register actual generated controls, not classes or attributes author HTML can copy. */
export function registerRenderedClipboardOpaque(node: Node): () => void {
  const owner = {}; opaqueNodes.set(node, owner);
  return () => { if (opaqueNodes.get(node) === owner) opaqueNodes.delete(node); };
}

/** Reports only the exact renderer-registered generated node identity. */
export function isRenderedClipboardOpaque(node: Node): boolean {
  return opaqueNodes.has(node);
}

/** A real code body or real table cell keeps its own internal text selection. */
export function registerRenderedClipboardLiteral(node: Node): () => void {
  const owner = {}; literalNodes.set(node, owner);
  return () => { if (literalNodes.get(node) === owner) literalNodes.delete(node); };
}

function contents(node: Node): Range {
  const range = node.ownerDocument!.createRange();
  range.selectNodeContents(node);
  return range;
}

function atContentEdge(node: Node, offset: number, container: Node, end: boolean): boolean {
  if (!container.contains(node)) return false;
  const length = node.nodeType === 3 ? (node.nodeValue ?? '').length : node.childNodes.length;
  if (offset !== (end ? length : 0)) return false;
  for (let current = node; current !== container;) {
    const parent = current.parentNode;
    if (!parent || current !== (end ? parent.lastChild : parent.firstChild)) return false;
    current = parent;
  }
  return true;
}

function coversContents(range: Range, node: Node): boolean {
  const other = contents(node);
  const start = range.compareBoundaryPoints(0, other) <= 0 || atContentEdge(range.startContainer, range.startOffset, node, false);
  const end = range.compareBoundaryPoints(2, other) >= 0 || atContentEdge(range.endContainer, range.endOffset, node, true);
  return start && end;
}

function inside(range: Range, other: Range): boolean {
  return range.compareBoundaryPoints(0, other) >= 0 && range.compareBoundaryPoints(2, other) <= 0;
}

function opaqueEndpoint(node: Node, root: Node): boolean {
  for (let current: Node | null = node; current; current = current.parentNode) {
    if (opaqueNodes.has(current)) return true;
    if (current === root) break;
  }
  return false;
}

function valid(range: RenderedSourceRange, source: string): boolean {
  return Number.isSafeInteger(range.from) && Number.isSafeInteger(range.to) &&
    range.from >= 0 && range.to > range.from && range.to <= source.length;
}

/**
 * Preserve complete source blocks and atomic objects selected in rendered content.
 * Partial ordinary inline text intentionally returns null for controlled-HTML
 * conversion. A whole object may be expanded, but generated controls and
 * unregistered intervening content never authorize copying unrelated source.
 */
export function mapRenderedClipboardRange(root: Node, selection: Range, source: string): {from: number; to: number} | null {
  if (typeof source !== 'string' || selection.collapsed ||
      !root.contains(selection.startContainer) || !root.contains(selection.endContainer) ||
      opaqueEndpoint(selection.startContainer, root) || opaqueEndpoint(selection.endContainer, root)) return null;
  const selected: RenderedSourceRange[] = [];
  let rejected = false;
  try {
    // A folded title text selection is different from explicitly selecting the
    // complete Callout. Test the registered title's outer boundary before the
    // atomic ancestor can expand it to include hidden body source. The same
    // outer-boundary guard protects selections of generated controls themselves
    // and internal code/cell text without promoting them to whole objects.
    const protectedOnly = (node: Node): boolean => {
      if (!selection.intersectsNode(node)) return false;
      const mapped = sourceRanges.get(node);
      if ((mapped?.calloutTitle || opaqueNodes.has(node) || literalNodes.has(node)) && node.parentNode) {
        const outer = node.ownerDocument!.createRange(); outer.selectNode(node);
        if (inside(selection, outer)) return true;
      }
      return Array.from(node.childNodes).some(protectedOnly);
    };
    if (protectedOnly(root)) return null;
    const visit = (node: Node): void => {
      if (rejected || !selection.intersectsNode(node)) return;
      if (opaqueNodes.has(node)) { rejected = true; return; }
      const mapped = sourceRanges.get(node);
      if (mapped) {
        if (!valid(mapped, source)) { rejected = true; return; }
        if (mapped.object || coversContents(selection, node)) {
          selected.push(mapped); return;
        }
      }
      if (node.nodeType === 3) {
        // Formatting whitespace between rendered blocks is not document text.
        if ((node.nodeValue ?? '').trim()) rejected = true;
        return;
      }
      if (node.nodeType === 1 && !node.childNodes.length) {
        // An unregistered image, empty paragraph, BR or other visible leaf must
        // not be swallowed merely because registered blocks surround it.
        rejected = true; return;
      }
      const before = selected.length;
      for (const child of Array.from(node.childNodes)) visit(child);
      if (node !== root && node.nodeType === 1 && selected.length === before) rejected = true;
    };
    visit(root);
    if (rejected || !selected.length) return null;
    for (let index = 1; index < selected.length; index++) {
      if (selected[index].from < selected[index - 1].to) return null;
    }
    return {from: selected[0].from, to: selected[selected.length - 1].to};
  } catch {
    // A detached/cross-document DOM Range or unsupported generated projection
    // gets controlled HTML fallback, never a guessed source interval.
    return null;
  }
}
