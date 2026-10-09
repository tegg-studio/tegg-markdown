// @vitest-environment jsdom
import {afterEach,describe,expect,it} from 'vitest';
import {Compartment,EditorState,StateEffect} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history,undo} from '@codemirror/commands';
import {attachHtmlDirectEditing,captureActiveHtmlDirectInput} from './htmlDirectEditing';
import {resourceContext} from './editorHost';
const cleanup:Array<()=>void>=[];
afterEach(()=>{cleanup.splice(0).reverse().forEach(dispose=>dispose());document.body.replaceChildren();});
function fixture(source='<p data-authored="keep">Old <strong>text</strong> &amp; entity</p>'){
 const context=new Compartment(),initialContext={documentPath:'one.md',profile:'tegg' as const};
 const parent=document.body.appendChild(document.createElement('div')),view=new EditorView({parent,state:EditorState.create({doc:'Before\n'+source+'\nAfter',extensions:[history(),context.of(resourceContext.of(initialContext))]})});
 const wrapper=document.createElement('div');wrapper.innerHTML=source;wrapper.tabIndex=0;view.dom.append(wrapper);const handle=attachHtmlDirectEditing(wrapper,view,7,source)!;expect(handle).not.toBeNull();
 cleanup.push(()=>view.destroy(),()=>handle.dispose());return {source,view,wrapper,handle,context,initialContext};
}
function focus(wrapper:HTMLElement){wrapper.focus();const range=document.createRange();range.selectNodeContents(wrapper.querySelector('p')!);range.collapse(false);const selection=document.getSelection()!;selection.removeAllRanges();selection.addRange(range);}
describe('real safe-HTML continuous input snapshots',()=>{
 it('ignores author-shaped contenteditable DOM without an SDK editing instance',()=>{
  const parent=document.body.appendChild(document.createElement('div')),view=new EditorView({parent,state:EditorState.create({doc:'Authored text'})});cleanup.push(()=>view.destroy());
  const author=document.createElement('div');author.className='cm-html-direct-editor footnote-body';author.setAttribute('contenteditable','true');author.tabIndex=0;author.textContent='Authored text';view.dom.append(author);author.focus();
  expect(document.activeElement).toBe(author);expect(captureActiveHtmlDirectInput(view)).toBeNull();expect(view.state.doc.toString()).toBe('Authored text');
 });
 it('captures only the actual focused editing wrapper and never its authored lookalike',()=>{
  const f=fixture('<p class="cm-html-direct-editor">Original text</p>');expect(captureActiveHtmlDirectInput(f.view)).toBeNull();focus(f.wrapper);const snapshot=captureActiveHtmlDirectInput(f.view)!;
  expect(snapshot.panel).toBe(f.wrapper);expect(snapshot.panel).not.toBe(f.wrapper.querySelector('p'));expect(snapshot.current()).toBe(true);expect(f.view.state.doc.toString()).toBe('Before\n'+f.source+'\nAfter');
 });
 it('continues the same input through actual source commits and keeps authored bytes and Undo',()=>{
  const f=fixture();focus(f.wrapper);const snapshot=captureActiveHtmlDirectInput(f.view)!;
  f.wrapper.querySelector('strong')!.textContent='first';f.wrapper.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));expect(snapshot.current()).toBe(true);
  f.wrapper.querySelector('strong')!.textContent='second';f.wrapper.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));expect(snapshot.current()).toBe(true);
  expect(f.view.state.doc.toString()).toBe('Before\n'+f.source.replace('<strong>text</strong>','<strong>second</strong>')+'\nAfter');expect(undo(f.view)).toBe(true);expect(f.view.state.doc.toString()).toBe('Before\n'+f.source+'\nAfter');
 });
 it('retains composition in the same actual input until the completed source is committed',async()=>{
  const f=fixture();focus(f.wrapper);const snapshot=captureActiveHtmlDirectInput(f.view)!;
  f.wrapper.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));f.wrapper.querySelector('strong')!.textContent='中文';f.wrapper.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',isComposing:true}));
  expect(snapshot.current()).toBe(true);expect(f.view.state.doc.toString()).toBe('Before\n'+f.source+'\nAfter');f.wrapper.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));await Promise.resolve();
  expect(snapshot.current()).toBe(true);expect(f.view.state.doc.toString()).toBe('Before\n'+f.source.replace('<strong>text</strong>','<strong>中文</strong>')+'\nAfter');
 });
 it('permanently revokes an old input after a real focus move even without polling during the interruption',()=>{
  const f=fixture();focus(f.wrapper);const old=captureActiveHtmlDirectInput(f.view)!,outside=document.body.appendChild(document.createElement('button'));outside.focus();focus(f.wrapper);
  expect(document.activeElement).toBe(f.wrapper);expect(old.current()).toBe(false);expect(old.current()).toBe(false);const fresh=captureActiveHtmlDirectInput(f.view)!;expect(fresh.current()).toBe(true);expect(fresh.panel).toBe(old.panel);
 });
 it.each(['button','input'])('does not let existing author %s focus preserve a text-input lease',tag=>{
  const controlSource=tag==='input'?'<input tabindex="0" value="control">':'<button tabindex="0">control</button>',f=fixture('<p>Original '+controlSource+'</p>');focus(f.wrapper);const old=captureActiveHtmlDirectInput(f.view)!,control=f.wrapper.querySelector<HTMLElement>(tag)!;control.focus();
  expect(captureActiveHtmlDirectInput(f.view)).toBeNull();focus(f.wrapper);expect(old.current()).toBe(false);expect(captureActiveHtmlDirectInput(f.view)?.current()).toBe(true);expect(f.view.state.doc.toString()).toBe('Before\n'+f.source+'\nAfter');
 });
 it('revokes external changes outside the mapped HTML range without reviving on Undo',()=>{
  const f=fixture();focus(f.wrapper);const old=captureActiveHtmlDirectInput(f.view)!;f.view.dispatch({changes:{from:f.view.state.doc.length,insert:' external'}});expect(old.current()).toBe(false);expect(captureActiveHtmlDirectInput(f.view)?.current()).toBe(true);expect(old.current()).toBe(false);expect(undo(f.view)).toBe(true);
  expect(old.current()).toBe(false);expect(f.view.state.doc.toString()).toBe('Before\n'+f.source+'\nAfter');
 });
 it('revokes a changed document resource context even when its source text is identical',()=>{
  const f=fixture();focus(f.wrapper);const old=captureActiveHtmlDirectInput(f.view)!;f.view.dispatch({effects:f.context.reconfigure(resourceContext.of({documentPath:'two.md',profile:'tegg'}))});expect(old.current()).toBe(false);expect(captureActiveHtmlDirectInput(f.view)).toBeNull();
  f.view.dispatch({effects:f.context.reconfigure(resourceContext.of(f.initialContext))});expect(old.current()).toBe(false);expect(f.view.state.doc.toString()).toBe('Before\n'+f.source+'\nAfter');
 });

 it('preserves same-authority reconfiguration and rejects a mutated or replaced actual resource identity',()=>{
  const f=fixture();focus(f.wrapper);const old=captureActiveHtmlDirectInput(f.view)!;f.view.dispatch({effects:f.context.reconfigure(resourceContext.of({...f.initialContext}))});expect(old.current()).toBe(true);expect(captureActiveHtmlDirectInput(f.view)?.current()).toBe(true);
  f.initialContext.documentPath='other.md';f.view.dispatch({effects:f.context.reconfigure(resourceContext.of(f.initialContext))});expect(old.current()).toBe(false);expect(captureActiveHtmlDirectInput(f.view)).toBeNull();
 });
 it('does not revive an old lease when a new valid input follows an external source change',()=>{
  const f=fixture();focus(f.wrapper);const old=captureActiveHtmlDirectInput(f.view)!;f.view.dispatch({changes:{from:f.view.state.doc.length,insert:' external'}});
  f.wrapper.querySelector('strong')!.textContent='continued';f.wrapper.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));expect(old.current()).toBe(false);
  const fresh=captureActiveHtmlDirectInput(f.view)!;expect(fresh.current()).toBe(true);expect(f.view.state.doc.toString()).toBe('Before\n'+f.source.replace('<strong>text</strong>','<strong>continued</strong>')+'\nAfter external');
 });
 it('revokes destroyed instances and refuses actual read-only or disabled text inputs',()=>{
  const f=fixture();focus(f.wrapper);const old=captureActiveHtmlDirectInput(f.view)!;f.handle.dispose();expect(old.current()).toBe(false);expect(captureActiveHtmlDirectInput(f.view)).toBeNull();
  const next=fixture();focus(next.wrapper);const before=captureActiveHtmlDirectInput(next.view)!;next.view.dispatch({effects:StateEffect.appendConfig.of(EditorState.readOnly.of(true))});expect(before.current()).toBe(false);expect(captureActiveHtmlDirectInput(next.view)).toBeNull();
 });
});
