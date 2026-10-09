import GraphvizWorker from "./graphvizWorker?worker&inline";
import {technicalValidationUnavailable, type TechnicalValidationOutcome} from "./technicalSyntax";

type LayoutWorker = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror">;
type Job = {source: string; isCurrent: () => boolean; reject: (error: Error) => void} & (
  | {kind: "render"; resolve: (svg: string) => void}
  | {kind: "validate"; resolve: (outcome: TechnicalValidationOutcome) => void}
);

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
      this.pending.push({kind: "render", source, isCurrent, resolve, reject});
      this.next();
    });
  }

  /** Actual DOT validation runs in the same interruptible, bounded WASM worker as preview. */
  validate(source: string, isCurrent: () => boolean = () => true): Promise<TechnicalValidationOutcome> {
    if (!isCurrent()) return Promise.resolve({status: "stale"});
    if (new TextEncoder().encode(source).byteLength > graphvizLimits.source) return Promise.resolve(technicalValidationUnavailable("Diagram source exceeds the preview budget.", "budget"));
    this.pending = this.pending.filter(job => {
      if (job.isCurrent()) return true;
      job.reject(new Error("Diagram preview was closed."));
      return false;
    });
    if (this.pending.length + Number(this.active !== null) >= graphvizLimits.jobs) return Promise.resolve(technicalValidationUnavailable("Too many diagrams. Split this document into smaller sections.", "budget"));
    return new Promise<TechnicalValidationOutcome>((resolve, reject) => {
      this.pending.push({kind: "validate", source, isCurrent, resolve, reject});
      this.next();
    }).catch(error => isCurrent() ? technicalValidationUnavailable(error) : {status: "stale"});
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
        if (job.kind === "validate" && result?.validation && ["valid", "invalid", "unavailable"].includes(result.validation.status)) {
          this.finish(undefined, undefined, false, result.validation);
        } else if (job.kind === "render" && typeof result?.svg === "string" && result.svg.length <= graphvizLimits.output) {
          this.finish(undefined, result.svg);
        } else this.finish(new Error(typeof result?.error === "string" ? result.error : "Invalid diagram output."));
      };
      this.worker.onerror = () => this.finish(new Error("Diagram worker stopped. Try a smaller diagram."), undefined, true);
      this.deadline = setTimeout(() => {
        const error = new Error("Diagram took too long. Its preview was stopped; the source is unchanged.");
        this.finish(error, undefined, true, technicalValidationUnavailable(error, "budget"));
      }, graphvizLimits.timeoutMs);
      this.worker.postMessage(job.kind === "validate" ? {method: "validate", source: job.source, maximumOutput: graphvizLimits.output} : {source: job.source, maximumOutput: graphvizLimits.output});
    } catch {
      this.finish(new Error("Could not start the diagram worker."), undefined, true);
    }
  }

  private finish(error?: Error, svg?: string, release = false, validation?: TechnicalValidationOutcome) {
    clearTimeout(this.deadline);
    const job = this.active;
    this.active = null;
    if (release) this.releaseWorker();
    if (job) {
      if (!job.isCurrent()) job.reject(new Error("Diagram preview was closed."));
      else if (error && job.kind === "validate") job.resolve(validation ?? technicalValidationUnavailable(error));
      else if (error) job.reject(error);
      else if (job.kind === "validate") job.resolve(validation ?? technicalValidationUnavailable("Invalid diagram validation output."));
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
