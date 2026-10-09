// @vitest-environment jsdom
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {Compartment,EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history,undoDepth,redoDepth} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {EditingController} from './editingController';
import {attachEditingUI,type ActiveEditingDraft} from './editingUI';
import {resourceContext} from './editorHost';
import {bindUI} from './uiContext';
import {liveLinks,captureLiveLinkInteraction,editCurrentLink} from './liveLinks';
import {createHtmlPreview} from './renderKit';
import {attachHtmlTableEditing} from './htmlTableWidget';
import {EditableTableWidget,focusedTableCell} from './tableWidget';
import './livePreview';

// Actual SDK controllers, generated panels and draft handlers; DOM-event tests
// are not physical touch/IME, Native clipboard or official Host layout proof.
type ObjectLease=Extract<ActiveEditingDraft,{kind:'object'}>;
const disposals:Array<()=>void>=[];
beforeAll(()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
  Range.prototype.getClientRects=()=>({length:0,item:()=>null,[Symbol.iterator]:function*(){}}) as DOMRectList;
  Range.prototype.getBoundingClientRect=()=>new DOMRect();
});
afterEach(()=>{disposals.splice(0).reverse().forEach(stop=>stop());vi.restoreAllMocks();document.body.replaceChildren();});
const snapshot=(view:EditorView)=>({source:view.state.doc.toString(),selection:view.state.selection.toJSON(),undo:undoDepth(view.state),redo:redoDepth(view.state)});
const pointer=(node:HTMLElement)=>{const event=new MouseEvent('pointerdown',{bubbles:true,cancelable:true,button:0});node.dispatchEvent(event);return event;};
const key=(node:HTMLElement,value:string)=>node.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
const named=(panel:HTMLElement,label:string)=>{const button=panel.querySelector<HTMLButtonElement>(`[data-tegg-ui-text="${label}"]`);expect(button).not.toBeNull();return button!;};
const html='<table><tr><td><p>Text <strong>old</strong> <a href="a.md" rel="author">Link</a></p></td><td>Other</td></tr></table>';
function htmlFixture(two=false){
  const parent=document.body.appendChild(document.createElement('div')),overlays=document.body.appendChild(document.createElement('aside'));
  const prefix='Before\n\n',between='\n\nMiddle\n\n',other=html.replace('a.md','b.md'),source=prefix+html+(two?between+other:'')+'\n\nAfter';
  const access=new Compartment(),view=new EditorView({parent,state:EditorState.create({doc:source,selection:{anchor:2},extensions:[history(),markdown({extensions:GFM}),liveLinks,access.of(EditorState.readOnly.of(false)),resourceContext.of({profile:'tegg',documentPath:'/isolated/owned-cell.md'})]})});
  const binding=bindUI(view.dom,{overlayContainer:overlays}),controller=new EditingController(view,{identity:()=>({documentId:'owned-cell',generation:'one',profile:'tegg',mode:'live',readOnly:view.state.readOnly})}),ui=attachEditingUI(controller,overlays,{toolbar:false,overlayContainer:overlays});
  const wrappers:HTMLElement[]=[],stops:Array<()=>void>=[];
  for(const [raw,from]of [[html,prefix.length],...(two?[[other,prefix.length+html.length+between.length]]:[])] as Array<[string,number]>){
    const wrapper=createHtmlPreview({kind:'html',source:raw,display:'block'});view.dom.append(wrapper);wrappers.push(wrapper);const stop=attachHtmlTableEditing(wrapper,view,from,raw);expect(stop).not.toBeNull();stops.push(stop!);
  }
  const cells=wrappers.map(wrapper=>wrapper.querySelector<HTMLTableCellElement>('td')!);
  const begin=(index=0)=>{cells[index].click();key(cells[index],'F2');expect(cells[index].contentEditable).toBe('true');};
  const dirty=(index=0)=>{cells[index].querySelector('strong')!.textContent='local';cells[index].dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));};
  const actions=(index=0)=>{const anchor=cells[index].querySelector<HTMLAnchorElement>('a')!;anchor.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));const lease=captureLiveLinkInteraction(view);expect(lease?.projectedOwner).toBe(anchor);return lease!;};
  const child=()=>{const menu=actions();named(menu.panel,'Edit link').click();const lease=ui.captureActiveDrafts().find((draft):draft is ObjectLease=>draft.kind==='object');expect(lease).not.toBeUndefined();expect(lease!.controller.session?.status).toBe('editing');return lease!;};
  const changeChild=(lease:ObjectLease)=>{const input=lease.panel.querySelector<HTMLInputElement>('[data-tegg-ui-label="Target"]');expect(input).not.toBeNull();input!.value='child-local.md';input!.dispatchEvent(new Event('input',{bubbles:true}));expect(lease.controller.session?.draft).toContain('child-local.md');return input!;};
  let disposed=false;const stop=()=>{if(disposed)return;disposed=true;stops.forEach(stop=>stop());wrappers.forEach(wrapper=>wrapper.remove());ui.destroy();controller.destroy();binding.destroy();view.destroy();};disposals.push(stop);
  return {view,source,wrappers,cells,overlays,ui,begin,dirty,actions,child,changeChild,readonly:()=>view.dispatch({effects:access.reconfigure(EditorState.readOnly.of(true))}),stale:()=>{const from=view.state.doc.toString().indexOf('a.md');view.dispatch({changes:{from,to:from+4,insert:'external.md'}});},stop};
}
function authoredOutside(className:string){
  // Real author-like HTML outside the table, not a registered SDK panel.
  const owner=createHtmlPreview({kind:'html',source:`<p class="${className}"><a href="outside.md">Outside</a></p>`,display:'block'});document.body.append(owner);
  const target=owner.querySelector<HTMLAnchorElement>('a')!;expect(target).not.toBeNull();expect(target.closest(`.${className}`)).not.toBeNull();return target;
}
function gfmFixture(){
  const table='| A | B |\n| --- | --- |\n| [Link](a.md) | next |',prefix='Before\n\n',source=prefix+table+'\n\nAfter';
  const parent=document.body.appendChild(document.createElement('div')),overlays=document.body.appendChild(document.createElement('aside'));
  const view=new EditorView({parent,state:EditorState.create({doc:source,selection:{anchor:2},extensions:[history(),markdown({extensions:GFM}),liveLinks,resourceContext.of({profile:'tegg',documentPath:'/isolated/gfm-cell.md'})]})});
  const binding=bindUI(view.dom,{overlayContainer:overlays}),controller=new EditingController(view,{identity:()=>({documentId:'gfm-cell',generation:'one',profile:'tegg',mode:'live'})}),ui=attachEditingUI(controller,overlays,{toolbar:false,overlayContainer:overlays});
  // Mount the actual production widget, not a mirrored table implementation.
  const widget=new EditableTableWidget(table,prefix.length,prefix.length+table.length),panel=widget.toDOM(view);view.dom.append(panel);
  const preview=panel.querySelector<HTMLButtonElement>('[data-table-row="1"][data-table-column="0"] button')!;expect(preview).not.toBeNull();preview.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  const editor=focusedTableCell(view);expect(editor).not.toBeNull();
  let disposed=false;const stop=()=>{if(disposed)return;disposed=true;widget.destroy(panel);panel.remove();ui.destroy();controller.destroy();binding.destroy();view.destroy();};disposals.push(stop);
  return {view,source,panel,editor:editor!,overlays,ui,stop};
}

