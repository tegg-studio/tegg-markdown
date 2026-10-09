import {EditorView,ViewPlugin} from '@codemirror/view';

type Tap={id:number;x:number;y:number;downAt:number;before:number;doc:EditorView['state']['doc'];upAt?:number;target?:number};

/** Keep a native WebKit tap's first valid caret when UIKit immediately rolls
 * it back to the old collapsed position. This does not calculate a new caret,
 * prevent touch defaults, focus the editor, or change text/history. */
export function bindTableCellCaret(view:EditorView):()=>void {
  const document=view.dom.ownerDocument,win=document.defaultView;
  if(!win||!/Apple Computer/.test(win.navigator.vendor)||!(/Mobile\//.test(win.navigator.userAgent)||win.navigator.maxTouchPoints>2))return()=>{};
  let tap:Tap|undefined,lastTap:{time:number;x:number;y:number}|undefined;
  const now=()=>win.performance.now();
  const clear=()=>{tap=undefined;};
  const position=()=>{
    const range=document.getSelection();
    if(!range?.isCollapsed||!range.anchorNode||!range.focusNode||!view.contentDOM.contains(range.anchorNode)||!view.contentDOM.contains(range.focusNode))return null;
    try{const anchor=view.posAtDOM(range.anchorNode,range.anchorOffset),head=view.posAtDOM(range.focusNode,range.focusOffset);return anchor===head&&head>=0&&head<=view.state.doc.length?head:null;}catch{return null;}
  };
  const down=(event:PointerEvent)=>{
    clear();
    if(event.pointerType!=='touch'||event.isPrimary===false||view.compositionStarted||view.state.readOnly||view.state.facet(EditorView.editable)===false||!view.hasFocus||document.activeElement!==view.contentDOM||!(event.target instanceof Node)||!view.contentDOM.contains(event.target))return;
    const time=now(),before=position();
    // Leave the platform's word-selection gesture and existing nonempty ranges alone.
    if(before===null||!view.state.selection.main.empty||lastTap&&time-lastTap.time<500&&Math.hypot(event.clientX-lastTap.x,event.clientY-lastTap.y)<=8)return;
    tap={id:event.pointerId,x:event.clientX,y:event.clientY,downAt:time,before,doc:view.state.doc};
  };
  const move=(event:PointerEvent)=>{if(tap&&event.pointerId===tap.id&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>8)clear();};
  const up=(event:PointerEvent)=>{
    const current=tap;if(!current||event.pointerId!==current.id)return;
    const time=now();lastTap={time,x:event.clientX,y:event.clientY};
    if(time-current.downAt>500||Math.hypot(event.clientX-current.x,event.clientY-current.y)>8){clear();return;}
    current.upAt=time;
  };
  const changed=()=>{
    const current=tap;
    if(!current||current.upAt===undefined)return;
    if(now()-current.upAt>100||view.state.doc!==current.doc||view.compositionStarted||view.state.readOnly||view.state.facet(EditorView.editable)===false||document.activeElement!==view.contentDOM){clear();return;}
    const head=position();if(head===null){clear();return;}
    if(current.target===undefined){if(head!==current.before)current.target=head;return;}
    if(head===current.target)return;
    clear();
    if(head===current.before)view.dispatch({selection:{anchor:current.target},userEvent:'select.pointer'});
  };
  const events:[EventTarget,string,EventListener][]=[
    [document,'pointerdown',down as EventListener],[document,'pointermove',move as EventListener],
    [document,'pointerup',up as EventListener],[document,'pointercancel',clear],
    [document,'selectionchange',changed],[view.contentDOM,'beforeinput',clear],
    [view.contentDOM,'compositionstart',clear],[view.contentDOM,'blur',clear],[win,'blur',clear],
  ];
  // Let CodeMirror first read the native selection. Dispatching before that
  // observer runs would compare against its cached prior DOM position.
  for(const [target,type,listener]of events)target.addEventListener(type,listener,{capture:type!=='selectionchange',passive:true});
  return()=>{clear();for(const [target,type,listener]of events)target.removeEventListener(type,listener,type!=='selectionchange');};
}

export const tableCellCaret=ViewPlugin.define(view=>{
  // Plugin construction precedes CodeMirror's document observer. Attach after
  // construction so the native selection is processed before our correction.
  let alive=true,dispose=()=>{};
  queueMicrotask(()=>{if(alive)dispose=bindTableCellCaret(view);});
  return{destroy(){alive=false;dispose();}};
});
