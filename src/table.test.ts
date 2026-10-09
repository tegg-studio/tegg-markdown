import { describe, expect, it } from "vitest";
import { parseMarkdownTable, serializeMarkdownTable } from "./table";

describe("natural table editing", () => {
  it("patches only the edited cell, retaining escapes, spacing and line endings", () => {
    const source = "| Path  | State |\r\n| :------ | ---: |\r\n| C:\\Users\\leon \\*literal\\* A\\|B  | old |\r\n";
    const table = parseMarkdownTable(source)!;
    expect(serializeMarkdownTable(table)).toBe(source);
    table.rows[0][1] = "new";
    expect(serializeMarkdownTable(table)).toBe(source.replace(" old ", " new "));
    table.rows.push(["D:\\notes", "ready"]);
    expect(serializeMarkdownTable(table)).toContain("C:\\Users\\leon \\*literal\\* A\\|B");
  });
  it("round-trips a GFM table", () => {
    const parsed = parseMarkdownTable("| Name | State |\n| --- | --- |\n| Reader | Ready |");
    expect(parsed).toEqual({
      headers: ["Name", "State"],
      rows: [["Reader", "Ready"]],
      alignments: [null, null],
      sourceDelimiter: "| --- | --- |",
      sourceColumnCount: 2,
    });
    expect(serializeMarkdownTable(parsed!)).toContain("| Reader | Ready |");
  });

  it("escapes literal pipes", () => {
    expect(serializeMarkdownTable({ headers: ["Value"], rows: [["A|B"]], alignments: [null] })).toContain("A\\|B");
  });

  it("preserves left, center, and right column alignment", () => {
    const parsed = parseMarkdownTable("| Left | Center | Right |\n| :----- | :---: | -----: |\n| A | B | C |");
    expect(parsed?.alignments).toEqual(["left", "center", "right"]);
    expect(serializeMarkdownTable(parsed!)).toContain("| :----- | :---: | -----: |");
  });
});


describe("canonical empty table field padding", () => {
  it.each([
    {value: "GammaXY", encoded: "GammaXY"},
    {value: "A|B", encoded: "A\\|B"},
    {value: "中文🐈", encoded: "中文🐈"},
  ])("fills a two-space header and body without moving padding: $value", ({value, encoded}) => {
    for (const newline of ["\n", "\r\n"]) {
      const headerSource = ["|  | Keep  |", "| :----- | ---: |", "| old | A\\|B  |"].join(newline) + newline;
      const header = parseMarkdownTable(headerSource)!;
      header.headers[0] = value;
      expect(serializeMarkdownTable(header)).toBe([`| ${encoded} | Keep  |`, "| :----- | ---: |", "| old | A\\|B  |"].join(newline) + newline);
      const bodySource = ["| A | Keep  |", "| :----- | ---: |", "|  | A\\|B  |"].join(newline) + newline;
      const body = parseMarkdownTable(bodySource)!;
      body.rows[0][0] = value;
      const result = serializeMarkdownTable(body);
      expect(result).toBe(["| A | Keep  |", "| :----- | ---: |", `| ${encoded} | A\\|B  |`].join(newline) + newline);
      expect(parseMarkdownTable(result)?.rows[0]).toEqual([value, "A|B"]);
    }
  });

  it.each([
    {before: "|| keep |", after: "|GammaXY| keep |"},
    {before: "| | keep |", after: "| GammaXY| keep |"},
    {before: "|   | keep |", after: "|   GammaXY| keep |"},
    {before: "|    | keep |", after: "|    GammaXY| keep |"},
    {before: "|\t| keep |", after: "|\tGammaXY| keep |"},
    {before: "|\t\t| keep |", after: "|\t\tGammaXY| keep |"},
    {before: "| \t| keep |", after: "| \tGammaXY| keep |"},
    {before: "|\t | keep |", after: "|\t GammaXY| keep |"},
  ])("retains the existing insertion behavior outside standard two-space padding: $before", ({before, after}) => {
    const prefix = "| A | B |\n| --- | --- |\n";
    const table = parseMarkdownTable(prefix + before)!;
    expect(serializeMarkdownTable(table)).toBe(prefix + before);
    table.rows[0][0] = "GammaXY";
    expect(serializeMarkdownTable(table)).toBe(prefix + after);
  });

  it("keeps every source byte on an untouched mixed table", () => {
    const source = "  |  | Keep  |\r\n| :----- | ---: |\r\n|  | A\\|B  |\r\n| \t| old |\r\n";
    const table = parseMarkdownTable(source)!;
    expect(serializeMarkdownTable(table)).toBe(source);
    table.rows[0][0] = "";
    expect(serializeMarkdownTable(table)).toBe(source);
  });
});
