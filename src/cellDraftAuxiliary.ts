import {bindUI,contextFor,mountOverlay} from "./uiContext";
import type {EditorView} from "@codemirror/view";

/** Draft-owned DOM controls; no source, command, entitlement, or keyboard-layout API. */
export interface CellDraftAuxiliaryActions {
  readonly cancel: HTMLButtonElement;
  readonly done: HTMLButtonElement;
  readonly lineBreak: HTMLButtonElement;
  readonly more: HTMLElement;
}
export interface CellDraftAuxiliaryRequest {
  readonly kind: "gfm" | "html";
  readonly owner: HTMLElement;
  readonly controls: HTMLElement;
  readonly actions: CellDraftAuxiliaryActions;
  /** Same finite draft token and actual mounted owner remain alive.
   * Source/context/identity mismatch, stale status, or readOnly alone must not revoke
   * Cancel/focus ownership. Existing action handlers independently guard all writes.
   * Never permission to start edits or execute another draft's commands.
   */
  readonly current: () => boolean;
}
export interface CellDraftAuxiliaryMount {
  readonly container: HTMLElement;
  /** Only this request's layout observation; never another draft or document. */
  dispose(): void;
}
export interface CellDraftAuxiliaryHost {
  mount(request: Readonly<CellDraftAuxiliaryRequest>): CellDraftAuxiliaryMount | null;
}

/** Internal producer inputs, intentionally absent from Core/public Host request. */
interface RealDraftBinding extends CellDraftAuxiliaryRequest {
  /** Exact producer draft object, permanently replaced on real close/destroy/reopen. */
  readonly draftToken: object;
  readonly composing: () => boolean;
  /** Existing widget implementation restores its exact nodes or removes them on close. */
  readonly releaseControls: () => void;
}
interface Entry {
  readonly view: EditorView;
  readonly token: object;
  readonly request: RealDraftBinding;
  readonly roots: Set<HTMLElement>;
  readonly menuRegistrations: Map<HTMLElement, symbol>;
  closed: boolean;
}
const roots = new WeakMap<HTMLElement, Entry>();

export interface CellDraftAuxiliaryLease {
  readonly owner: HTMLElement;
  readonly controls: HTMLElement;
  readonly token: object;
  current(): boolean;
  composing(): boolean;
  owns(target: Node | null): boolean;
  /** SDK-created detached menu only; never the entire Host portal.
   * Each registration has an independent cleanup capability. Re-registering the
   * same menu invalidates the former cleanup without changing draft ownership.
   */
  ownMenu(menu: HTMLElement): () => void;
  dispose(): void;
}

/** No Host opt-in means no registry, new group, listeners, or moved DOM. */
export function mountCellDraftAuxiliary(
  view: EditorView, binding: RealDraftBinding, host?: CellDraftAuxiliaryHost,
): CellDraftAuxiliaryLease | null {
  if (!host) return null;
  const {owner, controls, actions} = binding;
  if (!owner.isConnected || !controls.isConnected || !binding.current() ||
      owner.ownerDocument !== controls.ownerDocument ||
      ![actions.cancel, actions.done, actions.lineBreak, actions.more].every(node => controls.contains(node))) return null;
  const entry: Entry = {view, token: binding.draftToken, request: binding, roots: new Set([controls]), menuRegistrations: new Map(), closed: false};
  const previous = roots.get(controls);
  // A producer must close its former owner before handing the same real nodes to another draft.
  if (previous && !previous.closed) return null;
  roots.set(controls, entry);
  let mount: CellDraftAuxiliaryMount | null = null;
  let ui:ReturnType<typeof bindUI>|undefined,localeObserver:MutationObserver|undefined;
  const live = () => !entry.closed && owner.isConnected && controls.isConnected &&
    roots.get(controls) === entry && binding.current();
  const unown = (node: HTMLElement) => {
    if (roots.get(node) === entry) roots.delete(node);
    entry.roots.delete(node); entry.menuRegistrations.delete(node);
  };
  const dispose = () => {
    if (entry.closed) return;
    entry.closed = true; // Revoke before any producer/Host cleanup or removal event.
    for (const node of [...entry.roots]) unown(node);
    localeObserver?.disconnect();ui?.destroy();
    try {binding.releaseControls();} finally {mount?.dispose();}
  };
  const publicRequest: CellDraftAuxiliaryRequest = {kind: binding.kind, owner, controls, actions, current: live};
  try {
    mount = host.mount(publicRequest);
    if (!mount || mount.container.ownerDocument !== owner.ownerDocument || !mount.container.isConnected || !live()) {
      dispose(); return null;
    }
    mount.container.append(controls); // Actual nodes/handlers; never clone or Source mutation.
    // The controls leave the editor's DOM ancestry. Keep the original UI context
    // with the actual owned group, including locale changes while it remains open.
    ui=bindUI(controls,contextFor(view.dom));
    localeObserver=new MutationObserver(()=>ui?.update(contextFor(view.dom)));
    localeObserver.observe(view.dom.closest<HTMLElement>('[lang]')??view.dom,{attributes:true,attributeFilter:['lang']});
    if (!live()) {dispose(); return null;}
  } catch (problem) {dispose(); throw problem;}
  return {
    owner, controls, token: binding.draftToken, current: live,
    composing: () => live() && binding.composing(),
    owns: target => live() && !!target && [...entry.roots].some(node => roots.get(node) === entry && node.contains(target)),
    ownMenu(menu) {
      if (!live() || menu.ownerDocument !== owner.ownerDocument ||
          menu.contains(owner) || menu.contains(controls)) return () => {};
      const occupied = roots.get(menu); if (occupied && occupied !== entry && !occupied.closed) return () => {};
      const registration = Symbol("cell-draft-menu-registration");
      roots.set(menu, entry); entry.roots.add(menu); entry.menuRegistrations.set(menu, registration);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        if (entry.menuRegistrations.get(menu) !== registration) return;
        unown(menu); // Exact registration only; old cleanup cannot revoke a newer one.
      };
    },
    dispose,
  };
}

