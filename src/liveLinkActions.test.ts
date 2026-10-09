/** @vitest-environment jsdom */
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {EditorState,StateEffect} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history,undoDepth,redoDepth} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {livePreview} from './livePreview';
import {resourceContext} from './editorHost';
import {EditingController,type EditingIdentity} from './editingController';
import {registerEditingLeave} from './editingPreflight';
import {showLiveLinkActions} from './liveLinks';
import {bindUI,type UIOptions} from './uiContext';
import type {TextCopyEvent} from './renderInteraction';

// These are adapter/IME boundary tests, not physical keyboard, Native clipboard or touch proof.
beforeAll(()=>{
  if(!Range.prototype.getClientRects)Range.prototype.getClientRects=()=>({length:0,item:()=>null,[Symbol.iterator]:function*(){}}) as DOMRectList;
  if(!Range.prototype.getBoundingClientRect)Range.prototype.getBoundingClientRect=()=>new DOMRect();
});
const cleanups:Array<()=>void>=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0).reverse())cleanup();vi.restoreAllMocks();document.body.replaceChildren();});
const tick=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
const deferred=()=>{let resolve!:()=>void,reject!:(reason:unknown)=>void;const promise=new Promise<void>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function mount(source='[plain](folder/a%20b.md?literal=%2520 "author title")\n\nTail',options:UIOptions={},readOnly=false){
  const root=document.body.appendChild(document.createElement('div'));
  const view=new EditorView({parent:root,state:EditorState.create({doc:source,selection:{anchor:source.length},extensions:[markdown({extensions:GFM}),resourceContext.of({documentPath:'/synthetic/note.md',profile:'tegg'}),history(),livePreview,...(readOnly?[EditorState.readOnly.of(true)]:[])]})});
  const identity:EditingIdentity={documentId:'synthetic',generation:'g1',profile:'tegg',mode:'live',readOnly};
  const controller=new EditingController(view,{identity:()=>identity});
  const binding=bindUI(view.dom,options);
  vi.spyOn(view,'coordsAtPos').mockReturnValue({left:20,right:80,top:20,bottom:40});
  vi.spyOn(view,'posAtCoords').mockReturnValue(2);
  cleanups.push(()=>{binding.destroy();controller.destroy();view.destroy();});
  return {root,view,identity,controller,source};
}
function span(view:EditorView){const node=view.dom.querySelector<HTMLElement>('.cm-live-link,.cm-live-wikilink');expect(node).not.toBeNull();return node!;}
function menu(view:EditorView){
  const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:20,clientY:20});span(view).dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);const panel=document.querySelector<HTMLElement>('.md-link-popover:not(.md-link-editor)');expect(panel).not.toBeNull();return panel!;
}
function button(panel:HTMLElement,key:string){const result=panel.querySelector<HTMLButtonElement>(`[data-tegg-ui-text="${key}"]`);expect(result).not.toBeNull();return result!;}
function snapshot(view:EditorView){return {source:view.state.doc.toString(),selection:view.state.selection.toJSON(),undo:undoDepth(view.state),redo:redoDepth(view.state)};}
function clickLink(view:EditorView,modifiers:MouseEventInit={}){
  span(view).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,buttons:1,clientX:20,clientY:20,...modifiers}));
  span(view).dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,button:0,clientX:20,clientY:20,...modifiers}));
  const event=new MouseEvent('click',{bubbles:true,cancelable:true,button:0,clientX:20,clientY:20,...modifiers});span(view).dispatchEvent(event);return event;
}
function host(target:HTMLElement,complete:(event:TextCopyEvent)=>void){const listener=(event:Event)=>{event.preventDefault();complete(event as TextCopyEvent);};target.addEventListener('tegg-copy-text',listener);cleanups.push(()=>target.removeEventListener('tegg-copy-text',listener));}

