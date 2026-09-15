import { describe, expect, it } from "vitest";
import { applySourcePatches, SourcePatchError, validateSourcePatches } from "./sourcePatch";

describe("source-first patch contract", () => {
  it("changes only declared ranges and keeps surrounding Markdown byte-for-byte", () => {
    const source = "before\n- [ ] Task\nunknown {{syntax}}\nafter\n";
    const from = source.indexOf("[ ]");
    const result = applySourcePatches(source, [{ from, to: from + 3, insert: "[x]", expected: "[ ]" }]);

    expect(result).toBe("before\n- [x] Task\nunknown {{syntax}}\nafter\n");
    expect(result.slice(0, from)).toBe(source.slice(0, from));
    expect(result.slice(from + 3)).toBe(source.slice(from + 3));
  });

  it("applies multiple patches without shifting later source ranges", () => {
    expect(applySourcePatches("alpha beta gamma", [
      { from: 0, to: 5, insert: "A", expected: "alpha" },
      { from: 11, to: 16, insert: "G", expected: "gamma" },
    ])).toBe("A beta G");
  });

  it("rejects out-of-bounds, overlapping, and stale projection patches", () => {
    expect(() => validateSourcePatches("abc", [{ from: -1, to: 1, insert: "" }]))
      .toThrow(SourcePatchError);
    expect(() => validateSourcePatches("abc", [
      { from: 0, to: 2, insert: "a" },
      { from: 1, to: 3, insert: "c" },
    ])).toThrow("must not overlap");
    expect(() => validateSourcePatches("new", [{ from: 0, to: 3, insert: "next", expected: "old" }]))
      .toThrow("no longer matches");
  });
  it("rejects a patch that would corrupt a Unicode code point",()=>{
    expect(()=>applySourcePatches("A🐈B",[{from:2,to:3,insert:""}])).toThrow("Unicode code point");
    expect(()=>applySourcePatches("text",[{from:0,to:0,insert:"\ud800"}])).toThrow("valid Unicode");
    expect(applySourcePatches("A🐈B",[{from:1,to:3,insert:"👨‍👩‍👧‍👦"}])).toBe("A👨‍👩‍👧‍👦B");
  });

});
