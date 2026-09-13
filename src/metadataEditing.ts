import { isScalar, parseDocument, type Scalar, type YAMLSeq, Scalar as YAMLScalar, stringify } from "yaml";
import type { SourcePatch } from "./sourcePatch";

/** Replace one scalar token; never serialize the surrounding document. */
export function metadataValuePatch(source: string, node: Scalar, input: string): SourcePatch {
  if (!node.range) throw new Error("Use Edit YAML for this value.");
  const [from, valueEnd] = node.range;
  const to = Math.min(valueEnd, source.length);
  let insert: string;
  if (typeof node.value === "boolean") {
    if (input !== "true" && input !== "false") throw new Error("Choose true or false.");
    insert = input;
  } else if (typeof node.value === "number" || typeof node.value === "bigint") {
    const parsed = parseDocument(input, { schema: "core", intAsBigInt: true });
    if (parsed.errors.length || !isScalar(parsed.contents) || !["number", "bigint"].includes(typeof parsed.contents.value)) {
      throw new Error("Enter a valid number.");
    }
    // Only retain the validated numeric token, excluding comments or newlines.
    insert = input.slice(parsed.contents.range![0], parsed.contents.range![1]).trim();
  } else {
    insert = node.value === null && input === "" ? "null" : JSON.stringify(input);
  }
  const original = source.slice(from, to);
  // A block scalar's header comment is outside its value, but inside its token range.
  if (node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED") {
    const headerComment = original.split(/\r?\n/, 1)[0].match(/\s+(#.*)$/)?.[1];
    if (headerComment) insert += " " + headerComment;
  }
  if (original.endsWith("\n")) insert += original.endsWith("\r\n") ? "\r\n" : "\n";
  if (from === to) {
    if (source[from - 1] === ":" || source[from - 1] === "-") insert = " " + insert;
    if (source[from] === "#") insert += " ";
  }
  const changed = source.slice(0, from) + insert + source.slice(to);
  if (parseDocument(changed, { schema: "core" }).errors.length) throw new Error("Use Edit YAML to edit this value.");
  return { from, to, insert, expected: original };
}


export type MetadataListEntry = { originalIndex: number | null; value: string };

/** Reuse existing scalar nodes to preserve comments on unchanged list entries. */
export function metadataListPatch(source: string, node: YAMLSeq, entries: MetadataListEntry[]): SourcePatch {
  if (!node.range) throw new Error("Use Edit YAML for this list.");
  const [from, end] = node.range;
  const to = Math.min(end, source.length);
  const clone = node.clone();
  clone.comment = undefined;
  clone.commentBefore = undefined;
  clone.items = entries.map(entry => {
    const previous = entry.originalIndex === null ? null : node.items[entry.originalIndex];
    const scalar: Scalar = isScalar(previous) ? previous.clone() as Scalar : new YAMLScalar(entry.value);
    if (!previous || scalar.value !== entry.value) { scalar.value = entry.value; scalar.type = "QUOTE_DOUBLE"; }
    return scalar;
  });
  const indent = from - (source.lastIndexOf("\n", from - 1) + 1);
  let insert = stringify(clone, { lineWidth: 0 }).trimEnd();
  // Comments can force flow collections onto multiple lines too. Indent every
  // continuation relative to this token, leaving surrounding source untouched.
  insert = insert.replaceAll("\n", "\n" + " ".repeat(indent));
  const original = source.slice(from, to);
  if (original.endsWith("\n")) insert += "\n";
  if (source.includes("\r\n")) insert = insert.replaceAll("\n", "\r\n");
  const updated = source.slice(0, from) + insert + source.slice(to);
  if (parseDocument(updated, { schema: "core" }).errors.length) throw new Error("Use Edit YAML to edit this list.");
  return { from, to, insert, expected: original };
}
