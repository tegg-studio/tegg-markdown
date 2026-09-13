import type {ReadonlyRenderer} from "../renderExtensions";
import {setUIText, setUILabel} from "../uiContext";
type Point = [number, number, number];
type Shape = {points: Point[]; closed: boolean; polygon?: number};
const ns = "http://www.w3.org/2000/svg";
const limit = 20000;
function point(value: unknown): Point {
  if (!Array.isArray(value) || value.length < 2 || !value.slice(0, 3).every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e12)) throw new Error("Invalid geometry coordinate");
  return [value[0], value[1], value[2] ?? 0];
}
export function geoShapes(input: unknown): Shape[] {
  const shapes: Shape[] = []; let count = 0, polygon = 0;
  const line = (values: unknown, closed: boolean, group?: number) => {
    if (!Array.isArray(values)) throw new Error("Invalid coordinate array");
    count += values.length; if (count > limit) throw new Error("Geometry exceeds coordinate budget");
    const points = values.map(point);
    if (points.length) shapes.push({points, closed, polygon: group});
  };
  function visit(value: unknown, depth = 0) {
    if (depth > 32) throw new Error("Geometry exceeds nesting budget");
    if (value === null) return;
    if (!value || typeof value !== "object") throw new Error("Invalid GeoJSON object");
    const geometry = value as {type?: string; coordinates?: unknown; geometry?: unknown; features?: unknown[]; geometries?: unknown[]};
    const coordinates = geometry.coordinates;
    switch (geometry.type) {
      case "Feature": visit(geometry.geometry, depth + 1); break;
      case "FeatureCollection": case "GeometryCollection": {
        const items = geometry.features ?? geometry.geometries;
        if (!Array.isArray(items) || items.length > limit) throw new Error("Invalid geometry collection");
        for (const item of items) visit(item, depth + 1); break;
      }
      case "Point": line([coordinates], false); break;
      case "MultiPoint": if (!Array.isArray(coordinates)) throw new Error("Invalid points"); for (const p of coordinates) line([p], false); break;
      case "LineString": line(coordinates, false); break;
      case "MultiLineString": case "Polygon":
        if (!Array.isArray(coordinates)) throw new Error("Invalid paths");
        const group = geometry.type === "Polygon" ? ++polygon : undefined;
        for (const path of coordinates) line(path, geometry.type === "Polygon", group); break;
      case "MultiPolygon":
        if (!Array.isArray(coordinates)) throw new Error("Invalid polygons");
        for (const rings of coordinates) {
          const group = ++polygon;
          if (!Array.isArray(rings)) throw new Error("Invalid polygon");
          for (const ring of rings) line(ring, true, group);
        } break;
      default: throw new Error("Unsupported GeoJSON geometry");
    }
  }
  visit(input); if (!shapes.length) throw new Error("Geometry has no coordinates"); return shapes;
}
export function stlShapes(source: string): Shape[] {
  const shapes: Shape[] = []; let points: Point[] | null = null, inLoop = false, solid = false;
  const number = "[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?";
  const vertex = new RegExp(`^vertex\\s+(${number})\\s+(${number})\\s+(${number})$`, "i");
  const normal = new RegExp(`^facet normal\\s+(${number})\\s+(${number})\\s+(${number})$`, "i");
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    if (/^solid(?:\s|$)/i.test(line) && !solid) {solid = true; continue;}
    if (/^endsolid(?:\s|$)/i.test(line) && solid && !points) {solid = false; continue;}
    if (normal.test(line) && solid && !points) {point(line.match(normal)!.slice(1).map(Number)); points = []; continue;}
    if (/^outer loop$/i.test(line) && points && !inLoop) {inLoop = true; continue;}
    const match = line.match(vertex);
    if (match && points && inLoop && points.length < 3) {points.push(point(match.slice(1).map(Number))); continue;}
    if (/^endloop$/i.test(line) && points?.length === 3 && inLoop) {inLoop = false; continue;}
    if (/^endfacet$/i.test(line) && points?.length === 3 && !inLoop) {
      shapes.push({points, closed: true}); points = null;
      if (shapes.length > 4096) throw new Error("STL exceeds triangle budget"); continue;
    }
    throw new Error("Invalid ASCII STL structure");
  }
  if (solid || points || !shapes.length) throw new Error("Incomplete ASCII STL"); return shapes;
}
function viewport(container: HTMLElement, shapes: Shape[], is3D: boolean, signal: AbortSignal) {
  const figure = document.createElement("figure"), controls = document.createElement("div"); controls.className = "md-render-toolbar";
  const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", "0 0 600 360"); svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", is3D ? "STL model" : "Geographic geometry (offline, without basemap)");
  svg.style.width = "100%"; svg.style.maxHeight = "480px"; svg.style.color = "var(--accent, #3279c5)";
  const bounds = [0, 1, 2].map(axis => {let min = Infinity, max = -Infinity; for (const shape of shapes) for (const p of shape.points) {min = Math.min(min, p[axis]); max = Math.max(max, p[axis]);} return {center: min / 2 + max / 2, size: max - min};});
  const factor = 260 / Math.max(...bounds.map(b => b.size), 1e-9);
  let angle = is3D ? .6 : 0, scale = 1, dx = 0, dy = 0;
  const draw = () => {
    if (signal.aborted) return;
    const group = document.createElementNS(ns, "g"); group.setAttribute("transform", `translate(${300 + dx} ${180 + dy}) scale(${scale})`);
    const polygons = new Map<number, SVGPathElement>();
    for (const shape of shapes) {
      const points = shape.points.map(p => {
        const x = (p[0] - bounds[0].center) * factor, y = (p[1] - bounds[1].center) * factor, z = (p[2] - bounds[2].center) * factor;
        return [x * Math.cos(angle) + z * Math.sin(angle), -y * (is3D ? .8 : 1) + (is3D ? z * Math.cos(angle) * .4 : 0)];
      });
      if (points.length === 1) {
        const circle = document.createElementNS(ns, "circle"); circle.setAttribute("cx", String(points[0][0])); circle.setAttribute("cy", String(points[0][1])); circle.setAttribute("r", "3"); circle.setAttribute("fill", "currentColor"); group.append(circle);
      } else {
        const path = document.createElementNS(ns, "path"); path.setAttribute("d", points.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ") + (shape.closed ? " Z" : ""));
        if (shape.polygon !== undefined) {
          const existing = polygons.get(shape.polygon);
          if (existing) {existing.setAttribute("d", existing.getAttribute("d") + " " + path.getAttribute("d")); continue;}
          polygons.set(shape.polygon, path); path.setAttribute("fill-rule", "evenodd");
        }
        path.setAttribute("stroke", "currentColor"); path.setAttribute("fill", shape.closed ? "currentColor" : "none"); path.setAttribute("fill-opacity", ".18"); path.setAttribute("vector-effect", "non-scaling-stroke"); group.append(path);
      }
    }
    svg.replaceChildren(group);
  };
  const button = (label: string, run: () => void) => {const button = document.createElement("button"); button.type = "button"; setUIText(button, label); button.addEventListener("click", () => {run(); draw();}, {signal}); controls.append(button);};
  button("Zoom in", () => {scale = Math.min(8, scale * 1.25);}); button("Zoom out", () => {scale = Math.max(.25, scale / 1.25);});
  button("Left", () => {dx -= 20;}); button("Right", () => {dx += 20;}); button("Up", () => {dy -= 20;}); button("Down", () => {dy += 20;});
  if (is3D) button("Rotate", () => {angle += Math.PI / 12;});
  button("Reset", () => {scale = 1; dx = dy = 0; angle = is3D ? .6 : 0;});
  const description = document.createElement("figcaption"); setUIText(description, is3D ? "ASCII STL preview" : "Offline geometry; no external map tiles are requested.");
  figure.append(controls, svg, description); container.append(figure); draw();
}
/** Bound decoded arc expansion before calling the third-party converter. */
export function validateTopology(data: any) {
  if (data?.type !== "Topology" || !data.objects || !Array.isArray(data.arcs) || data.arcs.length > limit || Object.keys(data.objects).length > 1000) throw new Error("Invalid TopoJSON topology");
  let coordinates = 0, visits = 0;
  for (const arc of data.arcs) {if (!Array.isArray(arc)) throw new Error("Invalid arc"); for (const coordinate of arc) point(coordinate);}
  const arcs = (value: unknown, depth = 0) => {
    if (++visits > 100000 || depth > 32) throw new Error("Topology exceeds nesting budget");
    if (Array.isArray(value)) {for (const item of value) arcs(item,depth+1); return;}
    if (!Number.isSafeInteger(value)) throw new Error("Invalid arc reference");
    const index = (value as number) < 0 ? -(value as number)-1 : value as number;
    if (!data.arcs[index]) throw new Error("Unknown arc reference");
    coordinates += data.arcs[index].length; if (coordinates > limit) throw new Error("Topology exceeds coordinate budget");
  };
  const visit = (value: any, depth = 0) => {
    if (++visits > 100000 || depth > 32 || !value || typeof value !== "object") throw new Error("Invalid topology nesting");
    if (value.arcs !== undefined) arcs(value.arcs);
    if (value.geometries !== undefined) {if (!Array.isArray(value.geometries)) throw new Error("Invalid geometries"); for(const child of value.geometries) visit(child,depth+1);}
  };
  for(const object of Object.values(data.objects)) visit(object);
}
export const geometryRenderer: ReadonlyRenderer = async (container, node, context) => {
  if (new TextEncoder().encode(node.text).byteLength > 512 * 1024) throw new Error("Geometry source exceeds preview budget");
  let shapes: Shape[];
  if (node.language === "stl") shapes = stlShapes(node.text);
  else {
    let data = JSON.parse(node.text);
    if (node.language === "topojson") {
      validateTopology(data);
      const {feature} = await import("topojson-client");
      if (context.signal.aborted) return;
      if (data.type !== "Topology" || !data.objects || Object.keys(data.objects).length > 1000) throw new Error("Invalid TopoJSON topology");
      data = {type: "FeatureCollection", features: Object.values(data.objects).map(object => feature(data, object as Parameters<typeof feature>[1]))};
    }
    shapes = geoShapes(data);
  }
  if (context.signal.aborted) return;
  const controller = new AbortController();
  const abort = () => controller.abort(); context.signal.addEventListener("abort", abort, {once: true});
  viewport(container, shapes, node.language === "stl", controller.signal);
  const details = document.createElement("details"), summary = document.createElement("summary"); setUIText(summary, "Source"); details.append(summary, context.renderDefault()); container.append(details);
  return {destroy() {controller.abort(); context.signal.removeEventListener("abort", abort); container.replaceChildren();}};
};
export const githubGeometryRenderers = Object.freeze({"fence:geojson": geometryRenderer, "fence:topojson": geometryRenderer, "fence:stl": geometryRenderer});
