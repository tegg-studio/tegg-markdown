// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {EditorState,StateEffect} from '@codemirror/state';
import {EditorView,Decoration} from '@codemirror/view';
import {markdown} from '@codemirror/lang-markdown';
import {captureCurrentLinkDraft,editCurrentLink,liveLinks} from './liveLinks';
import {resourceContext} from './editorHost';
const views:EditorView[]=[];
afterEach(()=>{views.splice(0).forEach(view=>view.destroy());vi.restoreAllMocks();document.body.replaceChildren();});
function fixture(source='[old](old.md)\n\nEnd',editing=true){
 const view=new EditorView({parent:document.body,state:EditorState.create({doc:source,selection:{anchor:2},extensions:[markdown(),resourceContext.of({documentPath:'',profile:'tegg'}),liveLinks]})});views.push(view);
 vi.spyOn(view,'coordsAtPos').mockReturnValue({left:20,right:30,top:20,bottom:40});
 if(editing)expect(editCurrentLink(view)).toBe(true);
 return view;
}
function button(label:string){return [...document.querySelectorAll<HTMLButtonElement>('.md-link-editor button')].find(button=>button.dataset.teggUiText===label)!;}
describe('actual dedicated link draft leases',()=>{
 it('keeps current fields and unfinished composition in the captured source-bound draft',()=>{
  const view=fixture(),draft=captureCurrentLinkDraft(view)!;expect(draft).not.toBeNull();expect(draft.current()).toBe(true);
  const field=draft.panel.querySelector<HTMLInputElement>('[data-tegg-ui-label="Link destination"]')!;field.value='local.md';field.dispatchEvent(new Event('input',{bubbles:true}));expect(draft.current()).toBe(true);
  field.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));expect(draft.current()).toBe(true);expect(view.state.doc.toString()).toBe('[old](old.md)\n\nEnd');
  field.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));expect(draft.current()).toBe(true);
 });
 it('revokes cancellation immediately and never reuses that lease after reopening the same source',()=>{
  const view=fixture(),old=captureCurrentLinkDraft(view)!;button('Cancel').click();expect(old.current()).toBe(false);expect(captureCurrentLinkDraft(view)).toBeNull();
  expect(editCurrentLink(view)).toBe(true);const next=captureCurrentLinkDraft(view)!;expect(next.panel).not.toBe(old.panel);expect(next.current()).toBe(true);expect(old.current()).toBe(false);expect(view.state.doc.toString()).toBe('[old](old.md)\n\nEnd');
 });
 it.each(['unrelated','range','target'])('revokes the old lease on %s source changes while retaining the actual dirty form',change=>{
  const view=fixture(),draft=captureCurrentLinkDraft(view)!,field=draft.panel.querySelector<HTMLInputElement>('[data-tegg-ui-label="Link destination"]')!;
  field.value='draft.md';field.dispatchEvent(new Event('input',{bubbles:true}));
  if(change==='unrelated')view.dispatch({changes:{from:view.state.doc.length,insert:' extra'}});
  else if(change==='range')view.dispatch({changes:{from:0,insert:'prefix '}});
  else view.dispatch({changes:{from:1,to:4,insert:'external'}});
  expect(draft.panel.isConnected).toBe(true);expect(field.value).toBe('draft.md');expect(draft.current()).toBe(false);
 });
 it('returns no draft for an actual read-only inspector or author-shaped impostor DOM',()=>{
  const view=fixture(undefined,false);view.dispatch({effects:[StateEffect.appendConfig.of(EditorView.decorations.of(Decoration.set([Decoration.mark({class:'cm-live-link'}).range(0,13)]))),StateEffect.appendConfig.of(EditorState.readOnly.of(true))]});
  const link=view.dom.querySelector<HTMLElement>('.cm-live-link')!;expect(link).not.toBeNull();link.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
  expect(document.querySelector('.md-link-popover:not(.md-link-editor)')).not.toBeNull();expect(captureCurrentLinkDraft(view)).toBeNull();
  const fake=document.createElement('dialog');fake.className='md-link-editor';fake.append(document.createElement('form'));document.body.append(fake);expect(captureCurrentLinkDraft(view)).toBeNull();
 });
 it('revokes the lease when its owning EditorView is destroyed',()=>{
  const view=fixture(),draft=captureCurrentLinkDraft(view)!;view.destroy();views.splice(views.indexOf(view),1);expect(draft.current()).toBe(false);expect(captureCurrentLinkDraft(view)).toBeNull();
 });
});
