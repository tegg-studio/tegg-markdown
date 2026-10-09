/** @vitest-environment jsdom */
import {history,undoDepth,redoDepth} from '@codemirror/commands';
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {markdown} from '@codemirror/lang-markdown';
import {forceParsing,ParseContext,syntaxTreeAvailable} from '@codemirror/language';
import type {ParseWrapper} from '@lezer/common';
import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {EditingController} from './editingController';
import {attachEditingUI} from './editingUI';
import {resourceContext} from './editorHost';
import {liveLinks} from './liveLinks';
import {livePreview} from './livePreview';

const cleanups:Array<()=>void>=[];
beforeAll(()=>{
  if(typeof ResizeObserver==='undefined')vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
  if(!Range.prototype.getClientRects)Range.prototype.getClientRects=()=>({length:0,item:()=>null,[Symbol.iterator]:function*(){}}) as DOMRectList;
  if(!Range.prototype.getBoundingClientRect)Range.prototype.getBoundingClientRect=()=>new DOMRect();
});
afterEach(()=>{cleanups.splice(0).reverse().forEach(stop=>stop());});

it('observes actual stale HTML widget Cancel cleanup in the real compositionend synchronous tail before deferred parse restoration',async()=>{
  const source='<table><tr><td><p>Text</p><a href="a.md" rel="author">A</a></td></tr></table>';
  const initialOriginalSource='Before\n\n'+source+'\n\nafter';
  let hold=false,release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=()=>{hold=false;resolve();};});
  const wrap:ParseWrapper=(inner,input,fragments,ranges)=>hold?ParseContext.getSkippingParser(pending).startParse(input,fragments,ranges):inner;
  const root=document.body.appendChild(document.createElement('div')),overlays=document.body.appendChild(document.createElement('div'));
  const view=new EditorView({parent:root,state:EditorState.create({doc:initialOriginalSource,selection:{anchor:initialOriginalSource.length},extensions:[
    history(),markdown({extensions:[{wrap}]}),liveLinks,resourceContext.of({profile:'tegg',documentPath:'/fixtures/retained-stale-window.md',engines:{}}),livePreview,
  ]})});
  const controller=new EditingController(view,{identity:()=>({documentId:'retained-stale-window',generation:'one',profile:'tegg',mode:'live'})});
  const ui=attachEditingUI(controller,overlays,{toolbar:false});
  cleanups.push(()=>{ui.destroy();controller.destroy();view.destroy();root.remove();overlays.remove();release();});
  let oldCell:HTMLTableCellElement|undefined,oldWrapper:HTMLElement|undefined;
  let preconditionReached=false,cleanupObserved=false;
  const phases:Array<Record<string,unknown>>=[];
  const snapshot=()=>({source:view.state.doc.toString(),selection:view.state.selection.toJSON(),undo:undoDepth(view.state),redo:redoDepth(view.state)});
  const record=(phase:string)=>phases.push({phase,...snapshot(),composing:view.composing,compositionStarted:view.compositionStarted,
    oldCellConnected:oldCell?.isConnected??null,oldWrapperConnected:oldWrapper?.isConnected??null,
    oldHref:oldCell?.querySelector('a')?.getAttribute('href')??null,currentHref:root.querySelector('.cm-live-html-table td a')?.getAttribute('href')??null,
    parserFullAvailable:syntaxTreeAvailable(view.state,view.state.doc.length)});
  try{
    await vi.waitFor(()=>expect(root.querySelector('.cm-live-html-table td')).not.toBeNull(),{timeout:1000,interval:10});
    oldCell=root.querySelector<HTMLTableCellElement>('.cm-live-html-table td')!;
    oldWrapper=oldCell.closest<HTMLElement>('.cm-live-html-table')!;
    oldCell.click();oldCell.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true,cancelable:true}));
    expect(oldCell.contentEditable).toBe('true');
    const oldCancel=oldWrapper.querySelector<HTMLButtonElement>('.md-html-table-controls [data-tegg-ui-text="Cancel"]')!;
    oldCell.querySelector('p')!.textContent='local cell';
    oldCell.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
    expect(view.state.doc.toString()).toBe(initialOriginalSource);
    expect(view.dom.inert).not.toBe(true);
    // No independent object modal is open: a real parent composition must not
    // be simulated by focusing an inert parent through jsdom's absent inert UI.
    // Programmatic focus remains an event-model probe, not a physical gesture.
    view.focus();
    await vi.waitFor(()=>expect(view.hasFocus).toBe(true),{timeout:1000,interval:10});
    expect(oldCell.isConnected).toBe(true);record('mounted-draft-before-composition');
    hold=true;
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
    const text=view.contentDOM.querySelector('.cm-line:last-child')?.firstChild;
    expect(text?.nodeType).toBe(Node.TEXT_NODE);expect(text?.textContent).toBe('after');
    const actualText=text as Text;actualText.data+='中文';
    const range=document.createRange();range.setStart(actualText,actualText.length);range.collapse(true);
    const selection=document.getSelection()!;selection.removeAllRanges();selection.addRange(range);
    view.contentDOM.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'中文',isComposing:true}));
    const actualComposedSource=initialOriginalSource+'中文';
    await vi.waitFor(()=>{expect(view.composing).toBe(true);expect(view.state.doc.toString()).toBe(actualComposedSource);expect(undoDepth(view.state)).toBe(1);},{timeout:2000,interval:10});
    expect(oldCell.isConnected).toBe(true);record('actual-composed-source-received');
    const from=view.state.doc.toString().indexOf('a.md');expect(from).toBeGreaterThan(0);
    view.dispatch({changes:{from,to:from+4,insert:'external.md'}});
    const expectedSource=actualComposedSource.replace('a.md','external.md');
    expect(view.state.doc.toString()).toBe(expectedSource);expect(oldCell.isConnected).toBe(true);
    expect(oldCell.querySelector('a')!.getAttribute('href')).toBe('a.md');expect(view.composing).toBe(true);
    record('source-stale-old-widget-retained-during-composition');
    // Trigger the public parse-completion path while the real composition is
    // still active. Never force parsing or dispatch rescue effects after Cancel.
    release();expect(forceParsing(view,view.state.doc.length,1000)).toBe(true);
    expect(syntaxTreeAvailable(view.state,view.state.doc.length)).toBe(true);
    expect(view.composing).toBe(true);expect(oldCell.isConnected).toBe(true);record('parse-complete-projection-deferred');
    const baseline=snapshot(),doc=view.state.doc,mainSelection=view.state.selection;
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中文'}));
    // No await, event-loop turn, selection update, blur or next character can
    // intervene between this real end event and the actual old Cancel handler.
    expect(view.composing).toBe(false);expect(view.compositionStarted).toBe(false);
    expect(oldCell.isConnected).toBe(true);expect(oldWrapper.isConnected).toBe(true);
    expect(view.state.doc).toBe(doc);expect(view.state.selection).toBe(mainSelection);expect(snapshot()).toEqual(baseline);
    preconditionReached=true;record('end-tail-before-cancel-real-retained-stale');
    oldCancel.click();
    // Synchronous destruction differentiates the actual private refresh from
    // later parse-restoration remount. No callback or disposal method is mocked.
    expect(oldCell.isConnected).toBe(false);expect(oldWrapper.isConnected).toBe(false);
    expect(root.querySelector('.cm-live-html-table td a')?.getAttribute('href')).toBe('external.md');
    expect(root.querySelector('.md-html-cell-editing')).toBeNull();
    expect(root.querySelector('.cm-live-html-table td p')?.textContent).toBe('Text');
    expect(root.querySelector('.md-html-object-editor-host')).toBeNull();
    expect(view.state.doc).toBe(doc);expect(view.state.selection).toBe(mainSelection);expect(snapshot()).toEqual(baseline);
    cleanupObserved=true;record('immediate-real-cancel-cleanup');
    await Promise.resolve();await Promise.resolve();
    expect(view.state.doc).toBe(doc);expect(view.state.selection).toBe(mainSelection);expect(snapshot()).toEqual(baseline);
    expect(root.querySelector('.cm-live-html-table td a')?.getAttribute('href')).toBe('external.md');record('after-existing-deferred-microtasks');
  }finally{
    console.log('HTML_RETAINED_STALE_WINDOW_OBSERVATION',JSON.stringify({initialOriginalSource,preconditionReached,cleanupObserved,phases,
      scope:'jsdom real CompositionEvent/DOMObserver/public parser plus actual widget/Cancel cleanup; not Native IME or actual touch'}));
  }
},10_000);
