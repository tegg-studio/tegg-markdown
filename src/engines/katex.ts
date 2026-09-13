import katex from "katex";
import type {RenderEngines} from "../renderEngines";
export const katexEngine: NonNullable<RenderEngines["math"]> = (source, display) => katex.renderToString(source, {
  displayMode: display === "block", throwOnError: true, strict: false,
  trust: false, maxExpand: 1000, maxSize: 20, macros: {}, output: "htmlAndMathml",
});