describe('finite cell drafts own only their actual generated detached interactions',()=>{
  it('expires an actual projected-menu lease on close/reopen and destroy without granting the successor to old cleanup',()=>{
    const f=htmlFixture();f.begin();const before=snapshot(f.view),first=f.actions(),copy=named(first.panel,'Copy link address');
    expect(first.current()).toBe(true);expect(first.owns(copy)).toBe(true);expect(first.owns(authoredOutside('md-link-popover'))).toBe(false);
    const second=f.actions();expect(second.panel).not.toBe(first.panel);expect(first.current()).toBe(false);expect(first.owns(copy)).toBe(false);expect(second.current()).toBe(true);expect(snapshot(f.view)).toEqual(before);
    key(f.cells[0],'Escape');expect(second.current()).toBe(false);f.begin();const third=f.actions();expect(third.current()).toBe(true);f.stop();expect(third.current()).toBe(false);
  });
  it('preserves a dirty HTML cell when its actual source-backed detached menu receives a pointer action',()=>{
    const f=htmlFixture();f.begin();f.dirty();const before=snapshot(f.view),menu=f.actions(),copy=named(menu.panel,'Copy link address');
    expect(pointer(copy).defaultPrevented).toBe(true);expect(menu.current()).toBe(true);expect(f.cells[0].contentEditable).toBe('true');expect(f.cells[0].querySelector('strong')!.textContent).toBe('local');expect(snapshot(f.view)).toEqual(before);
  });
  it.each(['md-link-popover','tegg-editing-panel'])('does not exempt authored outside %s from the original legal cell leave',className=>{
    const f=htmlFixture();f.begin();f.dirty();const selection=f.view.state.selection.toJSON();pointer(authoredOutside(className));
    expect(f.cells[0].hasAttribute('contenteditable')).toBe(false);expect(f.view.state.doc.toString()).toBe(f.source.replace('<strong>old</strong>','<strong>local</strong>'));expect(f.view.state.selection.toJSON()).toEqual(selection);expect(undoDepth(f.view.state)).toBe(1);expect(redoDepth(f.view.state)).toBe(0);
  });
  it('does not claim another actual cell menu on the same parent view',()=>{
    const f=htmlFixture(true);f.begin(0);f.dirty(0);f.begin(1);const other=f.actions(1),selection=f.view.state.selection.toJSON();
    pointer(named(other.panel,'Copy link address'));
    expect(f.cells[0].hasAttribute('contenteditable')).toBe(false);expect(f.view.state.doc.toString()).toBe(f.source.replace('<strong>old</strong>','<strong>local</strong>'));expect(f.view.state.selection.toJSON()).toEqual(selection);expect(undoDepth(f.view.state)).toBe(1);expect(redoDepth(f.view.state)).toBe(0);
    expect(f.cells[1].contentEditable).toBe('true');expect(other.current()).toBe(false); // Source change closes the foreign menu; ownership never authorized its action.
  });
  it('keeps a real dirty HTML child and the real C4 default Keep focus, then restores its field range',()=>{
    const f=htmlFixture();f.begin();f.dirty();const child=f.child(),input=f.changeChild(child);input.focus();input.setSelectionRange(1,4);const before=snapshot(f.view);
    pointer(input);expect(child.panel.querySelector('.tegg-discard-draft')).toBeNull();expect(snapshot(f.view)).toEqual(before);
    pointer(authoredOutside('md-link-popover'));const keep=child.panel.querySelector<HTMLButtonElement>('[data-label="Keep editing"]');expect(keep).not.toBeNull();expect(document.activeElement).toBe(keep);expect(child.controller.session?.status).toBe('editing');expect(snapshot(f.view)).toEqual(before);
    keep!.click();expect(document.activeElement).toBe(input);expect(input.selectionStart).toBe(1);expect(input.selectionEnd).toBe(4);expect(child.controller.session?.draft).toContain('child-local.md');expect(snapshot(f.view)).toEqual(before);
  });
  it.each(['readonly','stale'] as const)('retains actual child-window membership after %s without making its pointer interaction a write',state=>{
    const f=htmlFixture();f.begin();f.dirty();const child=f.child(),input=f.changeChild(child);f[state]();input.focus();const before=snapshot(f.view);
    expect(pointer(input).defaultPrevented).toBe(false);expect(child.panel.isConnected).toBe(true);expect(f.cells[0].contentEditable).toBe('true');expect(snapshot(f.view)).toEqual(before);
  });
  it('does not steal a real HTML child IME field or replay an outside leave after composition ends',()=>{
    const f=htmlFixture();f.begin();const child=f.child(),input=f.changeChild(child);input.focus();input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));expect(f.ui.isComposing).toBe(true);const before=snapshot(f.view);
    expect(pointer(authoredOutside('md-link-popover')).defaultPrevented).toBe(true);expect(document.activeElement).toBe(input);expect(child.panel.querySelector('.tegg-discard-draft')).toBeNull();expect(snapshot(f.view)).toEqual(before);
    input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));expect(f.ui.isComposing).toBe(false);expect(document.activeElement).toBe(input);expect(child.controller.session?.status).toBe('editing');expect(snapshot(f.view)).toEqual(before);
  });
  it('keeps an actual GFM child link editor when focus moves from the child view into its detached field',()=>{
    const f=gfmFixture(),before=snapshot(f.view);expect(editCurrentLink(f.editor)).toBe(true);const lease=captureLiveLinkInteraction(f.editor);expect(lease).not.toBeNull();expect(lease!.projectedOwner).toBeNull();
    const input=lease!.panel.querySelector<HTMLInputElement>('[data-tegg-ui-label="Link destination"]')!;expect(input).not.toBeNull();input.focus();expect(lease!.current()).toBe(true);expect(f.editor.dom.isConnected).toBe(true);expect(snapshot(f.view)).toEqual(before);
    named(lease!.panel,'Cancel').click();expect(lease!.current()).toBe(false);expect(f.editor.dom.isConnected).toBe(true);expect(snapshot(f.view)).toEqual(before);
  });
  it('does not exempt an authored class when a legal GFM draft moves focus outside',()=>{
    const f=gfmFixture();f.editor.dispatch({changes:{from:f.editor.state.doc.length,insert:' local'}});f.editor.focus();const selection=f.view.state.selection.toJSON();authoredOutside('tegg-editing-panel').focus();
    expect(f.editor.dom.isConnected).toBe(false);expect(f.view.state.doc.toString()).toBe(f.source.replace('[Link](a.md)','[Link](a.md) local'));expect(f.view.state.selection.toJSON()).toEqual(selection);expect(undoDepth(f.view.state)).toBe(1);expect(redoDepth(f.view.state)).toBe(0);
  });
  it('retains a dirty GFM link child behind its actual C4 choice when leaving to an unrelated classed node',async()=>{
    const f=gfmFixture();expect(editCurrentLink(f.editor)).toBe(true);const lease=captureLiveLinkInteraction(f.editor)!;
    const input=lease.panel.querySelector<HTMLInputElement>('[data-tegg-ui-label="Link destination"]')!;input.value='child-local.md';input.dispatchEvent(new Event('input',{bubbles:true}));f.editor.focus();const before=snapshot(f.view);authoredOutside('md-link-popover').focus();await Promise.resolve();
    const keep=lease.panel.querySelector<HTMLButtonElement>('[data-tegg-ui-text="Keep editing"]');expect(keep).not.toBeNull();expect(document.activeElement).toBe(keep);expect(lease.current()).toBe(true);expect(f.editor.dom.isConnected).toBe(true);expect(snapshot(f.view)).toEqual(before);
  });
  it('does not reclaim deferred C4 focus after a real field, Keep, discard, reopen, or composition transition',async()=>{
    for(const transition of ['field','keep','discard','reopen','composition'] as const){
      const f=gfmFixture();expect(editCurrentLink(f.editor)).toBe(true);const lease=captureLiveLinkInteraction(f.editor)!;
      const input=lease.panel.querySelector<HTMLInputElement>('[data-tegg-ui-label="Link destination"]')!;input.value='child-local.md';input.dispatchEvent(new Event('input',{bubbles:true}));f.editor.focus();const before=snapshot(f.view);authoredOutside('md-link-popover').focus();
      const keep=lease.panel.querySelector<HTMLButtonElement>('[data-tegg-ui-text="Keep editing"]');expect(keep).not.toBeNull();let expected:Element|null;
      if(transition==='field'||transition==='composition'){input.focus();if(transition==='composition')input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));expected=input;}
      else if(transition==='keep'){keep!.click();expected=document.activeElement;expect(lease.panel.querySelector('.md-link-leave-choice')).toBeNull();}
      else {named(lease.panel,'Discard changes').click();expect(lease.current()).toBe(false);if(transition==='reopen'){expect(editCurrentLink(f.editor)).toBe(true);expect(captureLiveLinkInteraction(f.editor)!.panel).not.toBe(lease.panel);}expected=document.activeElement;}
      await Promise.resolve();expect(document.activeElement).toBe(expected);expect(snapshot(f.view)).toEqual(before);
      if(transition==='composition'){expect(f.ui.isComposing).toBe(true);input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));expect(snapshot(f.view)).toEqual(before);}
      f.stop();
    }
  });
  it('keeps a real detached GFM link IME field and requires a fresh Cancel after composition ends',()=>{
    const f=gfmFixture();expect(editCurrentLink(f.editor)).toBe(true);const lease=captureLiveLinkInteraction(f.editor)!;
    const input=lease.panel.querySelector<HTMLInputElement>('[data-tegg-ui-label="Link destination"]')!;input.focus();input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));expect(f.ui.isComposing).toBe(true);const before=snapshot(f.view);
    const target=authoredOutside('md-link-popover'),outside=new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0});target.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);expect(document.activeElement).toBe(input);expect(lease.panel.querySelector('.md-link-leave-choice')).toBeNull();expect(lease.current()).toBe(true);expect(snapshot(f.view)).toEqual(before);
    input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));expect(f.ui.isComposing).toBe(false);expect(lease.current()).toBe(true);expect(document.activeElement).toBe(input);expect(snapshot(f.view)).toEqual(before);
    named(lease.panel,'Cancel').click();expect(lease.current()).toBe(false);expect(snapshot(f.view)).toEqual(before);
  });
});
