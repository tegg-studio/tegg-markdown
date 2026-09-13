// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest";
const layout = vi.hoisted(() => vi.fn());
vi.mock("./graphviz", () => ({graphvizRenderer: {render: layout}}));
import {renderDiagram} from "./renderKit";

beforeEach(() => { layout.mockReset(); });
describe("diagram host ownership", () => {
  it("does not enqueue a document detached during engine import", async () => {
    const root = document.createElement("div");
    const target = root.appendChild(document.createElement("div"));
    const rendering = renderDiagram({kind: "diagram", engine: "dot", source: "digraph {a -> b}"}, target,
      () => root.contains(target));
    target.remove();
    await rendering;
    expect(layout).not.toHaveBeenCalled();
  });
  it("does not write an old result after its host replaces the document", async () => {
    let finish!: (svg: string) => void;
    layout.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
    const root = document.createElement("div");
    const target = root.appendChild(document.createElement("div"));
    const rendering = renderDiagram({kind: "diagram", engine: "dot", source: "digraph {a -> b}"}, target,
      () => root.contains(target));
    await vi.waitFor(() => expect(layout).toHaveBeenCalledOnce());
    target.remove();
    finish("<svg></svg>");
    await rendering;
    expect(target.querySelector("svg")).toBeNull();
  });
  it("supports a current host that is not attached to the page", async () => {
    layout.mockResolvedValue("<svg></svg>");
    const root = document.createElement("div");
    const target = root.appendChild(document.createElement("div"));
    await renderDiagram({kind: "diagram", engine: "dot", source: "digraph {a -> b}"}, target,
      () => root.contains(target));
    expect(target.querySelector("svg")).not.toBeNull();
  });
});
