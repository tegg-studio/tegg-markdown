import {StateEffect,StateField,EditorState,Transaction,ChangeSet,type Extension} from '@codemirror/state';
import {EditorView,WidgetType} from '@codemirror/view';
import {markdown} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {calloutRanges} from './calloutEditing';
import {exitSemanticObject} from './semanticEditing';
import {resourceContext} from './editorHost';
import {dispatchSourcePatches} from './editorPatches';
import {setUILabel} from './uiContext';
export const enterEmptyCalloutBody=StateEffect.define<number|null>();
export const emptyCalloutBodyState=StateField.define<number|null>({create:()=>null,update(value,tr){if(value!==null&&tr.docChanged)value=tr.changes.mapPos(value);for(const effect of tr.effects)if(effect.is(enterEmptyCalloutBody))value=effect.value;return value;}});
export const preserveEmptyCalloutTitle=EditorState.transactionFilter.of(tr=>{
  if(!tr.docChanged||!tr.isUserEvent('input'))return tr;
  const empty=calloutRanges(tr.startState).filter(item=>!item.title&&!/[ \t]$/.test(tr.startState.sliceDoc(item.headerFrom,item.headerTo)));
  if(!empty.length)return tr;
  let changed=false;const edits:{from:number;to:number;insert:string}[]=[],extras:{from:number;insert:string}[]=[];
  tr.changes.iterChanges((from,to,_fromB,_toB,insert)=>{let text=insert.toString();if(from===to&&text&&!text.startsWith('\n')&&empty.some(item=>item.headerTo===from)){text=' '+text;changed=true;extras.push({from:_fromB,insert:' '});}edits.push({from,to,insert:text});});
  if(!changed)return tr;
  const changes=tr.startState.changes(edits),follow=ChangeSet.of(extras,tr.newDoc.length);return {changes,selection:tr.newSelection.map(follow),effects:StateEffect.mapEffects(tr.effects,follow),scrollIntoView:tr.scrollIntoView,userEvent:tr.annotation(Transaction.userEvent)??'input.type'};
});
const controls=new WeakMap<HTMLElement,{focus():void;destroy():void;update(from:number):void}>();
/** A title-only Callout supplies a transient body caret; source is created by actual input. */
export class EmptyCalloutBodyWidget extends WidgetType {
  constructor(readonly from:number,readonly projection:Extension){super();}
  eq(other:WidgetType){return other instanceof EmptyCalloutBodyWidget&&other.from===this.from;}
  updateDOM(dom:HTMLElement){controls.get(dom)?.update(this.from);return true;}
  toDOM(view:EditorView){
    let from=this.from,composing=false,alive=true;
    const wrapper=document.createElement('span');wrapper.className='cm-live-callout-temporary-body';wrapper.contentEditable='false';wrapper.dataset.calloutTemporary='true';
    const commit=()=>{if(!alive||composing)return;const value=child.state.doc.toString();if(!value)return;const callout=calloutRanges(view.state).find(item=>item.from===from);if(!callout||callout.to!==callout.headerTo||view.state.readOnly)return;
      const line=view.state.doc.lineAt(callout.from),prefix=view.state.sliceDoc(line.from,callout.headerFrom),insert='\n'+prefix+value.split('\n').join('\n'+prefix);
      const at=callout.headerTo;view.dispatch({effects:enterEmptyCalloutBody.of(null)});dispatchSourcePatches(view,[{from:at,to:at,expected:'',insert}],{selection:{anchor:at+insert.length},userEvent:'input.type'});view.focus();};
    const child=new EditorView({parent:wrapper,state:EditorState.create({extensions:[markdown({extensions:GFM}),resourceContext.of({...view.state.facet(resourceContext),displaySession:undefined}),EditorView.lineWrapping,this.projection]}),dispatchTransactions:transactions=>{child.update(transactions);if(transactions.some(tr=>tr.docChanged))queueMicrotask(commit);}});setUILabel(child.contentDOM,'Callout body');
    child.dom.addEventListener('compositionstart',()=>{composing=true;wrapper.dataset.calloutTemporaryComposing='true';});child.dom.addEventListener('compositionend',()=>{composing=false;delete wrapper.dataset.calloutTemporaryComposing;queueMicrotask(commit);});
    child.dom.addEventListener('keydown',event=>{event.stopPropagation();if(event.isComposing||composing||event.keyCode===229)return;if(event.key==='Backspace'&&!child.state.doc.length){event.preventDefault();event.stopImmediatePropagation();const callout=calloutRanges(view.state).find(item=>item.from===from);view.dispatch({effects:enterEmptyCalloutBody.of(null),selection:{anchor:callout?.headerTo??from}});view.focus();}if(event.key==='Enter'&&!event.shiftKey&&!child.state.doc.length){event.preventDefault();event.stopImmediatePropagation();const callout=calloutRanges(view.state).find(item=>item.from===from);view.dispatch({effects:enterEmptyCalloutBody.of(null)});if(callout)exitSemanticObject(view,callout,true);}},true);
    controls.set(wrapper,{focus(){child.focus();},update(next){from=next;},destroy(){alive=false;child.destroy();controls.delete(wrapper);}});queueMicrotask(()=>{if(alive&&wrapper.isConnected)child.focus();});return wrapper;
  }
  destroy(dom:HTMLElement){controls.get(dom)?.destroy();}
  ignoreEvent(){return true;}
}
