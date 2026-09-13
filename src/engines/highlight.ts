import hljs from "highlight.js";
import type {RenderEngines} from "../renderEngines";
export const highlightEngine: NonNullable<RenderEngines["highlight"]> = (source, language) =>
  language && hljs.getLanguage(language) ? hljs.highlight(source, {language, ignoreIllegals: true}).value : undefined;
