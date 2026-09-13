import { describe, it, expect } from "vitest";
import { parseDocument, type Scalar, type YAMLSeq } from "yaml";
import { metadataValuePatch, metadataListPatch } from "./metadataEditing";
import { applySourcePatches } from "./sourcePatch";

function edit(source: string, path: (string | number)[], value: string) {
  const node = parseDocument(source, { intAsBigInt: true }).getIn(path, true) as Scalar;
  return applySourcePatches(source, [metadataValuePatch(source, node, value)]);
}

describe("Metadata scalar edits", () => {
  it("preserves neighboring fields, comments and flow collection structure", () => {
    const source = '# keep\nauthor: {name: Leon, active: true} # trailing\ntags: [one, two]\n';
    const result = edit(source, ['author', 'name'], 'Ada: #quoted');
    expect(result).toBe(source.replace('name: Leon', 'name: "Ada: #quoted"'));
    expect(edit(result, ['tags', 1], 'three')).toBe(result.replace('one, two', 'one, "three"'));
  });
  it.each(['\n', '\r\n'])("preserves block scalar header comments and sibling boundaries (%j)", newline => {
    const source = ['description: | # keep', '  hello', '  world', 'next: 2'].join(newline);
    const result = edit(source, ['description'], 'new\nlines\n');
    expect(result).toBe('description: "new\\nlines\\n" # keep' + newline + 'next: 2');
    expect(parseDocument(result).toJS()).toEqual({description: 'new\nlines\n', next: 2});
  });
  it("preserves string types, booleans and large integer precision", () => {
    expect(edit('text: "false"', ['text'], 'true')).toBe('text: "true"');
    expect(edit('flag: false', ['flag'], 'true')).toBe('flag: true');
    expect(edit('count: 2', ['count'], '9007199254740993')).toBe('count: 9007199254740993');
    expect(() => edit('count: 2', ['count'], '[1, 2]')).toThrow('number');
  });
  it.each(['empty:', 'empty: # keep'])('fills a missing value without consuming its comment: %s', source => {
    const changed = edit(source, ['empty'], 'filled');
    expect(parseDocument(changed).toJS()).toEqual({empty: 'filled'});
    if (source.includes('#')) expect(changed).toContain('# keep');
  });
});


describe("Metadata list edits", () => {
  it.each(['\n', '\r\n'])("preserves comments and siblings while changing block list entries: %j", newline => {
    const source = ['tags:', '  - first # keep', '  - second', 'status: ready'].join(newline);
    const list = parseDocument(source).get('tags', true) as YAMLSeq;
    const patch = metadataListPatch(source, list, [{originalIndex: 0, value: 'changed'}, {originalIndex: null, value: 'false'}]);
    const updated = applySourcePatches(source, [patch]);
    expect(updated).toContain('# keep');
    expect(updated).toContain(newline + 'status: ready');
    expect(parseDocument(updated).toJS()).toEqual({tags: ['changed', 'false'], status: 'ready'});
    const empty = applySourcePatches(source, [metadataListPatch(source, list, [])]);
    expect(parseDocument(empty).toJS()).toEqual({tags: [], status: 'ready'});
  });
  it.each(['\n', '\r\n'])("saves nested flow lists with comments and preserves siblings: %j", newline => {
    const source = ['group:', '  tags: [', '    first, # keep first', '    second', '  ] # keep list', '  next: ready', 'outside: 12'].join(newline);
    const list = parseDocument(source).getIn(['group', 'tags'], true) as YAMLSeq;
    const updated = applySourcePatches(source, [metadataListPatch(source, list, [
      {originalIndex: 0, value: 'first'}, {originalIndex: 1, value: 'changed'}, {originalIndex: null, value: 'false'},
    ])]);
    expect(parseDocument(updated).errors).toEqual([]);
    expect(parseDocument(updated).toJS()).toEqual({group: {tags: ['first', 'changed', 'false'], next: 'ready'}, outside: 12});
    expect(updated).toContain('# keep first');
    expect(updated).toContain('] # keep list' + newline + '  next: ready' + newline + 'outside: 12');
    if (newline === '\r\n') expect(updated.replaceAll('\r\n', '')).not.toContain('\n');
  });
  it("keeps inline list comments outside the changed token", () => {
    const source = 'aliases: [one, two] # keep\nstatus: ready';
    const list = parseDocument(source).get('aliases', true) as YAMLSeq;
    const updated = applySourcePatches(source, [metadataListPatch(source, list, [{originalIndex: 1, value: 'two'}])]);
    expect(updated).toBe('aliases: [ two ] # keep\nstatus: ready');
  });
});
