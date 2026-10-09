// @vitest-environment jsdom
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {Compartment,EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history,undo,undoDepth,redoDepth} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {EditingController} from './editingController';
import {attachEditingUI,type ActiveEditingDraft} from './editingUI';
import {resourceContext} from './editorHost';
import {liveLinks} from './liveLinks';
import {livePreview} from './livePreview';
import {createHtmlPreview} from './renderKit';
import {attachHtmlTableEditing,captureHtmlTableDrafts,commitHtmlTableDrafts,executeHtmlTableCommand} from './htmlTableWidget';

type ObjectLease=Extract<ActiveEditingDraft,{kind:'object'}>;
const disposals:Array<()=>void>=[];
beforeAll(()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
  Range.prototype.getClientRects=()=>({length:0,item:()=>null,[Symbol.iterator]:function*(){}}) as DOMRectList;
  Range.prototype.getBoundingClientRect=()=>new DOMRect();
});
afterEach(()=>{disposals.splice(0).reverse().forEach(stop=>stop());vi.restoreAllMocks();document.body.replaceChildren();});

function fixture(){
  const source='<table class="keep"><tr><td><p data-x="retain">Text<strong title="strong">old</strong></p><a href="a.md" rel="author" title="A">A</a> <a href="b.md" title="B">B</a></td><td>Other</td></tr></table>';
  const prefix='Before\n',originalSource=prefix+source+'\nAfter';
  const root=document.body.appendChild(document.createElement('div')),overlays=document.body.appendChild(document.createElement('div'));
  const access=new Compartment(),view=new EditorView({parent:root,state:EditorState.create({doc:originalSource,selection:{anchor:2},extensions:[history(),markdown(),liveLinks,access.of(EditorState.readOnly.of(false)),resourceContext.of({profile:'tegg',documentPath:'/fixtures/cancel.html.md',engines:{}})]})});
  const errors:unknown[]=[],controller=new EditingController(view,{identity:()=>({documentId:'html-cancel',generation:'one',profile:'tegg',mode:'live'})});
  const ui=attachEditingUI(controller,overlays,{toolbar:false,onError:error=>errors.push(error)});
  const wrapper=createHtmlPreview({kind:'html',source,display:'block'});view.dom.append(wrapper);
  const stop=attachHtmlTableEditing(wrapper,view,prefix.length,source);expect(stop).not.toBeNull();
  const cell=wrapper.querySelector<HTMLTableCellElement>('td')!;
  const cancel=wrapper.querySelector<HTMLButtonElement>('.md-html-table-controls [data-tegg-ui-text="Cancel"]')!;
  expect(cancel).not.toBeNull();
  const snapshot=()=>({source:view.state.doc.toString(),selection:view.state.selection.toJSON(),undo:undoDepth(view.state),redo:redoDepth(view.state)});
  const begin=()=>{cell.click();cell.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true,cancelable:true}));expect(cell.contentEditable).toBe('true');};
  const dirty=()=>{cell.querySelector('strong')!.textContent='local';cell.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));};
  const objects=()=>ui.captureActiveDrafts().filter((lease):lease is ObjectLease=>lease.kind==='object');
  const openChild=(index=0)=>{
    const anchor=cell.querySelectorAll<HTMLAnchorElement>('a')[index];expect(anchor).not.toBeUndefined();
    anchor.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));
    const edit=document.querySelector<HTMLButtonElement>('.md-link-popover [data-tegg-ui-text="Edit link"]');expect(edit).not.toBeNull();edit!.click();
    const lease=objects().find(lease=>lease.controller.session?.original.includes(index===0?'a.md':'b.md'));
    expect(lease).not.toBeUndefined();expect(lease!.current()).toBe(true);expect(lease!.controller.session?.status).toBe('editing');
    return lease!;
  };
  const changeChild=(lease:ObjectLease,target:string)=>{
    const input=lease.panel.querySelector<HTMLInputElement>('[data-tegg-ui-label="Target"]');expect(input).not.toBeNull();
    input!.value=target;input!.dispatchEvent(new Event('input',{bubbles:true}));
    expect(lease.controller.session?.draft).toContain(target);return input!;
  };
  const setBlocked=(kind:'readonly'|'stale')=>{
    if(kind==='readonly')view.dispatch({effects:access.reconfigure(EditorState.readOnly.of(true))});
    else{const from=view.state.doc.toString().indexOf('a.md');view.dispatch({changes:{from,to:from+4,insert:'external.md'}});}
  };
  disposals.push(()=>{stop!();ui.destroy();controller.destroy();view.destroy();root.remove();overlays.remove();});
  return {source,prefix,originalSource,view,wrapper,cell,cancel,ui,errors,snapshot,begin,dirty,objects,openChild,changeChild,setBlocked};
}

