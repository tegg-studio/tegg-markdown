export type SourceRange = {
  from: number;
  to: number;
};

export type SourcePatch = SourceRange & {
  insert: string;
  /** The exact source captured when an interactive projection was created. */
  expected?: string;
};

export class SourcePatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourcePatchError";
  }
}

/**
 * Validates source-first editing invariants and returns patches in document
 * order. Callers apply from the end so earlier offsets remain stable.
 */
export function validateSourcePatches(source: string, patches: readonly SourcePatch[]): SourcePatch[] {
  const ordered = [...patches].sort((left, right) => left.from - right.from || left.to - right.to);
  let previousTo = 0;

  ordered.forEach((patch, index) => {
    if (!Number.isInteger(patch.from) || !Number.isInteger(patch.to)) {
      throw new SourcePatchError("Patch ranges must use integer offsets");
    }
    if(typeof patch.insert!=="string")throw new SourcePatchError("Patch insert must be text");
    if (patch.from < 0 || patch.to < patch.from || patch.to > source.length) {
      throw new SourcePatchError(`Patch range ${patch.from}...${patch.to} is outside the source`);
    }
    const splitsSurrogate=(position:number)=>position>0&&position<source.length&&/[\uD800-\uDBFF]/.test(source[position-1])&&/[\uDC00-\uDFFF]/.test(source[position]);
    if(splitsSurrogate(patch.from)||splitsSurrogate(patch.to))throw new SourcePatchError("Patch boundary must not split a Unicode code point");
    if(/([\uD800-\uDBFF](?![\uDC00-\uDFFF]))|((?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/.test(patch.insert))throw new SourcePatchError("Patch insert must contain valid Unicode code points");
    if (index > 0 && patch.from < previousTo) {
      throw new SourcePatchError("Source patches must not overlap");
    }
    if (patch.expected !== undefined && source.slice(patch.from, patch.to) !== patch.expected) {
      throw new SourcePatchError(`Patch range ${patch.from}...${patch.to} no longer matches its source`);
    }
    previousTo = patch.to;
  });

  return ordered;
}

export function applySourcePatches(source: string, patches: readonly SourcePatch[]): string {
  const ordered = validateSourcePatches(source, patches);
  return ordered.reduceRight(
    (result, patch) => result.slice(0, patch.from) + patch.insert + result.slice(patch.to),
    source,
  );
}
