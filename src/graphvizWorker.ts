import {instance} from "@viz-js/viz";

// WASM and its heap live entirely in this worker. Terminating the worker also
// interrupts synchronous Graphviz layout; a Promise timeout on the UI cannot.
const viz = instance();
self.onmessage = async (event: MessageEvent<{source: string; maximumOutput: number}>) => {
  try {
    const engine = await viz;
    const svg = engine.renderString(event.data.source, {format: "svg", engine: "dot"});
    if (svg.length > event.data.maximumOutput) throw new Error("Diagram output exceeds the preview budget.");
    self.postMessage({svg});
  } catch (error) {
    self.postMessage({error: error instanceof Error ? error.message : "Could not render diagram"});
  }
};
