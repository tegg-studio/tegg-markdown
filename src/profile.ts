import MarkdownIt from "markdown-it";
import {mathPlugin} from "./mathSyntax";
const mathBlockParser = new MarkdownIt().use(mathPlugin);
export { technicalMarkdownProfile } from "./syntaxContract";

export type FrontmatterResult = {
  metadata: string | null;
  body: string;
};

export type FrontmatterRange = FrontmatterResult & {
  from: number;
  to: number;
};

export function findFrontmatter(source: string): FrontmatterRange {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { metadata: null, body: source, from: 0, to: 0 };
  return { metadata: match[1], body: source.slice(match[0].length), from: 0, to: match[0].length };
}

export function extractFrontmatter(source: string): FrontmatterResult {
  const { metadata, body } = findFrontmatter(source);
  return { metadata, body };
}

export function parseWikiLink(raw: string): { target: string; label: string } {
  const separator = raw.indexOf("|");
  if (separator === -1) return { target: raw.trim(), label: raw.trim() };
  return {
    target: raw.slice(0, separator).trim(),
    label: raw.slice(separator + 1).trim(),
  };
}

export type WikiLinkRange = {
  from: number;
  to: number;
  target: string;
  label: string;
  separator: number | null;
};

export function findWikiLinks(source: string): WikiLinkRange[] {
  const ranges: WikiLinkRange[] = [];
  const pattern = /\[\[([^\]\n]+)\]\]/g;
  for (const match of source.matchAll(pattern)) {
    const from = match.index ?? 0;
    const parsed = parseWikiLink(match[1]);
    if (!parsed.target) continue;
    const pipe = match[1].indexOf("|");
    ranges.push({
      from,
      to: from + match[0].length,
      target: parsed.target,
      label: parsed.label,
      separator: pipe === -1 ? null : from + 2 + pipe,
    });
  }
  return ranges;
}

export type HighlightRange = { from: number; to: number; contentFrom: number; contentTo: number };

export function findHighlights(source: string): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  let opening: number | null = null;
  const unmatchedBackticks = new Map<number, number>();
  const paragraphBreak = /\r?\n[ \t]*\r?\n/g;
  let codeParagraphEnd = 0;

  for (let position = 0; position < source.length;) {
    const character = source[position];
    if (character === "\n" || character === "\r") {
      opening = null;
      position += 1;
      continue;
    }
    if (character === "\\") {
      // An escaped '=' cannot participate in a highlight delimiter.
      position += source[position + 1] === "\n" || source[position + 1] === "\r" ? 1 : 2;
      continue;
    }
    if (character === "`") {
      let end = position + 1;
      while (source[end] === "`") end += 1;
      const length = end - position;
      if (end > codeParagraphEnd) {
        paragraphBreak.lastIndex = end;
        codeParagraphEnd = paragraphBreak.exec(source)?.index ?? source.length;
      }
      const limit = codeParagraphEnd;
      let close = end;
      let codeEnd = -1;
      if (unmatchedBackticks.get(length) !== limit) {
        while ((close = source.indexOf("`", close)) !== -1 && close < limit) {
          let closeEnd = close + 1;
          while (source[closeEnd] === "`") closeEnd += 1;
          if (closeEnd - close === length) {
            codeEnd = closeEnd;
            break;
          }
          close = closeEnd;
        }
        if (codeEnd === -1) unmatchedBackticks.set(length, limit);
      }
      if (codeEnd !== -1) {
        // Code may contain literal '==' and can itself span source lines.
        if (/[\r\n]/.test(source.slice(position, codeEnd))) opening = null;
        position = codeEnd;
      } else {
        position = end;
      }
      continue;
    }
    if (source.slice(position, position + 2) !== "==") {
      position += 1;
      continue;
    }
    if (opening !== null) {
      ranges.push({ from: opening, to: position + 2, contentFrom: opening + 2, contentTo: position });
      opening = null;
      position += 2;
      continue;
    }
    let end = position + 2;
    while (source[end] === "=") end += 1;
    // Reject empty/ambiguous opening runs. A closing pair followed by an
    // opening pair still yields two ranges: ==first====second==.
    if (end === position + 2 && end < source.length && source[end] !== "\n" && source[end] !== "\r") opening = position;
    position = end;
  }
  return ranges;
}