describe('approved Live link intent and shared address menu',()=>{
  it('preserves a touch menu click while mouse-down still protects the draft range',()=>{
    const {view}=mount(),panel=menu(view),copy=button(panel,'Copy link address'),before=snapshot(view);
    const touch=new MouseEvent('pointerdown',{bubbles:true,cancelable:true});Object.defineProperty(touch,'pointerType',{value:'touch'});copy.dispatchEvent(touch);expect(touch.defaultPrevented).toBe(false);
    const mouse=new MouseEvent('mousedown',{bubbles:true,cancelable:true});copy.dispatchEvent(mouse);expect(mouse.defaultPrevented).toBe(true);expect(snapshot(view)).toEqual(before);
  });
  it('ordinary click preserves the actual CM text route while pure Mac Command-click opens exactly once',()=>{
    vi.spyOn(window.navigator,'platform','get').mockReturnValue('MacIntel');
    const {view,source}=mount(),opened:string[]=[];view.dom.addEventListener('tegg-open-link',event=>{opened.push((event as CustomEvent<string>).detail);event.preventDefault();});
    const ordinary=clickLink(view);expect(ordinary.defaultPrevented).toBe(false);expect(opened).toEqual([]);expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);
    clickLink(view,{metaKey:true});expect(opened).toEqual(['folder/a%20b.md?literal=%2520']);expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);
  });
  it.each([{ctrlKey:true},{metaKey:true,ctrlKey:true},{metaKey:true,altKey:true},{metaKey:true,shiftKey:true}])('does not turn Control or mixed modifiers into navigation: %j',modifiers=>{
    vi.spyOn(window.navigator,'platform','get').mockReturnValue('MacIntel');
    const {view}=mount(),open=vi.fn();view.dom.addEventListener('tegg-open-link',open);clickLink(view,modifiers);expect(open).not.toHaveBeenCalled();
  });
  it('mobile meta remains a text click',()=>{
    vi.spyOn(window.navigator,'platform','get').mockReturnValue('MacIntel');const {view}=mount(undefined,{mobile:true}),open=vi.fn();view.dom.addEventListener('tegg-open-link',open);clickLink(view,{metaKey:true});expect(open).not.toHaveBeenCalled();
  });
  it.each(['identity','resource'] as const)('revokes a Command gesture when same-source %s authority changes between pointer phases',kind=>{
    vi.spyOn(window.navigator,'platform','get').mockReturnValue('MacIntel');const {view,identity}=mount(),opened=vi.fn(),before=snapshot(view);view.dom.addEventListener('tegg-open-link',opened);
    span(view).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,buttons:1,metaKey:true,clientX:20,clientY:20}));
    if(kind==='identity')identity.generation='replaced';else view.state.facet(resourceContext).documentPath='/other/document.md';
    span(view).dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,metaKey:true,clientX:20,clientY:20}));span(view).dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0,metaKey:true,clientX:20,clientY:20}));expect(opened).not.toHaveBeenCalled();expect(view.state.doc.toString()).toBe(before.source);expect(undoDepth(view.state)).toBe(before.undo);
  });
  it.each([true,false])('propagates the bound mobile=%s context identically to parsed and real-owner menus without content changes',mobile=>{
    const {view}=mount(undefined,{mobile}),before=snapshot(view),parsed=menu(view);expect(parsed.dataset.mobile).toBe(String(mobile));
    const owner=view.dom.appendChild(document.createElement('a'));owner.textContent='author';const dispose=showLiveLinkActions(view,{owner,target:'author.md',current:()=>true,open:()=>{}});const projected=document.querySelector<HTMLElement>('.md-link-popover')!;expect(projected).not.toBe(parsed);expect(projected.dataset.mobile).toBe(String(mobile));
    expect([...projected.querySelectorAll('button')].map(button=>button.dataset.teggUiLabel??button.dataset.teggUiText)).toEqual(['Open {value}','Edit link','Copy link address']);expect(snapshot(view)).toEqual(before);dispose();expect(snapshot(view)).toEqual(before);
  });
  it('does not open a menu during active drag, but accepts a stationary selected label',()=>{
    const {view}=mount();span(view).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,buttons:1,clientX:20,clientY:20}));
    span(view).dispatchEvent(new MouseEvent('mousemove',{bubbles:true,button:0,buttons:1,clientX:40,clientY:20}));
    span(view).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));expect(document.querySelector('.md-link-popover')).toBeNull();
    span(view).dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));view.dispatch({selection:{anchor:1,head:4}});const before=snapshot(view);menu(view);expect(snapshot(view)).toEqual(before);
  });
  it('lists Open/Edit/Copy and copies the full effective reference destination only after ACK',async()=>{
    const source='[Rich **label**][id]\n\n[id]: <folder/a%20b.md?literal=%2520> "title"\n\nTail';const {view}=mount(source),before=snapshot(view),pending=deferred(),requests:string[]=[];
    host(view.dom,event=>{requests.push(event.detail);event.completion=pending.promise;});const panel=menu(view),copy=button(panel,'Copy link address');
    expect(panel.querySelector('[data-tegg-ui-label="Open {value}"]')).not.toBeNull();expect(button(panel,'Edit link').disabled).toBe(false);expect(copy.classList.contains('md-link-text-action')).toBe(false);
    copy.click();expect(requests).toEqual(['folder/a%20b.md?literal=%2520']);expect(copy.textContent).toBe('Copy link address');await tick();expect(copy.textContent).toBe('Copy link address');
    pending.resolve();await tick();expect(copy.textContent).toBe('Copy link address');expect(panel.querySelector('.md-link-hint[role=status]')?.textContent).toBe('Copied');expect(snapshot(view)).toEqual(before);
  });
  it('Wiki copies its destination, not its alias or encoded navigation wire',async()=>{
    const {view}=mount('[[folder/中文笔记#标题|alias]]\n\nTail'),requests:string[]=[];host(view.dom,event=>{requests.push(event.detail);event.completion=Promise.resolve();});const panel=menu(view);button(panel,'Copy link address').click();await tick();expect(requests).toEqual(['folder/中文笔记#标题']);expect(view.state.doc.toString()).toContain('|alias]]');expect(undoDepth(view.state)).toBe(0);
  });
  it('retains free read-only Copy while the editing action is disabled',async()=>{
    const {view}=mount(undefined,{},true),before=snapshot(view),requests:string[]=[];host(view.dom,event=>{requests.push(event.detail);event.completion=Promise.resolve();});const panel=menu(view);expect(button(panel,'Edit link').disabled).toBe(true);button(panel,'Copy link address').click();await tick();expect(requests).toHaveLength(1);expect(snapshot(view)).toEqual(before);
  });
  it('uses the existing Chinese action key without changing the actual target',async()=>{
    const overlay=document.body.appendChild(document.createElement('aside')),{view}=mount(undefined,{locale:'zh-CN',overlayContainer:overlay}),requests:string[]=[];
    host(document.body,event=>{requests.push(event.detail);event.completion=Promise.resolve();});const panel=menu(view),copy=button(panel,'Copy link address');expect(overlay.contains(panel)).toBe(true);await tick();expect(copy.textContent).toBe('复制链接地址');copy.click();await tick();expect(copy.textContent).toBe('复制链接地址');expect(panel.querySelector('.md-link-hint[role=status]')?.textContent).toBe('已复制');expect(requests).toEqual(['folder/a%20b.md?literal=%2520']);
  });
  it('shows a current ACK failure and never fabricates success for legacy cancellation',async()=>{
    const {view}=mount(),panel=menu(view),copy=button(panel,'Copy link address');let legacy=false;host(view.dom,event=>{if(!legacy)event.completion=Promise.reject(Error('native denied'));});copy.click();await tick();expect(panel.querySelector('[role=status]')?.textContent).toContain('Copy unavailable');expect(copy.textContent).toBe('Copy link address');legacy=true;copy.click();await tick();expect(copy.textContent).toBe('Copy link address');expect(undoDepth(view.state)).toBe(0);
  });
  it.each([true,false])('old-panel ACK success=%s cannot report in a reopened menu',async success=>{
    const {view}=mount(),pending=deferred();host(view.dom,event=>{event.completion=pending.promise;});const old=menu(view);button(old,'Copy link address').click();const next=menu(view);expect(next).not.toBe(old);if(success)pending.resolve();else pending.reject(Error('late'));await tick();expect(button(next,'Copy link address').textContent).toBe('Copy link address');expect(next.querySelector('[role=status]')).toBeNull();
  });
  it.each(['documentId','generation','profile','mode','readOnly'] as const)('rejects same-source %s identity replacement and late ACKs without changing source or Undo',async key=>{
    const {view,identity}=mount(),pending=deferred(),requests:string[]=[];host(view.dom,event=>{requests.push(event.detail);event.completion=pending.promise;});const panel=menu(view),copy=button(panel,'Copy link address'),before=snapshot(view);copy.click();Object.assign(identity,{[key]:key==='readOnly'?true:key==='profile'?'gfm':key==='mode'?'source':'replaced'});pending.resolve();await tick();expect(copy.textContent).toBe('Copy link address');copy.click();expect(requests).toHaveLength(1);expect(snapshot(view)).toEqual(before);
  });
  it('nested composition denies menu and copy immediately and never replays after composition ends',async()=>{
    const {view}=mount(),panel=menu(view),requests:string[]=[];host(view.dom,event=>{requests.push(event.detail);event.completion=Promise.resolve();});let composing=true;cleanups.push(registerEditingLeave({view,composing:()=>composing,awaitingChoice:()=>false,prepare:()=>true,cancelPending:()=>{}}));button(panel,'Copy link address').click();expect(requests).toEqual([]);span(view).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));expect(document.querySelector('.md-link-popover')).toBe(panel);composing=false;await tick();expect(requests).toEqual([]);button(panel,'Copy link address').click();await tick();expect(requests).toHaveLength(1);
  });
  it('pointer menu actions keep the real selection and do not become new content transactions',()=>{
    const {view}=mount(),panel=menu(view),before=snapshot(view),copy=button(panel,'Copy link address');const event=new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0});copy.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);expect(snapshot(view)).toEqual(before);
  });
  it('resource authority changes invalidate an old menu even with identical bytes',()=>{
    const {view}=mount(),panel=menu(view),requests:string[]=[];host(view.dom,event=>{requests.push(event.detail);event.completion=Promise.resolve();});view.dispatch({effects:StateEffect.reconfigure.of([markdown({extensions:GFM}),resourceContext.of({documentPath:'/other/note.md',profile:'tegg'}),history(),livePreview])});button(panel,'Copy link address').click();expect(requests).toEqual([]);
  });
  it('reuses the exact menu for a real HTML owner and disposes only its captured panel',async()=>{
    const {view}=mount(),owner=view.dom.appendChild(document.createElement('a'));owner.textContent='author label';owner.href='https://example.com/?exact=%2520';let valid=true;const open=vi.fn(),edit=vi.fn(),requests:string[]=[];host(view.dom,event=>{requests.push(event.detail);event.completion=Promise.resolve();});const before=snapshot(view);
    const dispose=showLiveLinkActions(view,{owner,target:'https://example.com/?exact=%2520',current:()=>valid,open,edit});const panel=document.querySelector<HTMLElement>('.md-link-popover')!;button(panel,'Copy link address').click();await tick();expect(requests).toEqual(['https://example.com/?exact=%2520']);expect(snapshot(view)).toEqual(before);
    valid=false;panel.querySelector<HTMLButtonElement>('.md-link-destination')!.click();button(panel,'Edit link').click();expect(open).not.toHaveBeenCalled();expect(edit).not.toHaveBeenCalled();
    valid=true;showLiveLinkActions(view,{owner,target:'next.md',current:()=>valid,open});const next=document.querySelector<HTMLElement>('.md-link-popover')!;dispose();expect(next.isConnected).toBe(true);expect(button(next,'Edit link').disabled).toBe(true);owner.remove();next.querySelector<HTMLButtonElement>('.md-link-destination')!.click();expect(open).not.toHaveBeenCalled();
  });

  it('restores the actual projected owner only after a current Escape and never on ordinary disposal',()=>{
    const {view}=mount(),owner=view.dom.appendChild(document.createElement('a'));owner.textContent='author label';owner.tabIndex=0;const before=snapshot(view),restore=vi.fn(()=>owner.focus());
    showLiveLinkActions(view,{owner,target:'author.md',current:()=>true,open:()=>{},restoreFocus:restore});const panel=document.querySelector<HTMLElement>('.md-link-popover')!,copy=button(panel,'Copy link address');copy.focus();expect(document.activeElement).toBe(copy);
    copy.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(panel.isConnected).toBe(false);expect(restore).toHaveBeenCalledTimes(1);expect(document.activeElement).toBe(owner);expect(snapshot(view)).toEqual(before);
    const dispose=showLiveLinkActions(view,{owner,target:'author.md',current:()=>true,open:()=>{},restoreFocus:restore});dispose();expect(restore).toHaveBeenCalledTimes(1);expect(snapshot(view)).toEqual(before);
  });
  it('a composition-time projected Escape leaves the menu and real owner untouched without replay',async()=>{
    const {view}=mount(),owner=view.dom.appendChild(document.createElement('a'));owner.textContent='author label';owner.tabIndex=0;let composing=false;const restore=vi.fn(()=>owner.focus());
    cleanups.push(registerEditingLeave({view,composing:()=>composing,awaitingChoice:()=>false,prepare:()=>true,cancelPending:()=>{}}));
    showLiveLinkActions(view,{owner,target:'author.md',current:()=>true,open:()=>{},restoreFocus:restore});const panel=document.querySelector<HTMLElement>('.md-link-popover')!,copy=button(panel,'Copy link address'),before=snapshot(view);copy.focus();composing=true;
    copy.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(panel.isConnected).toBe(true);expect(restore).not.toHaveBeenCalled();expect(document.activeElement).toBe(copy);composing=false;await tick();expect(panel.isConnected).toBe(true);expect(restore).not.toHaveBeenCalled();expect(snapshot(view)).toEqual(before);
  });
  it.each(['identity','successor'] as const)('a stale projected Escape cannot restore an owner or close its %s replacement',kind=>{
    const {view,identity}=mount(),owner=view.dom.appendChild(document.createElement('a'));owner.textContent='author label';owner.tabIndex=0;const restore=vi.fn(),before=snapshot(view);
    showLiveLinkActions(view,{owner,target:'old.md',current:()=>true,open:()=>{},restoreFocus:restore});const old=document.querySelector<HTMLElement>('.md-link-popover')!,copy=button(old,'Copy link address');let next:HTMLElement|undefined;
    if(kind==='identity')identity.generation='replaced';else {showLiveLinkActions(view,{owner,target:'next.md',current:()=>true,open:()=>{}});next=document.querySelector<HTMLElement>('.md-link-popover')!;}
    copy.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(restore).not.toHaveBeenCalled();expect(kind==='identity'?old.isConnected:next?.isConnected).toBe(true);expect(snapshot(view)).toEqual(before);
  });

  it.each(['identity','resource'] as const)('compatibility mousedown cannot regrant the captured %s Command gesture, while genuine next pointer and legacy gestures work',kind=>{
    vi.spyOn(window.navigator,'platform','get').mockReturnValue('MacIntel');const {view,identity}=mount(),opened:string[]=[],initial=snapshot(view);view.dom.addEventListener('tegg-open-link',event=>{opened.push((event as CustomEvent<string>).detail);event.preventDefault();});
    const sameBuffer=()=>{expect(view.state.doc.toString()).toBe(initial.source);expect(undoDepth(view.state)).toBe(initial.undo);expect(redoDepth(view.state)).toBe(initial.redo);};
    const options={bubbles:true,cancelable:true,button:0,buttons:1,metaKey:true,clientX:20,clientY:20};span(view).dispatchEvent(new MouseEvent('pointerdown',options));
    if(kind==='identity')identity.generation='replaced';else view.state.facet(resourceContext).documentPath='/other/current.md';
    span(view).dispatchEvent(new MouseEvent('mousedown',options));const rejectedMouse=snapshot(view);sameBuffer();span(view).dispatchEvent(new MouseEvent('pointerup',{...options,buttons:0}));span(view).dispatchEvent(new MouseEvent('mouseup',{...options,buttons:0}));span(view).dispatchEvent(new MouseEvent('click',{...options,buttons:0}));expect(opened).toEqual([]);expect(snapshot(view)).toEqual(rejectedMouse);sameBuffer();
    span(view).dispatchEvent(new MouseEvent('pointerdown',options));span(view).dispatchEvent(new MouseEvent('mousedown',options));const nextMouse=snapshot(view);sameBuffer();span(view).dispatchEvent(new MouseEvent('pointerup',{...options,buttons:0}));span(view).dispatchEvent(new MouseEvent('mouseup',{...options,buttons:0}));span(view).dispatchEvent(new MouseEvent('click',{...options,buttons:0}));expect(opened).toEqual(['folder/a%20b.md?literal=%2520']);expect(snapshot(view)).toEqual(nextMouse);sameBuffer();
    span(view).dispatchEvent(new MouseEvent('mousedown',options));const legacyMouse=snapshot(view);sameBuffer();span(view).dispatchEvent(new MouseEvent('mouseup',{...options,buttons:0}));span(view).dispatchEvent(new MouseEvent('click',{...options,buttons:0}));expect(opened).toEqual(['folder/a%20b.md?literal=%2520','folder/a%20b.md?literal=%2520']);expect(snapshot(view)).toEqual(legacyMouse);sameBuffer();
  });
  it.each(['pointercancel','compositionstart'] as const)('%s discards a real pointer gesture without replay and a genuine next pointer remains usable',interruption=>{
    vi.spyOn(window.navigator,'platform','get').mockReturnValue('MacIntel');const {view}=mount(),opened:string[]=[],initial=snapshot(view);view.dom.addEventListener('tegg-open-link',event=>{opened.push((event as CustomEvent<string>).detail);event.preventDefault();});const options={bubbles:true,cancelable:true,button:0,buttons:1,metaKey:true,clientX:20,clientY:20};
    const sameBuffer=()=>{expect(view.state.doc.toString()).toBe(initial.source);expect(undoDepth(view.state)).toBe(initial.undo);expect(redoDepth(view.state)).toBe(initial.redo);};
    span(view).dispatchEvent(new MouseEvent('pointerdown',options));span(view).dispatchEvent(new MouseEvent('mousedown',options));const interruptedMouse=snapshot(view);sameBuffer();span(view).dispatchEvent(new Event(interruption,{bubbles:true}));if(interruption==='compositionstart')span(view).dispatchEvent(new Event('compositionend',{bubbles:true}));span(view).dispatchEvent(new MouseEvent('click',{...options,buttons:0}));expect(opened).toEqual([]);expect(snapshot(view)).toEqual(interruptedMouse);sameBuffer();
    span(view).dispatchEvent(new MouseEvent('pointerdown',options));span(view).dispatchEvent(new MouseEvent('mousedown',options));const nextMouse=snapshot(view);sameBuffer();span(view).dispatchEvent(new MouseEvent('pointerup',{...options,buttons:0}));span(view).dispatchEvent(new MouseEvent('mouseup',{...options,buttons:0}));span(view).dispatchEvent(new MouseEvent('click',{...options,buttons:0}));expect(opened).toEqual(['folder/a%20b.md?literal=%2520']);expect(snapshot(view)).toEqual(nextMouse);sameBuffer();
  });
});
