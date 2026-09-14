export type TableAlignment = "left" | "center" | "right" | null;
export type MarkdownTable = {
  headers: string[];
  rows: string[][];
  alignments: TableAlignment[];
  sourceDelimiter?: string;
  sourceColumnCount?: number;
};
export type TableCellRange = {from: number; to: number};
/** GFM pipes are separators unless preceded by an odd number of backslashes. */
export function tableCellRanges(line: string): TableCellRange[] {
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
    while (from < to && /[ \t]/.test(line[from])) from++;
    while (to > from && /[ \t]/.test(line[to - 1])) to--;
    return {from, to};
  });
}
function splitRow(line: string): string[] {
  return tableCellRanges(line).map(({from, to}) => line.slice(from, to).replace(/\\\|/g, "|"));
}
type Original = {source: string; values: string[][]; alignments: TableAlignment[]; rowWidths: number[]; newline: string; prefix: string; suffix: string};
const originals = new WeakMap<MarkdownTable, Original>();
export function parseMarkdownTable(source: string): MarkdownTable | null {
  const body = source.trim();
  const lines = body.split(/\r?\n/);
  if (lines.length < 2 || lines.slice(2).some(line => !line.trim())) return null;
  let separator = false, slashRun = 0;
  for (const character of lines[0]) {if (character === "|" && slashRun % 2 === 0) separator = true;slashRun = character === "\\" ? slashRun + 1 : 0;}
  if (!separator) return null;
  const headers = splitRow(lines[0]);
  const delimiters = splitRow(lines[1]);
  if (!headers.length || delimiters.length !== headers.length || delimiters.some(value => !/^:?-+:?$/.test(value.trim()))) return null;
  const alignments = delimiters.map<TableAlignment>(value => value.startsWith(":") ? value.endsWith(":") ? "center" : "left" : value.endsWith(":") ? "right" : null);
  const rawRows = lines.slice(2).map(splitRow);
  const rows = rawRows.map(row => headers.map((_, index) => row[index] ?? ""));
  const table: MarkdownTable = {headers, rows, alignments, sourceDelimiter: lines[1].trim(), sourceColumnCount: headers.length};
  const start = source.indexOf(body);
  originals.set(table, {source, values: [headers.slice(), ...rows.map(row => row.slice())], alignments: alignments.slice(), rowWidths: rawRows.map(row => row.length), newline: source.includes("\r\n") ? "\r\n" : "\n", prefix: source.slice(0,start), suffix: source.slice(start + body.length)});
  return table;
}
export function tableHasOverflow(table: MarkdownTable) {return originals.get(table)?.rowWidths.some(width => width > table.headers.length) ?? false;}
export function escapeTableCell(value: string) {
  return value.replace(/\r?\n/g, " ").replace(/(\\*)\|/g, (_match, slashes: string) => slashes + "\\".repeat(slashes.length % 2 ? 2 : 1) + "|").trim();
}
function delimiter(alignment: TableAlignment, previous = "---") {
  const width = Math.max(3, (previous.match(/-/g) ?? []).length);
  return (alignment === "left" || alignment === "center" ? ":" : "") + "-".repeat(width) + (alignment === "right" || alignment === "center" ? ":" : "");
}
export function serializeMarkdownTable(table: MarkdownTable): string {
  const original = originals.get(table);
  const values = [table.headers, ...table.rows];
  const sameShape = original && values.length === original.values.length && values.every((row, i) => row.length === original.values[i].length);
  if (sameShape) {
    let rowIndex = 0;
    return original.source.replace(/[^\r\n]+/g, line => {
      if (!line.trim()) return line;
      const index = rowIndex++;
      const ranges = tableCellRanges(line);
      if (index === 1) {
        for (let column = ranges.length - 1; column >= 0; column--) {
          if (table.alignments[column] === original.alignments[column]) continue;
          const range = ranges[column];
          line = line.slice(0, range.from) + delimiter(table.alignments[column] ?? null, line.slice(range.from,range.to)) + line.slice(range.to);
        }
        return line;
      }
      const valueIndex = index === 0 ? 0 : index - 1;
      // Missing cells are legal GFM. Materialize their fields only when edited.
      if (ranges.length < values[valueIndex].length && values[valueIndex].slice(ranges.length).some((v,i) => v !== original.values[valueIndex][ranges.length+i])) {
        return "| " + values[valueIndex].map(escapeTableCell).join(" | ") + " |";
      }
      for (let column = ranges.length - 1; column >= 0; column--) {
        const value = values[valueIndex]?.[column];
        if (value === undefined || value === original.values[valueIndex]?.[column]) continue;
        const range = ranges[column];
        line = line.slice(0, range.from) + escapeTableCell(value) + line.slice(range.to);
      }
      return line;
    });
  }
  const headers = table.headers.length ? table.headers : ["Column 1"];
  const row = (values: string[]) => `| ${headers.map((_, index) => escapeTableCell(values[index] ?? "")).join(" | ")} |`;
  const preserveDelimiter = table.sourceDelimiter && table.sourceColumnCount === headers.length && (!original || table.alignments.every((value,index) => value === original.alignments[index]));
  const result = [row(headers), preserveDelimiter ? table.sourceDelimiter! : `| ${headers.map((_, index) => delimiter(table.alignments[index] ?? null)).join(" | ")} |`, ...table.rows.map(row)].join(original?.newline ?? "\n");
  return (original?.prefix ?? "") + result + (original?.suffix ?? "");
}
