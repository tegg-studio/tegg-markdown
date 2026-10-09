// @vitest-environment jsdom
import { afterEach,beforeAll,describe,it,expect,vi } from 'vitest';
import { imagePlaceholder } from './renderInteraction';
import { bindUI } from './uiContext';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { resourceContext } from './editorHost';
import { livePreview } from './livePreview';
const mounted:EditorView[]=[];
beforeAll(()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}});
 Range.prototype.getClientRects??=()=>({length:0,item:()=>null,[Symbol.iterator]:function*(){}}) as DOMRectList;
 Range.prototype.getBoundingClientRect??=()=>new DOMRect();
});
afterEach(()=>{mounted.splice(0).forEach(v=>v.destroy());document.body.replaceChildren();});
describe('approved S13-6 image failure contract',()=>{
 it.each(['en-US','zh-CN'] as const)('reports an unknown image failure and preserves authored alt in %s',locale=>{
  const root=document.createElement('div');document.body.append(root);root.append(imagePlaceholder('Author image description'));const ui=bindUI(root,{locale});
  expect(root.querySelector('strong')?.textContent).toBe(locale==='zh-CN'?'\u56fe\u7247\u52a0\u8f7d\u5931\u8d25':'Image loading failed');
  expect(root.querySelector('span span')?.textContent).toBe('Author image description');
  expect(root.querySelector('[role="status"]')).not.toBeNull();ui.destroy();
 });
 it('never presents a raw resource URL as an empty author alt in a failed Live Edit image',()=>{
  const source='![](private.png?token=fixture-only-secret)\n\nAfter\n';const root=document.createElement('div');document.body.append(root);
  const view=new EditorView({state:EditorState.create({doc:source,selection:{anchor:source.length},extensions:[markdown(),resourceContext.of({documentPath:'/docs/note.md',profile:'tegg',resolveImage:src=>'app-file:///docs/'+src}),livePreview]}),parent:root});mounted.push(view);ensureSyntaxTree(view.state,view.state.doc.length,1000);view.dispatch({});
  const image=root.querySelector<HTMLImageElement>('.cm-live-image img');expect(image).not.toBeNull();expect(image!.getAttribute('src')).toBeTruthy();image!.dispatchEvent(new Event('error'));
  const fallback=root.querySelector<HTMLElement>('.cm-live-image-fallback');expect(fallback).not.toBeNull();expect(fallback!.hidden).toBe(false);expect(fallback!.textContent).not.toContain('fixture-only-secret');expect(fallback!.querySelector('span')?.textContent).toBe('');expect(view.state.doc.toString()).toBe(source);
 });
});
