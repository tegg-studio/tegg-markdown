// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history,undo,undoDepth,redoDepth} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {EditingController,type EditingIdentity} from './editingController';
import {attachEditingUI} from './editingUI';
import {liveLinks} from './liveLinks';
import {resourceContext} from './editorHost';
import {bindUI} from './uiContext';
import {createHtmlPreview} from './renderKit';
import {attachHtmlTableEditing,commitHtmlTableDrafts,executeHtmlTableCommand} from './htmlTableWidget';

// DOM events here prove authority and source semantics; they are not physical touch evidence.
const disposals:Array<()=>void>=[];
beforeEach(()=>vi.spyOn(window.navigator,'platform','get').mockReturnValue('MacIntel'));
afterEach(()=>{disposals.splice(0).reverse().forEach(dispose=>dispose());vi.restoreAllMocks();document.body.replaceChildren();});
const source="<table class='keep'><tr><td><p>Before <a href='https://example.com/?x=1&amp;y=2' rel='author' title='keep &amp; exact'>A&amp;B</a> after</p></td><td>next</td></tr></table>";
function fixture(raw=source,readonly=false){
 const parent=document.createElement('div'),overlays=document.createElement('div');document.body.append(parent,overlays);
 const prefix='Caret A\n\n',full=prefix+raw+'\n\nAfter';let identity:EditingIdentity={documentId:'note',generation:'g1',profile:'tegg',mode:'live',readOnly:readonly};
 const view=new EditorView({parent,state:EditorState.create({doc:full,selection:{anchor:2},extensions:[history(),markdown({extensions:GFM}),liveLinks,resourceContext.of({documentPath:'/notes/note.md',profile:'tegg'}),EditorState.readOnly.of(readonly)]})});
 const binding=bindUI(view.dom,{mobile:false,overlayContainer:overlays}),controller=new EditingController(view,{identity:()=>identity}),ui=attachEditingUI(controller,overlays,{toolbar:false});
 const panel=createHtmlPreview({kind:'html',source:raw,display:'block'});view.dom.append(panel);const dispose=attachHtmlTableEditing(panel,view,prefix.length,raw)!;
 const cells=Array.from(panel.querySelectorAll<HTMLTableCellElement>('td')),opened:string[]=[];view.dom.addEventListener('tegg-open-link',event=>{event.preventDefault();opened.push((event as CustomEvent<string>).detail);});
 disposals.push(()=>{panel.remove();dispose();ui.destroy();controller.destroy();binding.destroy();view.destroy();});
 return{view,panel,cells,full,raw,prefix,opened,overlays,ui,controller,setIdentity:(next:EditingIdentity)=>{identity=next;}};
}
type F=ReturnType<typeof fixture>;
const event=(node:HTMLElement,type:string,options:MouseEventInit={})=>{const e=new MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:10,clientY:10,...options});node.dispatchEvent(e);return e;};
const key=(node:HTMLElement,name:string)=>node.dispatchEvent(new KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true}));
const anchor=(f:F)=>f.cells[0].querySelector<HTMLAnchorElement>('a')!;
const draft=(f:F)=>{event(anchor(f),'click');key(f.cells[0],'F2');expect(f.cells[0].contentEditable).toBe('true');return anchor(f);};
const place=(node:Node,offset:number)=>{const range=document.createRange();range.setStart(node,offset);range.collapse(true);const selection=document.getSelection()!;selection.removeAllRanges();selection.addRange(range);return range;};
const menu=(f:F,a=anchor(f))=>{event(a,'contextmenu');const panel=f.overlays.querySelector<HTMLElement>('.md-link-popover');expect(panel).not.toBeNull();return panel!;};
const button=(panel:HTMLElement,text:string)=>{const result=[...panel.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text);expect(result).toBeTruthy();return result!;};
const unchanged=(f:F)=>{expect(f.view.state.doc.toString()).toBe(f.full);expect(undoDepth(f.view.state)).toBe(0);expect(redoDepth(f.view.state)).toBe(0);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

describe('Live HTML table links follow S18-A2 within the real cell scope',()=>{
 it.each([false,true])('preview ordinary and Command click select a cell without navigation (readonly=%s)',readonly=>{
  const f=fixture(source,readonly),selection=f.view.state.selection;
  event(anchor(f),'pointerdown');const ordinary=event(anchor(f),'click');expect(ordinary.defaultPrevented).toBe(true);expect(f.cells[0].classList.contains('md-html-cell-selected')).toBe(true);expect(f.cells[0].contentEditable).not.toBe('true');
  event(anchor(f),'pointerdown',{metaKey:true});event(anchor(f),'click',{metaKey:true});expect(f.opened).toEqual([]);expect(f.view.state.selection).toBe(selection);unchanged(f);
 });
 it('the original anchor enters the existing cell editor on double click and Cancel restores it',()=>{
  const f=fixture(),original=anchor(f);event(original,'click');event(original,'dblclick');expect(f.cells[0].contentEditable).toBe('true');expect(anchor(f)).not.toBe(original);key(f.cells[0],'Escape');expect(anchor(f)).toBe(original);expect(f.opened).toEqual([]);unchanged(f);
 });
 it('an ordinary click in an editable label keeps the actual DOM caret and only cancels navigation',()=>{
  const f=fixture(),a=draft(f),text=a.firstChild!,range=place(text,1),selection=f.view.state.selection;
  expect(event(a,'pointerdown').defaultPrevented).toBe(false);expect(event(a,'click').defaultPrevented).toBe(true);expect(document.getSelection()!.getRangeAt(0)).toBe(range);expect(document.getSelection()!.anchorOffset).toBe(1);expect(f.view.state.selection).toBe(selection);expect(f.opened).toEqual([]);unchanged(f);
 });
 it('actual editable Command click opens the source destination without moving either caret or changing Source',()=>{
  const f=fixture(),a=draft(f),range=place(a.firstChild!,1),selection=f.view.state.selection;
  expect(event(a,'pointerdown',{metaKey:true}).defaultPrevented).toBe(true);event(a,'click',{metaKey:true});expect(f.opened).toEqual(['https://example.com/?x=1&y=2']);expect(document.getSelection()!.getRangeAt(0)).toBe(range);expect(f.view.state.selection).toBe(selection);unchanged(f);
 });
 it('Control click does not open and a stationary nonempty label selection can open the existing menu',()=>{
  const f=fixture(),a=draft(f);event(a,'pointerdown',{ctrlKey:true});event(a,'click',{ctrlKey:true});expect(f.opened).toEqual([]);
  const range=document.createRange();range.selectNodeContents(a);document.getSelection()!.removeAllRanges();document.getSelection()!.addRange(range);const actions=menu(f);
  expect(actions.querySelector('.md-link-destination')!.textContent).toContain('https://example.com/?x=1&y=2');expect(button(actions,'Edit link').disabled).toBe(false);expect(button(actions,'Copy link address').classList.contains('md-link-text-action')).toBe(false);expect(document.getSelection()!.getRangeAt(0)).toBe(range);unchanged(f);
 });
 it('menu Open reuses the source-backed safe route and does not finish a dirty cell',()=>{
  const f=fixture(),a=draft(f);f.cells[0].querySelector('p')!.firstChild!.textContent='Changed ';f.cells[0].dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
  const actions=menu(f);const open=actions.querySelector<HTMLButtonElement>('.md-link-destination')!;expect(event(open,'pointerdown').defaultPrevented).toBe(true);open.click();expect(f.opened).toEqual(['https://example.com/?x=1&y=2']);expect(f.cells[0].contentEditable).toBe('true');expect(f.cells[0].querySelector('p')!.textContent).toContain('Changed');unchanged(f);key(f.cells[0],'Escape');expect(anchor(f).outerHTML).toBe("<a href=\"https://example.com/?x=1&amp;y=2\" rel=\"author\" title=\"keep &amp; exact\">A&amp;B</a>");unchanged(f);
 });
 it('menu Copy uses a completion promise and ignores success after the cell is canceled',async()=>{
  const f=fixture(),a=draft(f);let complete!:(value:void)=>void;let copied='';f.overlays.addEventListener('tegg-copy-text',e=>{e.preventDefault();copied=(e as CustomEvent<string>).detail;(e as Event&{completion?:Promise<void>}).completion=new Promise(resolve=>{complete=resolve;});});
  const actions=menu(f,a);button(actions,'Copy link address').click();expect(copied).toBe('https://example.com/?x=1&y=2');expect(actions.textContent).not.toContain('Copied');key(f.cells[0],'Escape');complete();await tick();expect(actions.textContent).not.toContain('Copied');expect(f.overlays.querySelector('.md-link-popover')).toBeNull();unchanged(f);
 });
 it('menu Copy reports success only after ACK while the actual owner remains current',async()=>{
  const f=fixture();draft(f);let complete!:(value:void)=>void;f.overlays.addEventListener('tegg-copy-text',e=>{e.preventDefault();(e as Event&{completion?:Promise<void>}).completion=new Promise(resolve=>{complete=resolve;});});const actions=menu(f);button(actions,'Copy link address').click();expect(actions.textContent).not.toContain('Copied');complete();await tick();expect(actions.querySelector('[role=status]')!.textContent).toBe('Copied');unchanged(f);
 });
 it('entering an unchanged rich HTML cell does not insert link actions, text or spacing into its authored content',()=>{
  const f=fixture(),original=anchor(f),html=f.cells[0].innerHTML,selection=f.view.state.selection,a=draft(f);
  expect(f.cells[0].textContent).toBe('Before A&B after');expect(f.cells[0].innerHTML).toBe(html);expect(f.cells[0].querySelector('.md-html-object-actions')).toBeNull();
  expect(a.nextSibling?.nodeType).toBe(Node.TEXT_NODE);expect(a.nextSibling?.textContent).toBe(' after');expect(f.view.state.selection).toBe(selection);expect(f.opened).toEqual([]);unchanged(f);
  key(f.cells[0],'Escape');expect(anchor(f)).toBe(original);expect(f.cells[0].innerHTML).toBe(html);expect(f.view.state.selection).toBe(selection);unchanged(f);
 });
 it('the existing mapped link menu still opens its child form and Cancel preserves the exact authored cell without inline actions',()=>{
  const f=fixture(),original=anchor(f),html=f.cells[0].innerHTML,selection=f.view.state.selection,a=draft(f);button(menu(f,a),'Edit link').click();
  const forms=f.overlays.querySelectorAll<HTMLElement>('.tegg-editing-panel:not([hidden])');expect(forms.length).toBe(1);expect(forms[0].textContent).toContain('Edit link');expect(forms[0].querySelector<HTMLInputElement>('input')!.value).toBe('A&B');const target=forms[0].querySelector<HTMLInputElement>('input[aria-label="Target"]')!;expect(target).not.toBeNull();target.value='https://unapplied.example/?child=1';target.dispatchEvent(new Event('input',{bubbles:true}));expect(target.value).toBe('https://unapplied.example/?child=1');unchanged(f);
  button(forms[0],'Cancel').click();expect(f.overlays.querySelector('.tegg-editing-panel:not([hidden])')).toBeNull();expect(f.cells[0].contentEditable).toBe('true');expect(anchor(f)).toBe(a);expect(f.cells[0].innerHTML).toBe(html);expect(f.cells[0].textContent).toBe('Before A&B after');expect(f.cells[0].querySelector('.md-html-object-actions')).toBeNull();expect(f.view.state.selection).toBe(selection);expect(f.opened).toEqual([]);unchanged(f);
  key(f.cells[0],'Escape');expect(anchor(f)).toBe(original);expect(f.cells[0].innerHTML).toBe(html);expect(f.view.state.selection).toBe(selection);unchanged(f);
 });
 it('mapped Edit opens the existing literal link form and never synthesizes a source range',()=>{
  const f=fixture();draft(f);button(menu(f),'Edit link').click();const forms=f.overlays.querySelectorAll<HTMLElement>('.tegg-editing-panel:not([hidden])');expect(forms.length).toBe(1);expect(forms[0].textContent).toContain('Edit link');expect(forms[0].querySelector<HTMLInputElement>('input')!.value).toBe('A&B');unchanged(f);f.ui.captureActiveDrafts().forEach(entry=>expect(entry.current()).toBe(true));
 });
 it('author-shaped inserted anchors have no source mapping and cannot open or create a menu',()=>{
  const f=fixture();draft(f);const fake=document.createElement('a');fake.href='https://fake.example';fake.className='cm-live-link';fake.textContent='fake';f.cells[0].append(fake);event(fake,'pointerdown',{metaKey:true});event(fake,'click',{metaKey:true});event(fake,'contextmenu');expect(f.opened).toEqual([]);expect(f.overlays.querySelector('.md-link-popover')).toBeNull();unchanged(f);
 });
 it('composition rejects explicit navigation and menu opening and does not replay on end',()=>{
  const f=fixture(),a=draft(f),range=place(a.firstChild!,1);f.cells[0].dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));expect(event(a,'pointerdown',{metaKey:true}).defaultPrevented).toBe(true);event(a,'click',{metaKey:true});event(a,'contextmenu');expect(f.opened).toEqual([]);expect(f.overlays.querySelector('.md-link-popover')).toBeNull();expect(document.getSelection()!.getRangeAt(0)).toBe(range);f.cells[0].dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));expect(f.opened).toEqual([]);unchanged(f);
 });
 it('composition permanently revokes a captured owned Command intent and only a genuine next pointer can open',()=>{
  const f=fixture(),a=draft(f),range=place(a.firstChild!,1),selection=f.view.state.selection;event(a,'pointerdown',{metaKey:true});
  f.cells[0].dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));f.cells[0].dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));event(a,'click',{metaKey:true});
  expect(f.opened).toEqual([]);expect(document.getSelection()!.getRangeAt(0)).toBe(range);expect(f.view.state.selection).toBe(selection);unchanged(f);
  event(a,'pointerdown',{metaKey:true});event(a,'click',{metaKey:true});expect(f.opened).toEqual(['https://example.com/?x=1&y=2']);expect(document.getSelection()!.getRangeAt(0)).toBe(range);expect(f.view.state.selection).toBe(selection);unchanged(f);
 });
 it('a dragged or canceled pointer does not open or expose actions',()=>{
  const f=fixture(),a=draft(f);event(a,'pointerdown',{metaKey:true});event(a,'pointermove',{clientX:30,buttons:1});event(a,'click',{metaKey:true});event(a,'contextmenu');expect(f.opened).toEqual([]);expect(f.overlays.querySelector('.md-link-popover')).toBeNull();event(a,'pointerdown');event(a,'pointercancel');event(a,'contextmenu');expect(f.overlays.querySelector('.md-link-popover')).toBeNull();unchanged(f);
 });
 it('the actual source mapping rather than a mutated preview href controls explicit opening',()=>{
  const f=fixture(),a=draft(f);a.href='https://injected.example';event(a,'pointerdown',{metaKey:true});event(a,'click',{metaKey:true});expect(f.opened).toEqual(['https://example.com/?x=1&y=2']);unchanged(f);
 });
 it('an explicit click requires a real current pointerdown and rejects replaced document identity',()=>{
  const f=fixture(),a=draft(f);event(a,'click',{metaKey:true});expect(f.opened).toEqual([]);event(a,'pointerdown',{metaKey:true});f.setIdentity({documentId:'replacement',generation:'g2',profile:'tegg',mode:'live'});event(a,'click',{metaKey:true});expect(f.opened).toEqual([]);unchanged(f);
 });
 it.each(['identity','resource'] as const)('HTML compatibility mousedown cannot renew a stale %s pointer lease, and a genuine next pointer works',kind=>{
  const f=fixture(),a=draft(f),range=place(a.firstChild!,1),selection=f.view.state.selection;event(a,'pointerdown',{metaKey:true});
  if(kind==='identity')f.setIdentity({documentId:'note',generation:'g2',profile:'tegg',mode:'live'});else f.view.state.facet(resourceContext).documentPath='/notes/other.md';
  event(a,'mousedown',{metaKey:true});event(a,'pointerup',{metaKey:true});event(a,'mouseup',{metaKey:true});event(a,'click',{metaKey:true});expect(f.opened).toEqual([]);expect(document.getSelection()!.getRangeAt(0)).toBe(range);expect(f.view.state.selection).toBe(selection);unchanged(f);
  event(a,'pointerdown',{metaKey:true});event(a,'mousedown',{metaKey:true});event(a,'pointerup',{metaKey:true});event(a,'mouseup',{metaKey:true});event(a,'click',{metaKey:true});expect(f.opened).toEqual(['https://example.com/?x=1&y=2']);expect(document.getSelection()!.getRangeAt(0)).toBe(range);expect(f.view.state.selection).toBe(selection);unchanged(f);
 });
 it('selected preview keeps existing native context-menu handling rather than inventing a link menu',()=>{
  const f=fixture();event(anchor(f),'click');expect(event(anchor(f),'contextmenu').defaultPrevented).toBe(false);expect(f.overlays.querySelector('.md-link-popover')).toBeNull();unchanged(f);
 });
 it('same-byte identity replacement revokes an open action menu and late Copy ACK',async()=>{
  const f=fixture();draft(f);let complete!:(value:void)=>void;f.overlays.addEventListener('tegg-copy-text',e=>{e.preventDefault();(e as Event&{completion?:Promise<void>}).completion=new Promise(resolve=>{complete=resolve;});});const actions=menu(f);button(actions,'Copy link address').click();f.setIdentity({documentId:'other',generation:'g2',profile:'tegg',mode:'live'});complete();await tick();actions.querySelector<HTMLButtonElement>('.md-link-destination')!.click();expect(actions.textContent).not.toContain('Copied');expect(f.opened).toEqual([]);unchanged(f);
 });
 it('keyboard menu Escape restores the real draft focus and authored text caret without Source or history changes',()=>{
  const f=fixture(),a=draft(f),text=a.firstChild!;place(text,1);const actions=menu(f),copy=button(actions,'Copy link address');copy.focus();expect(document.activeElement).toBe(copy);key(copy,'Escape');expect(f.overlays.querySelector('.md-link-popover')).toBeNull();expect(document.activeElement).toBe(f.cells[0]);expect(document.getSelection()!.anchorNode).toBe(text);expect(document.getSelection()!.anchorOffset).toBe(1);expect(document.getSelection()!.isCollapsed).toBe(true);unchanged(f);
 });
 it('composition or stale identity cannot restore a new draft from an old menu Escape',()=>{
  const f=fixture(),a=draft(f);place(a.firstChild!,1);const actions=menu(f),copy=button(actions,'Copy link address');copy.focus();f.cells[0].dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));key(copy,'Escape');expect(copy.isConnected).toBe(true);expect(document.activeElement).toBe(copy);f.cells[0].dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));f.setIdentity({documentId:'other',generation:'g2',profile:'tegg',mode:'live'});key(copy,'Escape');expect(document.activeElement).not.toBe(f.cells[0]);unchanged(f);
 });
 it('original href, rel, entity and title bytes survive Cancel and a text-only commit in one Undo',()=>{
  const f=fixture(),original=anchor(f);draft(f);menu(f);key(f.cells[0],'Escape');expect(anchor(f)).toBe(original);draft(f);event(anchor(f),'pointerdown',{metaKey:true});event(anchor(f),'click',{metaKey:true});expect(f.opened).toEqual(['https://example.com/?x=1&y=2']);f.cells[0].querySelector('p')!.firstChild!.textContent='Changed ';f.cells[0].dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));expect(commitHtmlTableDrafts(f.view)).toBe(true);expect(f.view.state.doc.toString()).toBe(f.full.replace('Before ','Changed '));expect(undoDepth(f.view.state)).toBe(1);expect(undo(f.view)).toBe(true);expect(f.view.state.doc.toString()).toBe(f.full);
 });
});
