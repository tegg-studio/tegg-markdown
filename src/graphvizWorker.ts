import {instance} from "@viz-js/viz";
import {graphvizValidationResult, technicalValidationUnavailable} from "./technicalSyntax";

// WASM and its heap live entirely in this worker. Terminating the worker also
// interrupts synchronous Graphviz layout; a Promise timeout on the UI cannot.
const viz = instance();
self.onmessage = async (event: MessageEvent<{source: string; maximumOutput: number; method?: "validate"}>) => {
  if (event.data.method === "validate") {
    let engine: Awaited<typeof viz>;
    try {engine = await viz;}
    catch (error) {self.postMessage({validation: technicalValidationUnavailable(error)}); return;}
    try {
      const result = engine.render(event.data.source, {format: "svg", engine: "dot"});
      const validation = graphvizValidationResult(result);
      self.postMessage({validation: validation.status === "valid" && result.output && result.output.length > event.data.maximumOutput
        ? technicalValidationUnavailable("Diagram output exceeds the preview budget.", "budget") : validation});
    } catch (error) {self.postMessage({validation: technicalValidationUnavailable(error)});}
    return;
  }
  try {
    const engine = await viz;
    const svg = engine.renderString(event.data.source, {format: "svg", engine: "dot"});
    if (svg.length > event.data.maximumOutput) throw new Error("Diagram output exceeds the preview budget.");
    self.postMessage({svg});
  } catch (error) {
    self.postMessage({error: error instanceof Error ? error.message : "Could not render diagram"});
  }
};
