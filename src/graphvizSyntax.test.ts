import {afterEach,expect,it,vi} from "vitest";
vi.mock("./graphvizWorker?worker&inline", () => ({default: class {}}));
import {GraphvizRenderer,graphvizLimits} from "./graphviz";
function harness() {
  const workers: Array<ReturnType<typeof worker>> = [];
  function worker() {return {onmessage: null as Worker["onmessage"], onerror: null as Worker["onerror"], postMessage: vi.fn(), terminate: vi.fn()};}
  const renderer = new GraphvizRenderer(() => {const value = worker(); workers.push(value); return value;});
  const reply = (index: number, data: unknown) => workers[index].onmessage?.call(workers[index] as unknown as Worker, {data} as MessageEvent);
  return {renderer,workers,reply};
}
afterEach(() => vi.useRealTimers());
it("keeps validation and ordinary preview serialized with their distinct outcomes", async () => {
  vi.useFakeTimers(); const {renderer,workers,reply} = harness();
  const validation = renderer.validate("digraph {a -> }");
  const render = renderer.render("digraph {a -> b}");
  expect(workers[0].postMessage.mock.calls[0][0]).toEqual({method: "validate",source: "digraph {a -> }",maximumOutput: graphvizLimits.output});
  reply(0, {validation: {status: "invalid",message: "syntax error in line 1 near '}'"}});
  expect(await validation).toMatchObject({status: "invalid"});
  expect(workers[0].postMessage.mock.calls[1][0]).toEqual({source: "digraph {a -> b}",maximumOutput: graphvizLimits.output});
  reply(0, {svg: "<svg/>"}); expect(await render).toBe("<svg/>");
  await vi.advanceTimersByTimeAsync(graphvizLimits.idleMs);
});
it("reclaims a stalled validation worker but allows a later legitimate preview", async () => {
  vi.useFakeTimers(); const {renderer,workers,reply} = harness();
  const validation = renderer.validate("digraph {a}"); const render = renderer.render("digraph {b}");
  await vi.advanceTimersByTimeAsync(graphvizLimits.timeoutMs);
  expect(await validation).toMatchObject({status: "unavailable",reason: "budget"});
  expect(workers[0].terminate).toHaveBeenCalledOnce(); reply(1,{svg: "<svg/>"}); expect(await render).toBe("<svg/>");
  await vi.advanceTimersByTimeAsync(graphvizLimits.idleMs);
});
it("keeps stale draft validation and source admission separate from syntax failure", async () => {
  vi.useFakeTimers(); const {renderer,reply} = harness(); let current = true;
  const validation = renderer.validate("old",() => current); current = false; reply(0,{validation: {status: "invalid",message: "old"}});
  expect(await validation).toEqual({status: "stale"});
  expect(await renderer.validate("a".repeat(graphvizLimits.source + 1))).toMatchObject({status: "unavailable",reason: "budget"});
  expect(await renderer.validate("new",() => false)).toEqual({status: "stale"});
  await vi.advanceTimersByTimeAsync(graphvizLimits.idleMs);
});
