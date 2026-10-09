// @vitest-environment jsdom
import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {TeggMarkdownEditor} from './editor';
import {attachEditingUI} from './editingUI';
import {katexEngine} from './engines/katex';
import type {RenderEngines} from './renderEngines';
import {prepareEditingLeave} from './editingLeave';
const cleanup:Array<()=>void>=[];
beforeAll(()=>{Range.prototype.getClientRects??=()=>[] as unknown as DOMRectList;Range.prototype.getBoundingClientRect??=()=>new DOMRect();});
afterEach(()=>{cleanup.splice(0).reverse().forEach(stop=>stop());vi.restoreAllMocks();document.body.replaceChildren();});
function fixture(engines:RenderEngines,source='$x$'){
 const root=document.body.appendChild(document.createElement('div')),editor=new TeggMarkdownEditor(root,{documentId:'syntax',revision:'1',source,profile:'tegg'},{engines},'source'),ui=attachEditingUI(editor.editing,root);cleanup.push(()=>editor.destroy(),()=>ui.destroy());
 ui.openObject('math',{from:0,to:source.length});const field=ui.element.querySelector<HTMLTextAreaElement>('.tegg-object-body')!,done=ui.element.querySelector<HTMLButtonElement>('[data-label="Apply"]')!;
 const input=(value:string)=>{field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));};return {editor,ui,root,field,done,input};
}
it('uses actual KaTeX errors to block Done and guarded Complete, keeps input, then accepts corrected expression in one Undo',async()=>{
 const f=fixture({math:katexEngine});await vi.waitFor(()=>expect(f.done.disabled).toBe(false));f.input('\\frac{');expect(f.done.disabled).toBe(true);await vi.waitFor(()=>expect(f.field.getAttribute('aria-invalid')).toBe('true'));
 expect(f.editor.source).toBe('$x$');expect(prepareEditingLeave(f.editor.view,f.root,f.editor.editing)).toBe(false);const complete=f.ui.element.querySelector<HTMLButtonElement>('[data-label="Complete and continue"]')!;expect(complete.disabled).toBe(true);complete.click();expect(f.field.value).toBe('\\frac{');expect(f.editor.source).toBe('$x$');
 f.ui.element.querySelector<HTMLButtonElement>('[data-label="Keep editing"]')!.click();f.input('\\frac{a}{b}');await vi.waitFor(()=>expect(f.done.disabled).toBe(false));expect(f.field.hasAttribute('aria-invalid')).toBe(false);f.done.click();expect(f.editor.source).toBe('$\\frac{a}{b}$');expect(f.editor.command('undo')).toBe(true);expect(f.editor.source).toBe('$x$');
});
it('allows a retained expression when validation is unavailable and ignores a late result from another draft or panel',async()=>{
 const results:Array<(outcome:any)=>void>=[],math=Object.assign(()=>'<span>preview</span>',{validate:()=>new Promise<any>(resolve=>results.push(resolve))}),f=fixture({math});
 expect(f.done.disabled).toBe(true);await vi.waitFor(()=>expect(results).toHaveLength(1));f.input('new');await vi.waitFor(()=>expect(results).toHaveLength(2));results[0]({status:'invalid',message:'Old error'});await Promise.resolve();expect(f.done.disabled).toBe(true);expect(f.field.hasAttribute('aria-invalid')).toBe(false);
 results[1]({status:'unavailable',reason:'resource',message:'Offline'});await vi.waitFor(()=>expect(f.done.disabled).toBe(false));f.done.click();expect(f.editor.source).toBe('$new$');
 f.ui.openObject('math',{from:0,to:f.editor.source.length});const old=f.ui.element.querySelector('.tegg-editing-panel')!;await vi.waitFor(()=>expect(results).toHaveLength(3));f.ui.close();f.ui.openSearch();results[2]({status:'invalid',message:'Closed error'});await Promise.resolve();expect(old.querySelector('.tegg-technical-error')).toBeNull();expect(f.ui.element.querySelector('[aria-label="Find"]')).not.toBeNull();
});
it('validates controlled HTML math using only data-tex while preserving its wrapper and IME guard',async()=>{
 const calls:string[]=[],math=Object.assign(()=>'<span>preview</span>',{validate:(body:string)=>{calls.push(body);return {status:'valid' as const};}}),source='<span class="author" data-tegg-math="inline" data-tex="x &amp; y"></span>',f=fixture({math},source);
 await vi.waitFor(()=>expect(f.done.disabled).toBe(false));expect(calls).toEqual(['x & y']);f.input('z');await vi.waitFor(()=>expect(f.done.disabled).toBe(false));f.field.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));f.done.click();expect(f.editor.source).toBe(source);f.field.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));f.done.click();expect(f.editor.source).toBe(source.replace('x &amp; y','z'));
});

it('prevents pointer actions from ending composition or stealing the literal field selection',()=>{
 const f=fixture({});f.field.focus();f.field.setSelectionRange(0,1,'backward');f.field.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
 for(const type of ['pointerdown','mousedown']){const event=new MouseEvent(type,{bubbles:true,cancelable:true});f.done.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);expect(document.activeElement).toBe(f.field);expect(f.field.selectionDirection).toBe('backward');}f.done.click();expect(f.editor.source).toBe('$x$');
});