/** Internal focus/outside routing from real registered nodes, not author selectors. */
export function cellDraftAuxiliaryAt(view: EditorView, target: Node | null) {
  for (let node = target; node; node = node.parentNode) {
    const entry = node instanceof HTMLElement ? roots.get(node) : undefined;
    if (entry?.view === view && !entry.closed && entry.request.owner.isConnected &&
        entry.request.controls.isConnected && roots.get(entry.request.controls) === entry && entry.request.current()) {
      return {owner: entry.request.owner, token: entry.token, composing: entry.request.composing()};
    }
  }
  return null;
}

/** Detach only the SDK-created menu, so a Host's scrolling controls cannot clip it. */
export function bindCellDraftAuxiliaryMore(view:EditorView,lease:CellDraftAuxiliaryLease,more:HTMLDetailsElement,menu:HTMLElement):()=>void {
  const summary=more.querySelector<HTMLElement>(':scope > summary')!;
  let stopOverlay:(()=>void)|undefined,unown:(()=>void)|undefined,frame=0,alive=true;
  const previousStyle=menu.getAttribute('style'),previousClass=menu.className;
  const restore=()=>{if(previousStyle===null)menu.removeAttribute('style');else menu.setAttribute('style',previousStyle);menu.className=previousClass;};
  const close=()=>{unown?.();unown=undefined;stopOverlay?.();stopOverlay=undefined;if(menu.parentElement!==more)more.append(menu);restore();};
  const place=()=>{
    if(!alive||!lease.current()||!more.open||!stopOverlay)return;
    const vv=window.visualViewport,x=(vv?.offsetLeft??0)+8,y=(vv?.offsetTop??0)+8,w=Math.max(1,(vv?.width??window.innerWidth)-16),h=Math.max(1,(vv?.height??window.innerHeight)-16),anchor=summary.getBoundingClientRect();
    const above=Math.max(0,Math.min(h,anchor.top-y-4)),below=Math.max(0,y+h-anchor.bottom-4),height=Math.max(1,Math.max(above,below));
    menu.style.maxWidth=w+'px';menu.style.maxHeight=height+'px';
    const box=menu.getBoundingClientRect(),left=Math.max(x,Math.min(anchor.right-box.width,x+w-box.width));
    const top=below>=Math.min(menu.scrollHeight,height)||below>=above?anchor.bottom+4:anchor.top-4-Math.min(box.height,above);
    menu.style.left=left+'px';menu.style.top=Math.max(y,Math.min(top,y+h-box.height))+'px';
  };
  const schedule=()=>{if(!frame&&alive)frame=requestAnimationFrame(()=>{frame=0;place();});};
  const toggle=()=>{
    if(!alive)return;if(!more.open||!lease.current()){close();return;}
    if(!stopOverlay){
      const style=getComputedStyle(summary),mobile=contextFor(view.dom).mobile===true;
      menu.classList.add('md-cell-draft-more-menu');Object.assign(menu.style,{position:'fixed',display:'grid',zIndex:'100',boxSizing:'border-box',overflow:'auto',minWidth:'max-content',padding:'4px',background:'var(--surface,Canvas)',border:'1px solid var(--border,ButtonBorder)',fontFamily:style.fontFamily,fontSize:style.fontSize,lineHeight:style.lineHeight});
      for(const button of menu.querySelectorAll<HTMLButtonElement>('button')){button.style.font='inherit';button.style.whiteSpace='nowrap';button.style.minHeight=(mobile?44:28)+'px';button.style.minWidth=(mobile?44:28)+'px';}
      stopOverlay=mountOverlay(view.dom,menu);unown=lease.ownMenu(menu);
    }place();
  };
  const key=(event:KeyboardEvent)=>{if(event.key!=='Escape'||event.isComposing||event.keyCode===229||!lease.current()||lease.composing())return;event.preventDefault();event.stopPropagation();more.open=false;close();summary.focus({preventScroll:true});};
  // Native compatibility mousedown otherwise focuses/selects the summary text,
  // hiding the keyboard and replacing the still-owned cell caret before click.
  // Keep native details click/keyboard activation; only suppress mouse focus.
  const summaryMouseDown=(event:MouseEvent)=>{if(event.button===0&&lease.current())event.preventDefault();};
  const menuClick=()=>{if(!more.open)close();};
  summary.addEventListener('mousedown',summaryMouseDown);more.addEventListener('toggle',toggle);menu.addEventListener('keydown',key);menu.addEventListener('click',menuClick);
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);observer?.observe(summary);observer?.observe(menu);
  window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
  return()=>{if(!alive)return;alive=false;if(frame)cancelAnimationFrame(frame);observer?.disconnect();summary.removeEventListener('mousedown',summaryMouseDown);more.removeEventListener('toggle',toggle);menu.removeEventListener('keydown',key);menu.removeEventListener('click',menuClick);window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);more.open=false;close();};
}
