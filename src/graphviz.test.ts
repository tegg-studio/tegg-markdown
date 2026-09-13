import {afterEach, describe, expect, it, vi} from "vitest";
vi.mock("./graphvizWorker?worker&inline", () => ({default: class {}}));
import {GraphvizRenderer, graphvizLimits} from "./graphviz";

function harness() {
  const workers: Array<ReturnType<typeof makeWorker>> = [];
  function makeWorker() {
    return {onmessage: null as Worker["onmessage"], onerror: null as Worker["onerror"], postMessage: vi.fn(), terminate: vi.fn()};
  }
  const renderer = new GraphvizRenderer(() => { const worker = makeWorker(); workers.push(worker); return worker; });
  function reply(index: number, data: unknown) { workers[index].onmessage?.call(workers[index] as unknown as Worker, {data} as MessageEvent); }
  return {renderer, workers, reply};
}
afterEach(() => vi.useRealTimers());
describe("bounded Graphviz workers", () => {
  it("terminates a stalled worker and lets the next diagram run in a fresh worker", async () => {
    vi.useFakeTimers();
    const {renderer, workers, reply} = harness();
    const first = renderer.render("digraph { A -> B }").catch(error => error.message);
    const second = renderer.render("digraph { C -> D }");
    expect(workers).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(graphvizLimits.timeoutMs);
    expect(await first).toContain("too long");
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers).toHaveLength(2);
    reply(1, {svg: "<svg/>"});
    expect(await second).toBe("<svg/>");
    await vi.advanceTimersByTimeAsync(graphvizLimits.idleMs);
    expect(workers[1].terminate).toHaveBeenCalledOnce();
  });
  it("bounds admission and discards obsolete queued documents without running them", async () => {
    vi.useFakeTimers();
    const {renderer, workers, reply} = harness();
    await expect(renderer.render("x".repeat(graphvizLimits.source + 1))).rejects.toThrow("source");
    const first = renderer.render("first");
    let current = true;
    const stale = renderer.render("stale", () => current).catch(error => error.message);
    current = false;
    const final = renderer.render("final");
    expect(await stale).toContain("closed");
    reply(0, {svg: "<svg>first</svg>"});
    expect(await first).toContain("first");
    expect(workers[0].postMessage.mock.calls.map(call => call[0].source)).toEqual(["first", "final"]);
    reply(0, {svg: "<svg>final</svg>"});
    await final;
    await vi.advanceTimersByTimeAsync(graphvizLimits.idleMs);
  });
  it("rejects oversized output and keeps the queue bounded", async () => {
    vi.useFakeTimers();
    const {renderer, reply} = harness();
    const jobs = Array.from({length: graphvizLimits.jobs}, () => renderer.render("a").catch(error => error.message));
    await expect(renderer.render("overflow")).rejects.toThrow("Too many");
    reply(0, {svg: "x".repeat(graphvizLimits.output + 1)});
    expect(await jobs[0]).toContain("Invalid");
    for (let i = 1; i < jobs.length; i++) reply(0, {svg: "<svg/>"});
    await Promise.all(jobs);
    await vi.advanceTimersByTimeAsync(graphvizLimits.idleMs);
  });
});
