// @vitest-environment jsdom
import {describe, expect, it} from "vitest";
import {geoShapes, stlShapes, geometryRenderer} from "./engines/geometry";
describe("bounded offline geometry", () => {
  it("renders GeoJSON without network resources", async () => {
    const container = document.createElement("div");
    await geometryRenderer(container, {kind: "code", language: "geojson", text: JSON.stringify({type: "LineString", coordinates: [[0,0], [1,2]]})}, {documentId: "doc", revision: "1", signal: new AbortController().signal, renderDefault: () => document.createElement("pre")});
    expect(container.querySelector("svg path")).not.toBeNull(); expect(container.querySelector("[src], image")).toBeNull();
  });
  it("rejects excessive coordinates and invalid numeric input", () => {
    expect(() => geoShapes({type: "LineString", coordinates: Array.from({length:20001}, () => [0,0])})).toThrow("budget");
    expect(() => geoShapes({type: "Point", coordinates: [Infinity, 0]})).toThrow();
  });
  it("requires complete ASCII STL triangles", () => {
    const source = "solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid test";
    expect(stlShapes(source)).toHaveLength(1); expect(() => stlShapes(source.replace("endfacet", ""))).toThrow();
  });
});
