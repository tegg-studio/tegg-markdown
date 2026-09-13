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
