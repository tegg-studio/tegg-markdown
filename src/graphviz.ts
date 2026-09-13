import GraphvizWorker from "./graphvizWorker?worker&inline";

type LayoutWorker = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror">;
type Job = {source: string; isCurrent: () => boolean; resolve: (svg: string) => void; reject: (error: Error) => void};

export const graphvizLimits = {source: 20_000, output: 2_000_000, jobs: 24, timeoutMs: 3_000, idleMs: 10_000};

/** One bounded queue and one reclaimable WASM heap per surface. */
export class GraphvizRenderer {
  private worker: LayoutWorker | null = null;
  private active: Job | null = null;
  private pending: Job[] = [];
  private deadline?: ReturnType<typeof setTimeout>;
  private idle?: ReturnType<typeof setTimeout>;

  constructor(private readonly createWorker: () => LayoutWorker = () => new GraphvizWorker()) {}

  render(source: string, isCurrent: () => boolean = () => true): Promise<string> {
    if (new TextEncoder().encode(source).byteLength > graphvizLimits.source) return Promise.reject(new Error("Diagram source exceeds the preview budget."));
    // Drop detached document/widget jobs before applying queue admission.
    this.pending = this.pending.filter(job => {
      if (job.isCurrent()) return true;
      job.reject(new Error("Diagram preview was closed."));
      return false;
    });
    if (this.pending.length + Number(this.active !== null) >= graphvizLimits.jobs) {
      return Promise.reject(new Error("Too many diagrams. Split this document into smaller sections."));
    }
    return new Promise((resolve, reject) => {
      this.pending.push({source, isCurrent, resolve, reject});
      this.next();
    });
  }

  private next() {
    if (this.active) return;
    clearTimeout(this.idle);
    const job = this.pending.shift();
    if (!job) {
      this.idle = setTimeout(() => this.releaseWorker(), graphvizLimits.idleMs);
      return;
    }
    if (!job.isCurrent()) {
      job.reject(new Error("Diagram preview was closed."));
      this.next();
      return;
    }
    this.active = job;
    try {
      this.worker ??= this.createWorker();
      this.worker.onmessage = event => {
        const result = event.data;
        if (typeof result?.svg === "string" && result.svg.length <= graphvizLimits.output) {
          this.finish(undefined, result.svg);
        } else this.finish(new Error(typeof result?.error === "string" ? result.error : "Invalid diagram output."));
      };
      this.worker.onerror = () => this.finish(new Error("Diagram worker stopped. Try a smaller diagram."), undefined, true);
      this.deadline = setTimeout(() => {
        this.finish(new Error("Diagram took too long. Its preview was stopped; the source is unchanged."), undefined, true);
      }, graphvizLimits.timeoutMs);
      this.worker.postMessage({source: job.source, maximumOutput: graphvizLimits.output});
    } catch {
      this.finish(new Error("Could not start the diagram worker."), undefined, true);
    }
  }

  private finish(error?: Error, svg?: string, release = false) {
    clearTimeout(this.deadline);
    const job = this.active;
    this.active = null;
    if (release) this.releaseWorker();
    if (job) {
      if (!job.isCurrent()) job.reject(new Error("Diagram preview was closed."));
      else if (error) job.reject(error);
      else job.resolve(svg!);
    }
    this.next();
  }

  private releaseWorker() {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
  }
}

export const graphvizRenderer = new GraphvizRenderer();