describe('explicit HTML cell Cancel owns discard rather than commit authority',()=>{
  it('cancels a readonly local cell through the actual command without source, selection or history writes',()=>{
    const f=fixture();f.begin();f.dirty();const [lease]=captureHtmlTableDrafts(f.view);f.setBlocked('readonly');const before=f.snapshot();
    expect(commitHtmlTableDrafts(f.view)).toBe(false);expect(f.snapshot()).toEqual(before);
    f.cell.focus();expect(executeHtmlTableCommand(f.view,'table-cancel')).toBe(true);
    expect(f.snapshot()).toEqual(before);expect(lease.current()).toBe(false);expect(f.cell.hasAttribute('contenteditable')).toBe(false);
    expect(f.cell.querySelector('strong')!.textContent).toBe('old');expect(f.cell.querySelector('p')!.getAttribute('data-x')).toBe('retain');expect(f.errors).toEqual([]);
  });

  it('retains a standalone stale draft without a renderer instead of painting old nodes over the newer parent document',()=>{
    const f=fixture();f.begin();f.dirty();f.setBlocked('stale');const before=f.snapshot();expect(before.source).toContain('external.md');
    expect(commitHtmlTableDrafts(f.view)).toBe(false);f.cell.focus();expect(executeHtmlTableCommand(f.view,'table-cancel')).toBe(false);
    expect(f.snapshot()).toEqual(before);expect(f.cell.contentEditable).toBe('true');expect(f.cell.querySelector('strong')!.textContent).toBe('local');
    expect(f.wrapper.querySelector('.md-html-table-error')!.textContent).toContain('current document projection could not be refreshed');
  });

  it.each(['readonly','stale'] as const)('separates discard authority from renderer availability for actual child scopes when %s',kind=>{
    const f=fixture();f.begin();const first=f.openChild();f.changeChild(first,'first-local.md');
    first.panel.querySelector<HTMLButtonElement>('[data-label="Apply"]')!.click();
    expect(first.controller.session?.status).toBe('applied');expect(f.cell.querySelector('a')!.getAttribute('href')).toBe('first-local.md');expect(f.view.state.doc.toString()).toBe(f.originalSource);
    const second=f.openChild(1);f.changeChild(second,'second-local.md');const signal=second.controller.signalForSession(second.token)!;expect(signal.aborted).toBe(false);
    expect(f.wrapper.querySelectorAll('.md-html-object-editor-host')).toHaveLength(2);f.setBlocked(kind);const before=f.snapshot();
    expect(commitHtmlTableDrafts(f.view)).toBe(false);f.cancel.click();
    if(kind==='stale'){
      expect(f.snapshot()).toEqual(before);expect(f.cell.contentEditable).toBe('true');expect(f.cell.querySelector('a')!.getAttribute('href')).toBe('first-local.md');
      expect(second.controller.session?.status).toBe('editing');expect(second.controller.session?.draft).toContain('second-local.md');expect(signal.aborted).toBe(false);
      expect(f.wrapper.querySelectorAll('.md-html-object-editor-host')).toHaveLength(2);return;
    }
    expect(f.snapshot()).toEqual(before);expect(second.controller.session?.status).toBe('cancelled');expect(signal.aborted).toBe(true);expect(second.current()).toBe(false);
    expect(f.objects()).toEqual([]);expect(f.wrapper.querySelector('.md-html-object-editor-host')).toBeNull();expect(second.panel.isConnected).toBe(false);
    expect(f.cell.querySelector('a')!.getAttribute('href')).toBe('a.md');expect(f.cell.querySelector('a')!.getAttribute('rel')).toBe('author');expect(f.cell.querySelectorAll('a')[1].getAttribute('href')).toBe('b.md');
  });

  it('rechecks source after actual child abort publication and never restores old nodes over a reentrant parent change',()=>{
    const f=fixture();f.begin();f.dirty();const child=f.openChild();f.changeChild(child,'cancelled-local.md');
    const signal=child.controller.signalForSession(child.token)!;expect(signal.aborted).toBe(false);
    let afterExternal:ReturnType<typeof f.snapshot>|undefined,externalDoc:typeof f.view.state.doc|undefined,externalSelection:typeof f.view.state.selection|undefined;
    signal.addEventListener('abort',()=>{
      const from=f.view.state.doc.toString().indexOf('a.md');expect(from).toBeGreaterThan(0);
      f.view.dispatch({changes:{from,to:from+4,insert:'external.md'}});
      afterExternal=f.snapshot();externalDoc=f.view.state.doc;externalSelection=f.view.state.selection;
    },{once:true});
    f.cell.focus();expect(executeHtmlTableCommand(f.view,'table-cancel')).toBe(false);
    expect(signal.aborted).toBe(true);expect(child.controller.session?.status).toBe('cancelled');expect(child.current()).toBe(false);expect(child.panel.isConnected).toBe(false);
    expect(f.objects()).toEqual([]);expect(f.wrapper.querySelector('.md-html-object-editor-host')).toBeNull();
    expect(afterExternal).toBeDefined();expect(f.snapshot()).toEqual(afterExternal);expect(f.view.state.doc).toBe(externalDoc);expect(f.view.state.selection).toBe(externalSelection);
    expect(f.view.state.doc.toString()).toBe(f.originalSource.replace('href="a.md"','href="external.md"'));expect(undoDepth(f.view.state)).toBe(1);
    // This standalone projection has no renderer capability. Child discard is
    // complete, but its still-mounted cell draft is retained, not old-node paint.
    expect(f.cell.contentEditable).toBe('true');expect(f.cell.querySelector('strong')!.textContent).toBe('local');
    expect(f.wrapper.querySelector('.md-html-table-error')!.textContent).toContain('current document projection could not be refreshed');
  });

  it('retains parent composition and all child drafts without replaying Cancel when composition ends',()=>{
    const f=fixture();f.begin();f.dirty();const child=f.openChild();f.changeChild(child,'child-local.md');
    f.cell.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));expect(f.ui.isComposing).toBe(true);const before=f.snapshot();
    f.cancel.click();expect(f.snapshot()).toEqual(before);expect(f.cell.contentEditable).toBe('true');expect(child.controller.session?.status).toBe('editing');
    f.cell.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));expect(f.ui.isComposing).toBe(false);
    expect(f.snapshot()).toEqual(before);expect(f.cell.contentEditable).toBe('true');expect(child.controller.session?.status).toBe('editing');
    f.cancel.click();expect(child.controller.session?.status).toBe('cancelled');expect(f.snapshot()).toEqual(before);
  });

  it('retains real child-field composition, then requires a fresh explicit Cancel after composition ends',()=>{
    const f=fixture();f.begin();const child=f.openChild(),input=f.changeChild(child,'child-local.md');input.focus();
    input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));expect(f.ui.isComposing).toBe(true);const before=f.snapshot();
    f.cancel.click();expect(f.snapshot()).toEqual(before);expect(child.controller.session?.status).toBe('editing');expect(document.activeElement).toBe(input);
    input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));expect(f.ui.isComposing).toBe(false);expect(child.controller.session?.status).toBe('editing');expect(f.cell.contentEditable).toBe('true');
    f.cancel.click();expect(child.controller.session?.status).toBe('cancelled');expect(f.snapshot()).toEqual(before);
  });

  it.each(['readonly','stale'] as const)('keeps Done and ordinary leave behind their existing %s write guards',kind=>{
    const f=fixture();f.begin();f.dirty();const child=f.openChild();f.changeChild(child,'kept.md');f.setBlocked(kind);const before=f.snapshot();
    expect(commitHtmlTableDrafts(f.view)).toBe(false);f.cell.focus();expect(executeHtmlTableCommand(f.view,'table-apply')).toBe(false);
    expect(f.snapshot()).toEqual(before);expect(f.cell.contentEditable).toBe('true');expect(f.cell.querySelector('strong')!.textContent).toBe('local');expect(child.controller.session?.draft).toContain('kept.md');
  });

  it('keeps dirty independent-child C4 protection on a valid ordinary leave instead of silently cancelling or applying it',()=>{
    const f=fixture();f.begin();const child=f.openChild();f.changeChild(child,'kept.md');const before=f.snapshot();
    expect(commitHtmlTableDrafts(f.view)).toBe(false);expect(f.snapshot()).toEqual(before);expect(child.controller.session?.status).toBe('editing');
    expect(child.panel.textContent).toContain('Keep editing');expect(child.panel.textContent).toContain('Discard changes');expect(child.panel.textContent).toContain('Complete and continue');
    expect(f.cell.contentEditable).toBe('true');
  });

  it('commits an explicitly completed child together with cell changes once and preserves authored attributes on Undo',()=>{
    const f=fixture();f.begin();f.dirty();const child=f.openChild();f.changeChild(child,'committed.md');child.panel.querySelector<HTMLButtonElement>('[data-label="Apply"]')!.click();
    expect(f.view.state.doc.toString()).toBe(f.originalSource);expect(undoDepth(f.view.state)).toBe(0);f.cell.focus();expect(executeHtmlTableCommand(f.view,'table-apply')).toBe(true);
    expect(f.view.state.doc.toString()).toBe(f.originalSource.replace('>old</strong>','>local</strong>').replace('href="a.md"','href="committed.md"'));
    expect(undoDepth(f.view.state)).toBe(1);expect(undo(f.view)).toBe(true);expect(f.view.state.doc.toString()).toBe(f.originalSource);expect(undoDepth(f.view.state)).toBe(0);expect(redoDepth(f.view.state)).toBe(1);
  });

  it('keeps valid ordinary cell leave as one parent commit and one Undo',()=>{
    const f=fixture();f.begin();f.dirty();expect(commitHtmlTableDrafts(f.view)).toBe(true);
    expect(f.view.state.doc.toString()).toBe(f.originalSource.replace('>old</strong>','>local</strong>'));expect(undoDepth(f.view.state)).toBe(1);
    expect(undo(f.view)).toBe(true);expect(f.view.state.doc.toString()).toBe(f.originalSource);
  });

  it('preserves normal writable Escape cancellation and revokes the old child owner before reopening the same td',()=>{
    const f=fixture();f.begin();f.dirty();const old=f.openChild();f.changeChild(old,'abandoned.md');f.cancel.click();expect(old.current()).toBe(false);
    f.begin();const next=f.openChild();expect(next.token).not.toBe(old.token);expect(old.current()).toBe(false);expect(next.current()).toBe(true);const before=f.snapshot();
    next.panel.querySelector<HTMLButtonElement>('[data-label="Cancel"]')!.click();f.cell.focus();f.cell.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    expect(f.snapshot()).toEqual(before);expect(f.view.state.doc.toString()).toBe(f.originalSource);expect(f.cell.hasAttribute('contenteditable')).toBe(false);expect(f.objects()).toEqual([]);expect(f.wrapper.querySelector('.md-html-object-editor-host')).toBeNull();
  });

  it('shows the actual new source href after normal Live remount, releases the old children and refuses an old Cancel against the successor',async()=>{
    const source='<table><tr><td><p>Text</p><a href="a.md" rel="author">A</a></td></tr></table>',originalSource='Before\n\n'+source+'\n\nAfter';
    const root=document.body.appendChild(document.createElement('div')),overlays=document.body.appendChild(document.createElement('div'));
    const view=new EditorView({parent:root,state:EditorState.create({doc:originalSource,selection:{anchor:2},extensions:[history(),markdown(),liveLinks,resourceContext.of({profile:'tegg',documentPath:'/fixtures/actual-remount.md',engines:{}}),livePreview]})});
    const controller=new EditingController(view,{identity:()=>({documentId:'actual-remount',generation:'one',profile:'tegg',mode:'live'})}),ui=attachEditingUI(controller,overlays,{toolbar:false});
    disposals.push(()=>{ui.destroy();controller.destroy();view.destroy();root.remove();overlays.remove();});
    await vi.waitFor(()=>expect(root.querySelector('.cm-live-html-table td')).not.toBeNull(),{timeout:1000});
    const oldCell=root.querySelector<HTMLTableCellElement>('.cm-live-html-table td')!,oldWrapper=oldCell.closest('.cm-live-html-table')!;
    oldCell.click();oldCell.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true,cancelable:true}));expect(oldCell.contentEditable).toBe('true');
    const oldCancel=oldWrapper.querySelector<HTMLButtonElement>('.md-html-table-controls [data-tegg-ui-text="Cancel"]')!;
    oldCell.querySelector('a')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));
    document.querySelector<HTMLButtonElement>('.md-link-popover [data-tegg-ui-text="Edit link"]')!.click();
    const child=ui.captureActiveDrafts().find((lease):lease is ObjectLease=>lease.kind==='object')!;expect(child).not.toBeUndefined();
    const target=child.panel.querySelector<HTMLInputElement>('[data-tegg-ui-label="Target"]')!;target.value='uncommitted.md';target.dispatchEvent(new Event('input',{bubbles:true}));expect(child.controller.session?.draft).toContain('uncommitted.md');
    const from=view.state.doc.toString().indexOf('a.md');view.dispatch({changes:{from,to:from+4,insert:'external.md'}});
    const expected=originalSource.replace('a.md','external.md'),doc=view.state.doc,selection=view.state.selection,depth=undoDepth(view.state),redo=redoDepth(view.state);
    await vi.waitFor(()=>expect(root.querySelector('.cm-live-html-table td a')?.getAttribute('href')).toBe('external.md'),{timeout:1000});
    expect(root.querySelector('.cm-live-html-table td')).not.toBe(oldCell);expect(oldCell.isConnected).toBe(false);expect(child.current()).toBe(false);expect(child.controller.session?.status).toBe('cancelled');expect(child.panel.isConnected).toBe(false);
    expect(root.querySelector('.md-html-object-editor-host')).toBeNull();expect(view.state.doc.toString()).toBe(expected);expect(view.state.doc).toBe(doc);expect(view.state.selection).toBe(selection);expect(undoDepth(view.state)).toBe(depth);expect(redoDepth(view.state)).toBe(redo);
    oldCancel.click();expect(root.querySelector('.cm-live-html-table td a')!.getAttribute('href')).toBe('external.md');expect(view.state.doc).toBe(doc);expect(view.state.selection).toBe(selection);expect(undoDepth(view.state)).toBe(depth);expect(redoDepth(view.state)).toBe(redo);expect(view.state.doc.toString()).toBe(expected);
  });
});
