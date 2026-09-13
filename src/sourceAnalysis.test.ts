import {describe, expect, it} from "vitest";
import {EditorState} from "@codemirror/state";
import {analyzeSource} from "./sourceAnalysis";

describe("source-version analysis cache", () => {
  it("reuses analysis across selection changes and invalidates on edits", () => {
    const state = EditorState.create({doc: "[[Note]] ==highlight=="});
    const first = analyzeSource(state.doc);
    expect(analyzeSource(state.update({selection: {anchor: 4}}).state.doc)).toBe(first);
    const changed = state.update({changes: {from: 0, to: 8, insert: "plain"}}).state;
    expect(analyzeSource(changed.doc)).not.toBe(first);
    expect(analyzeSource(changed.doc).wikiLinks).toEqual([]);
  });
});