export type InlineImage = { alt: string; src: string; title?: string };

export function parseInlineImage(raw: string): InlineImage | null {
  const match = raw.match(/^!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["']([^"']*)["'])?\s*\)$/);
  if (!match) return null;
  return { alt: match[1], src: match[2] ?? match[3], title: match[4] || undefined };
}

export function resolveLocalImageSource(src: string, documentPath: string): string {
  if (!documentPath) return src;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^file:/i.test(src)) return src;
  try {
    const documentURL = new URL(`file://${documentPath.split("/").map(encodeURIComponent).join("/")}`);
    return new URL(src, documentURL).href.replace(/^file:/, "app-file:");
  } catch {
    return src;
  }
}

export type TechnicalBlock = {
  kind: "mermaid" | "dot" | "graphviz" | "math";
  source: string;
  from: number;
  to: number;
};

type FenceRange = {
  marker: "`" | "~";
  length: number;
  info: string;
  source: string;
  from: number;
  to: number;
};

function findFencedRanges(source: string): FenceRange[] {
  const ranges: FenceRange[] = [];
  const lines = source.split("\n");
  let offset = 0;
  let active: {
    marker: "`" | "~";
    length: number;
    info: string;
    from: number;
    contentFrom: number;
  } | null = null;

  lines.forEach((lineWithCarriageReturn, index) => {
    const line = lineWithCarriageReturn.replace(/\r$/, "");
    const lineFrom = offset;
    const lineTo = lineFrom + lineWithCarriageReturn.length;
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/);

    if (!active && opening) {
      const marker = opening[1][0] as "`" | "~";
      if (marker === "~" || !opening[2].includes("`")) {
        active = {
          marker,
          length: opening[1].length,
          info: opening[2].trim(),
          from: lineFrom,
          contentFrom: lineTo + (index < lines.length - 1 ? 1 : 0),
        };
      }
    } else if (active && opening) {
      const marker = opening[1][0] as "`" | "~";
      const isClosing = marker === active.marker
        && opening[1].length >= active.length
        && opening[2].trim() === "";
      if (isClosing) {
        ranges.push({
          info: active.info,
          source: source.slice(active.contentFrom, lineFrom).replace(/\r?\n$/, ""),
          from: active.from,
          to: lineTo,
          marker: active.marker,
          length: active.length,
        });
        active = null;
      }
    }

    offset = lineTo + (index < lines.length - 1 ? 1 : 0);
  });

  return ranges;
}

export function findTechnicalBlocks(source: string): TechnicalBlock[] {
  // A fenced block cannot exist without an opening marker. Plain notes avoid
  // allocating and scanning an array containing every line on every edit.
  const fencedRanges = source.includes("```") || source.includes("~~~") ? findFencedRanges(source) : [];
  const blocks: TechnicalBlock[] = fencedRanges
    .map((range) => ({ ...range, language: range.info.split(/\s+/)[0]?.toLowerCase() }))
    .filter((range) => ["mermaid", "dot", "graphviz"].includes(range.language))
    .map(({ language, source: blockSource, from, to }) => ({
      kind: language as TechnicalBlock["kind"],
      source: blockSource,
      from,
      to,
    }));
  const lines = source.split("\n");
  const offsets: number[] = []; let offset = 0;
  for (const line of lines) {offsets.push(offset); offset += line.length + 1;}
  for (const token of mathBlockParser.parse(source, {})) {
    if (token.type !== "tegg_math_block" || !token.map) continue;
    const [first, end] = token.map;
    if (/^\s*>/.test(lines[first])) continue;
    const from = offsets[first], to = (offsets[end] ?? source.length + 1) - 1;
    blocks.push({kind: "math", source: token.content, from, to});
  }
  return blocks.sort((a, b) => a.from - b.from);
}
