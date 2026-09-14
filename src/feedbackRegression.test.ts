// @vitest-environment jsdom
import {it,expect} from 'vitest';
import {sanitizeDiagramSvg} from './renderKit';
import {getSupportedCommands,TeggMarkdownEditor} from './editor';
import {bindUI,setUIText} from './uiContext';
it('retains local SVG animation CSS while rejecting other at-rules and resource channels',()=>{
 const svg=(css:string)=>sanitizeDiagramSvg(`<svg xmlns="http://www.w3.org/2000/svg"><style>${css}</style><rect class="node" width="10" height="10"/></svg>`);
 expect(svg('@keyframes dash {to{stroke-dashoffset:0}} .node{fill:#ececff;stroke:#333}').querySelector('style')).not.toBeNull();
 for(const css of ['@import "https://example.com/x";','@IMPORT url(https://example.com/x);','@font-face{src:url(https://example.com/x)}','@media all{.node{fill:red}}','.node{fill:u/**/rl(https://example.com/x)}','@keyframes x{to{fill:url(https://example.com/x)}}','.node{fill:u\\72l(https://example.com/x)}']) expect(svg(css).querySelector('style')).toBeNull();
 expect(svg('.node{fill:url(#paint)}').querySelector('style')).not.toBeNull();
});
it('exposes profile support separately from transient editing state without changing drafts',()=>{
 const root=document.body.appendChild(document.createElement('div'));
 const editor=new TeggMarkdownEditor(root,{documentId:'d',revision:'1',source:'hello',profile:'gfm'},{engines:{}},'source');
 try {
  expect(getSupportedCommands('github')).not.toContain('wikilink');expect(getSupportedCommands('gfm')).not.toContain('mathBlock');
  expect(editor.state.commands).toBe(getSupportedCommands('gfm'));expect(Object.isFrozen(editor.state.commands)).toBe(true);
  expect(editor.commandStatus('mathBlock').reason).toBe('unsupported-profile');expect(editor.command('mathBlock')).toBe(false);
  expect(editor.commandStatus('undo').reason).toBe('empty-history');
  const snapshot=editor.snapshot();editor.commandStatus('bold');expect(editor.snapshot()).toEqual(snapshot);
  editor.setMode('reader');expect(editor.commandStatus('bold')).toEqual({supported:true,enabled:false,reason:'editing-disabled'});
 }finally{editor.destroy();root.remove();}
});
it('updates table quantity translations with the instance language',()=>{
 const root=document.body.appendChild(document.createElement('div')), label=root.appendChild(document.createElement('span'));const ui=bindUI(root,{locale:'en-US'});
 setUIText(label,'{rows} row × {columns} columns',{rows:'1',columns:'2'});expect(label.textContent).toBe('1 row × 2 columns');ui.update({locale:'zh-CN'});expect(label.textContent).toBe('1 行 × 2 列');ui.update({locale:'en-US'});expect(label.textContent).toBe('1 row × 2 columns');ui.destroy();root.remove();
});
