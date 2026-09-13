export type TableAlignment = "left" | "center" | "right" | null;
export type MarkdownTable = {
  headers: string[];
  rows: string[][];
  alignments: TableAlignment[];
  /** Original delimiter row, retained while the column count is unchanged. */
  sourceDelimiter?: string;
  sourceColumnCount?: number;
};

function cellRanges(line: string): {from: number; to: number}[] {
  const separators: number[] = [];
  let slashes = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|" && slashes % 2 === 0) separators.push(i);
    slashes = line[i] === "\\" ? slashes + 1 : 0;
  }
  const boundaries = [-1, ...separators, line.length];
  const ranges = boundaries.slice(0, -1).map((start, i) => ({from: start + 1, to: boundaries[i + 1]}));
  if (separators.length && !line.slice(0, separators[0]).trim()) ranges.shift();
  if (separators.length && !line.slice(separators.at(-1)! + 1).trim()) ranges.pop();
  return ranges.map(({from, to}) => {
    while (from < to && /\s/.test(line[from])) from++;
    while (to > from && /\s/.test(line[to - 1])) to--;
    return {from, to};
  });
}

function splitRow(line: string): string[] {
  return cellRanges(line).map(({from, to}) => line.slice(from, to).replace(/\\\|/g, "|"));
}

const originals = new WeakMap<MarkdownTable, {source: string; values: string[][]}>();

export function parseMarkdownTable(source: string): MarkdownTable | null {
  const lines = source.trim().split(/\r?\n/);
  if (lines.length < 2 || !/^\s*\|?\s*:?-{3,}/.test(lines[1])) return null;
  const headers = splitRow(lines[0]);
  if (!headers.length) return null;
  const alignments = splitRow(lines[1]).map<TableAlignment>((delimiter) => {
    const trimmed = delimiter.trim();
    if (trimmed.startsWith(":")) return trimmed.endsWith(":") ? "center" : "left";
    return trimmed.endsWith(":") ? "right" : null;
  });
  const rows = lines.slice(2).map(splitRow).map((row) => headers.map((_, index) => row[index] ?? ""));
  const table: MarkdownTable = {
    headers,
    rows,
    alignments: headers.map((_, index) => alignments[index] ?? null),
    sourceDelimiter: lines[1].trim(),
    sourceColumnCount: headers.length,
  };
  originals.set(table, {source, values: [headers.slice(), ...rows.map(row => row.slice())]});
  return table;
}

function escapeCell(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}

export function serializeMarkdownTable(table: MarkdownTable): string {
  const original = originals.get(table);
  const values = [table.headers, ...table.rows];
  if (original && values.length === original.values.length && values.every((row, i) => row.length === original.values[i].length)) {
    let rowIndex = 0;
    return original.source.replace(/[^\r\n]+/g, line => {
      if (!line.trim()) return line;
      const index = rowIndex++;
      if (index === 1) return line;
      const valueIndex = index === 0 ? 0 : index - 1;
      const ranges = cellRanges(line);
      for (let column = ranges.length - 1; column >= 0; column--) {
        const value = values[valueIndex]?.[column];
        if (value === undefined || value === original.values[valueIndex]?.[column]) continue;
        const range = ranges[column];
        line = line.slice(0, range.from) + escapeCell(value) + line.slice(range.to);
      }
      return line;
    });
  }
  const headers = table.headers.length ? table.headers : ["Column 1"];
  const row = (values: string[]) => `| ${headers.map((_, index) => escapeCell(values[index] ?? "")).join(" | ")} |`;
  const delimiter = (alignment: TableAlignment) => {
    if (alignment === "left") return ":---";
    if (alignment === "center") return ":---:";
    if (alignment === "right") return "---:";
    return "---";
  };
  return [
    row(headers),
    table.sourceDelimiter && table.sourceColumnCount === headers.length
      ? table.sourceDelimiter
      : `| ${headers.map((_, index) => delimiter(table.alignments[index] ?? null)).join(" | ")} |`,
    ...table.rows.map(row),
  ].join("\n");
}
