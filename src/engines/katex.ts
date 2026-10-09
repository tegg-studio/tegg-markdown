import katex from "katex";
import {technicalValidationUnavailable} from "../technicalSyntax";
import type {RenderEngines} from "../renderEngines";
export const katexEngine: NonNullable<RenderEngines["math"]> = (source, display) => katex.renderToString(source, {
  displayMode: display === "block", throwOnError: true, strict: false,
  trust: false, maxExpand: 1000, maxSize: 20, macros: {}, output: "htmlAndMathml",
});

katexEngine.validate = (source, _target, current, display) => {
  if (!current()) return {status: "stale"};
  try {
    katexEngine(source, display);
    return current() ? {status: "valid"} : {status: "stale"};
  } catch (error) {
    if (!current()) return {status: "stale"};
    if (error instanceof katex.ParseError) {
      const raw = (error as Error & {rawMessage?: string}).rawMessage;
      if (raw === "Too many expansions: infinite loop or need to increase maxExpand setting") return technicalValidationUnavailable(error, "budget");
      return {status: "invalid", message: error.message};
    }
    return technicalValidationUnavailable(error);
  }
};
