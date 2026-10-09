import type {RenderEngines} from "./renderEngines";

export type TechnicalDraftKind = "math" | "mermaid" | "graphviz";
export type TechnicalValidationOutcome =
  | {status: "valid"}
  | {status: "invalid"; message: string}
  | {status: "unavailable"; reason: "engine" | "resource" | "budget" | "unknown"; message: string}
  | {status: "stale"};
export type TechnicalValidator = (
  source: string, target: HTMLElement, current: () => boolean, display: "inline" | "block",
) => TechnicalValidationOutcome | Promise<TechnicalValidationOutcome>;
export type ValidatingEngine<T> = T & {validate?: TechnicalValidator};

export function technicalValidationUnavailable(error: unknown, reason: "engine" | "resource" | "budget" | "unknown" = "engine"): TechnicalValidationOutcome {
  return {status: "unavailable", reason, message: error instanceof Error ? error.message : typeof error === "string" ? error : "Preview validation is unavailable."};
}

/** A renderer failure alone is never proof of a syntax error. Only opt-in parsers validate a draft. */
export async function validateTechnicalDraft(
  kind: TechnicalDraftKind, body: string, engines: RenderEngines, target: HTMLElement,
  current: () => boolean, display: "inline" | "block" = "block",
): Promise<TechnicalValidationOutcome> {
  if (!current()) return {status: "stale"};
  const validate = engines[kind]?.validate;
  if (!validate) return technicalValidationUnavailable("This preview engine does not provide syntax validation.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => validate(body, target, current, display)),
      new Promise<TechnicalValidationOutcome>(resolve => {timer = setTimeout(() => resolve(technicalValidationUnavailable("Preview validation exceeded the preview budget.", "budget")), 4_000);}),
    ]);
    return current() ? result : {status: "stale"};
  } catch (error) {
    return current() ? technicalValidationUnavailable(error) : {status: "stale"};
  } finally {clearTimeout(timer);}
}

/** Error shapes emitted by Mermaid's actual Jison / Langium parsers, not guesses from draft text. */
export function mermaidValidationFailure(error: unknown): TechnicalValidationOutcome {
  if (error && typeof error === "object") {
    const value = error as {name?: string; message?: string; hash?: {expected?: unknown; token?: unknown; line?: unknown}; result?: {lexerErrors?: unknown[]; parserErrors?: unknown[]}};
    const jison = value.hash && (Array.isArray(value.hash.expected) || value.hash.token === null && typeof value.hash.line === "number" && value.message?.startsWith("Lexical error on line "));
    const langium = value.result && (Array.isArray(value.result.lexerErrors) && value.result.lexerErrors.length > 0 || Array.isArray(value.result.parserErrors) && value.result.parserErrors.length > 0);
    if (value.name === "UnknownDiagramError" || jison || langium) {
      return {status: "invalid", message: value.message ?? "Invalid diagram syntax."};
    }
  }
  return technicalValidationUnavailable(error);
}

export type GraphvizDiagnostic = {message: string; level?: "error" | "warning"};
/** Graphviz can return an SVG despite a malformed HTML label, so inspect its parser diagnostics as well. */
export function graphvizValidationResult(result: {status: "success" | "failure"; errors: GraphvizDiagnostic[]}): TechnicalValidationOutcome {
  const errors = result.errors.filter(error => error.level === "error");
  // These diagnostics are produced by DOT / Graphviz's HTML grammar. Other failures (images, layout, WASM) remain preview unavailability.
  const syntax = errors.find(error => /^(?:syntax error(?:\s|$)|mismatched tag(?:\s|$)|Unknown HTML element(?:\s|$)|not well-formed \(invalid token\)|unclosed token(?:\s|$))/i.test(error.message));
  if (syntax) return {status: "invalid", message: errors.map(error => error.message).join("\n")};
  if (result.status === "success" && errors.length === 0) return {status: "valid"};
  return technicalValidationUnavailable(errors.map(error => error.message).join("\n") || "The diagram preview could not be produced.", "resource");
}
