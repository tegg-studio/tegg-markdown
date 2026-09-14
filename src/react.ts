import {createElement, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentType, type ReactPortal} from "react";
import {createPortal} from "react-dom";
import {TeggMarkdownReader} from "./sdkReader";
import type {ReaderHost, ReaderInput} from "./reader";
import type {TeggMarkdownEditor, EditorDocument, EditorHost, EditorMode} from "./editor";
import type {RenderContext, RenderNode, ReadonlyRenderers} from "./renderExtensions";
export type RendererProps = {node: RenderNode; context: RenderContext};
export type ReactRenderers = Partial<Record<keyof ReadonlyRenderers, ComponentType<RendererProps>>>;
type CommonProps = {className?: string; components?: ReactRenderers};
export type MarkdownReaderProps = CommonProps & {document: ReaderInput; host?: ReaderHost; onReady?(reader: TeggMarkdownReader): void};
export type MarkdownEditorProps = CommonProps & {document: EditorDocument; host?: EditorHost; mode?: EditorMode; onReady?(editor: TeggMarkdownEditor): void};
export type MarkdownReaderRef = {getInstance(): TeggMarkdownReader | null};
export type MarkdownEditorRef = {getInstance(): TeggMarkdownEditor | null};
function useSlots(components?: ReactRenderers) {
  const current = useRef(components); current.current = components;
  const alive = useRef(false);
  const [entries, setEntries] = useState<Array<{id: string; container: HTMLElement; node: RenderNode; context: RenderContext; kind: keyof ReadonlyRenderers}>>([]);
  useEffect(() => {alive.current = true; setEntries([]); return () => {alive.current = false;};}, []);
  const signature = Object.keys(components ?? {}).sort().join("|");
  const renderers = useMemo(() => Object.fromEntries(Object.keys(components ?? {}).map(kind => [kind, (container: HTMLElement, node: RenderNode, context: RenderContext) => {
    const id = crypto.randomUUID();
    if (alive.current) setEntries(old => [...old, {id, container, node, context, kind: kind as keyof ReadonlyRenderers}]);
    return {update(next: RenderNode) {if (alive.current) setEntries(old => old.map(item => item.id === id ? {...item, node: next} : item));},
      destroy() {if (alive.current) setEntries(old => old.filter(item => item.id !== id));}};
  }])) as ReadonlyRenderers, [signature]);
  const portals: ReactPortal[] = entries.flatMap(entry => {
    const Component = current.current?.[entry.kind];
    return Component ? [createPortal(createElement(Component, {node: entry.node, context: entry.context}), entry.container, entry.id)] : [];
  });
  return {renderers, portals};
}
export const MarkdownReader = forwardRef<MarkdownReaderRef, MarkdownReaderProps>(function MarkdownReader(props, ref) {
  const root = useRef<HTMLDivElement>(null), instance = useRef<TeggMarkdownReader | null>(null);
  const latest = useRef(props); latest.current = props;
  const slots = useSlots(props.components), currentSlots = useRef(slots.renderers); currentSlots.current = slots.renderers;
  useImperativeHandle(ref, () => ({getInstance: () => instance.current}), []);
  useEffect(() => {
    const host = new Proxy(latest.current.host ?? {}, {get: (_, key) => key === "renderers" ? {...latest.current.host?.renderers, ...currentSlots.current} : latest.current.host?.[key as keyof ReaderHost]});
    const reader = instance.current = new TeggMarkdownReader(root.current!, host);
    latest.current.onReady?.(reader);
    return () => {instance.current = null; reader.destroy();};
  }, []);
  useEffect(() => {
    const reader = instance.current; if (!reader) return;
    void reader.render(props.document).catch(error => latest.current.host?.onError?.(error));
  }, [props.document, slots.renderers]);
  useEffect(() => {instance.current?.setUI(props.host ?? {});}, [props.host?.locale, props.host?.messages]);
  return createElement("div", {className: props.className, style: {minWidth:0, minHeight:0}}, createElement("div", {ref: root, style:{height:props.host?.layout === "host" ? "auto" : "100%", minHeight:0, minWidth:0}}), ...slots.portals);
});
export const MarkdownEditor = forwardRef<MarkdownEditorRef, MarkdownEditorProps>(function MarkdownEditor(props, ref) {
  const root = useRef<HTMLDivElement>(null), instance = useRef<TeggMarkdownEditor | null>(null);
  const latest = useRef(props); latest.current = props;
  const slots = useSlots(props.components), currentSlots = useRef(slots.renderers); currentSlots.current = slots.renderers;
  useImperativeHandle(ref, () => ({getInstance: () => instance.current}), []);
  useEffect(() => {
    let active = true;
    void import("./editor").then(({TeggMarkdownEditor}) => {
      if (!active) return;
      const host = new Proxy(latest.current.host ?? {}, {get: (_, key) => key === "renderers" ? {...latest.current.host?.renderers, ...currentSlots.current} : latest.current.host?.[key as keyof EditorHost]});
      const editor = instance.current = new TeggMarkdownEditor(root.current!, latest.current.document, host, latest.current.mode);
      latest.current.onReady?.(editor);
    }).catch(error => {if (active) latest.current.host?.onError?.(error);});
    return () => {active = false; const editor = instance.current; instance.current = null; editor?.destroy();};
  }, []);
  useEffect(() => {instance.current?.update(props.document);}, [props.document]);
  useEffect(() => {if (props.mode) instance.current?.setMode(props.mode);}, [props.mode]);
  useEffect(() => {instance.current?.setUI(props.host ?? {});}, [props.host?.locale, props.host?.messages]);
  return createElement("div", {className: props.className, style: {minWidth:0, minHeight:0}}, createElement("div", {ref: root, style:{height:props.host?.layout === "host" ? "auto" : "100%", minHeight:0, minWidth:0}}), ...slots.portals);
});
