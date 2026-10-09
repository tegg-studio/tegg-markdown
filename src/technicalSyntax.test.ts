import {afterEach,describe,expect,it,vi} from "vitest";
import {instance} from "@viz-js/viz";
import {katexEngine} from "./engines/katex";
import {mermaidEngine} from "./engines/mermaid";
import {graphvizValidationResult,mermaidValidationFailure,validateTechnicalDraft} from "./technicalSyntax";
import type {RenderEngines} from "./renderEngines";
const target = {} as HTMLElement;
afterEach(() => vi.useRealTimers());

describe("real technical draft syntax", () => {
  it("uses KaTeX's parser without trimming or rewriting the original body", async () => {
    const good = String.raw`\frac{1}{2} + \text{a }`, bad = String.raw`\frac{1}{`;
    expect(await validateTechnicalDraft("math", good, {math: katexEngine}, target, () => true)).toEqual({status: "valid"});
    const result = await validateTechnicalDraft("math", bad, {math: katexEngine}, target, () => true);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") expect(result.message).toContain("KaTeX parse error");
    expect(good).toBe(String.raw`\frac{1}{2} + \text{a }`);
  });
  it("keeps the actual KaTeX expansion admission failure separate from syntax", async () => {
    const result = await validateTechnicalDraft("math", String.raw`\def\a{\a}\a`, {math: katexEngine}, target, () => true);
    expect(result).toMatchObject({status: "unavailable", reason: "budget"});
  });
  it("uses real Mermaid grammar and semantic parser errors", async () => {
    expect(await validateTechnicalDraft("mermaid", "flowchart TD\n A --> B", {mermaid: mermaidEngine}, target, () => true)).toEqual({status: "valid"});
    for (const source of ["flowchart TD\n A -->", "not a diagram", "sequenceDiagram\n participant A\n deactivate A", "flowchart TD\n A[unterminated", "flowchart TD\n A @ B", 'pie\n "X": abc']) {
      expect(await validateTechnicalDraft("mermaid", source, {mermaid: mermaidEngine}, target, () => true)).toMatchObject({status: "invalid"});
    }
    expect(mermaidValidationFailure(new TypeError("Failed to fetch dynamically imported module"))).toMatchObject({status: "unavailable", reason: "engine"});
    expect(mermaidValidationFailure(new Error("DOMPurify is unavailable"))).toMatchObject({status: "unavailable"});
  });
  it("reads real Viz DOT and HTML-label parser diagnostics including failure with an SVG", async () => {
    const viz = await instance();
    const good = 'digraph "a{b" { a [label="literal } text"]; a -> b }';
    expect(graphvizValidationResult(viz.render(good, {format: "svg", engine: "dot"}))).toEqual({status: "valid"});
    expect(graphvizValidationResult(viz.render("digraph { a -> }", {format: "svg", engine: "dot"}))).toMatchObject({status: "invalid"});
    const malformed = viz.render('digraph { a[label=<<TABLE><TR><TD>no</TABLE>>] }', {format: "svg", engine: "dot"});
    expect(malformed.status).toBe("success");
    expect(graphvizValidationResult(malformed)).toMatchObject({status: "invalid"});
    expect(graphvizValidationResult(viz.render('digraph { a[image="missing.png"] }', {format: "svg", engine: "dot"}))).toEqual({status: "valid"});
    expect(graphvizValidationResult({status: "failure", errors: [{level: "error", message: "Could not load an image resource"}]})).toMatchObject({status: "unavailable", reason: "resource"});
  });
  it("does not guess syntax from a missing or custom preview renderer", async () => {
    const custom = vi.fn(() => {throw new Error("preview unavailable");});
    expect(await validateTechnicalDraft("math", "possibly valid", {}, target, () => true)).toMatchObject({status: "unavailable"});
    expect(await validateTechnicalDraft("math", "possibly valid", {math: custom}, target, () => true)).toMatchObject({status: "unavailable"});
    expect(custom).not.toHaveBeenCalled();
  });
  it("drops late outcomes after the captured draft revision changes", async () => {
    let current = true, resolve!: (outcome: {status: "invalid"; message: string}) => void;
    const math: NonNullable<RenderEngines["math"]> = () => "";
    math.validate = () => new Promise(done => {resolve = done;});
    const result = validateTechnicalDraft("math", "old", {math}, target, () => current);
    await Promise.resolve(); current = false; resolve({status: "invalid", message: "old parser result"});
    expect(await result).toEqual({status: "stale"});
    const validate = vi.fn(() => ({status: "valid"} as const)); math.validate = validate;
    expect(await validateTechnicalDraft("math", "new", {math}, target, () => false)).toEqual({status: "stale"});
    expect(validate).not.toHaveBeenCalled();
  });
  it("unlocks valid content when an opt-in validator fails to load or never finishes", async () => {
    const math: NonNullable<RenderEngines["math"]> = () => "";
    math.validate = () => {throw new TypeError("WASM unavailable");};
    expect(await validateTechnicalDraft("math", "body", {math}, target, () => true)).toMatchObject({status: "unavailable", reason: "engine"});
    vi.useFakeTimers(); math.validate = () => new Promise(() => {});
    const result = validateTechnicalDraft("math", "body", {math}, target, () => true);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await result).toMatchObject({status: "unavailable", reason: "budget"});
    expect(vi.getTimerCount()).toBe(0);
  });
});
