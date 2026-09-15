import {WidgetType, type EditorView} from '@codemirror/view';
import {undo,redo} from '@codemirror/commands';
import {resourceContext} from './editorHost';
import {parseMarkdownTable} from './table';
import {applyTableOperation,copyTableRectangle,nextTablePosition,TableEditingError,type TablePosition,type TableRectangle,type TableOperation} from './tableEditing';
import {captureClipboard,preparePaste,type PastePreparation} from './clipboard';
import {dispatchSourcePatches} from './editorPatches';
import {parserFor} from './markdownParser';
import {sanitizeRenderedHtml} from './renderKit';
import {setUIText,setUILabel} from './uiContext';
import {makeHorizontalScrollRegion} from './localScroll';
import './tableEditing.css';

type FocusRequest={from:number;at:TablePosition;edit:boolean};
const focusRequests=new WeakMap<EditorView,FocusRequest>();
const mounted=new WeakMap<HTMLElement,{update(source:string,from:number,to:number):boolean;destroy():void}>();
export class EditableTableWidget extends WidgetType {
  constructor(readonly source:string,readonly from:number,readonly to:number){super();}
  eq(other:WidgetType){return other instanceof EditableTableWidget&&other.source===this.source&&other.from===this.from&&other.to===this.to;}
  updateDOM(dom:HTMLElement){return mounted.get(dom)?.update(this.source,this.from,this.to)??false;}
  toDOM(view:EditorView){
    let source=this.source,from=this.from,to=this.to,latest=this.source,stale=false,destroyed=false;
    let selected:TablePosition={row:0,column:0},anchor:TablePosition|null=null,rectangle:TableRectangle={from:selected,to:selected};
    let editing:{at:TablePosition;input:HTMLInputElement;original:string;preview:HTMLButtonElement;composing:boolean}|null=null;
    let pendingPaste:PastePreparation|null=null,pendingOperation:TableOperation|null=null;
    const panel=document.createElement('section');panel.className='cm-live-table md-render-table';panel.dataset.teggTableFrom=String(from);
    makeHorizontalScrollRegion(panel,'Editable table. Scroll horizontally for more columns.');
    const error=document.createElement('div');error.className='md-table-error';error.setAttribute('role','alert');
    const status=document.createElement('div');status.className='md-table-status';status.setAttribute('role','status');
    const sheet=document.createElement('div');sheet.className='md-table-cell-panel';sheet.hidden=true;sheet.setAttribute('role','group');setUILabel(sheet,'Current table cell');
    const sheetPosition=document.createElement('div');sheetPosition.className='md-table-position';
    const field=document.createElement('input');field.className='md-table-sheet-input';setUILabel(field,'Cell value');
    const review=document.createElement('div');review.className='md-table-paste-review';review.hidden=true;review.setAttribute('role','group');setUILabel(review,'Review table paste');
    const reviewText=document.createElement('p'),reviewData=document.createElement('pre');reviewData.className='md-table-paste-preview';
    const controls=new Map<string,{button:HTMLButtonElement;input:HTMLInputElement;cell:HTMLElement;value:string}>();
    const key=(at:TablePosition)=>at.row+':'+at.column;
    const narrow=()=>typeof window!=='undefined'&&window.innerWidth<640;
    const report=(failure:unknown)=>{setUIText(error,failure instanceof Error?failure.message:String(failure));};
    const button=(title:string,run:()=>void)=>{const result=document.createElement('button');result.type='button';setUIText(result,title);result.addEventListener('click',run);return result;};
    const selectedLabel=()=>{
      const table=parseMarkdownTable(source),header=table?.headers[selected.column]??'';
      setUIText(sheetPosition,'Row {row}, column {column}: {header}',{row:String(selected.row+1),column:String(selected.column+1),header});
      setUIText(status,'Row {row}, column {column}: {header}',{row:String(selected.row+1),column:String(selected.column+1),header});
    };
    const paintSelection=()=>{
      const top=Math.min(rectangle.from.row,rectangle.to.row),bottom=Math.max(rectangle.from.row,rectangle.to.row),left=Math.min(rectangle.from.column,rectangle.to.column),right=Math.max(rectangle.from.column,rectangle.to.column);
      controls.forEach(({cell},id)=>{const [row,column]=id.split(':').map(Number);const active=row>=top&&row<=bottom&&column>=left&&column<=right;cell.classList.toggle('is-selected',active);cell.setAttribute('aria-selected',String(active));});selectedLabel();
    };
    const select=(at:TablePosition,extend=false)=>{selected={...at};rectangle=extend?{from:anchor??rectangle.from,to:selected}:{from:selected,to:selected};if(!extend)anchor=null;paintSelection();};
    const safe=()=>{if(destroyed||stale||view.state.sliceDoc(from,to)!==source)throw new Error('The table changed. Your cell draft is retained. Cancel to reload the table.');if(view.state.readOnly)throw new Error('This document is read-only.');if(view.composing||editing?.composing)throw new Error('Finish composing text before changing the table.');};
    const focus=(at:TablePosition,edit=false)=>{
      const control=controls.get(key(at));if(!control)return;select(at);if(edit)start(at);else control.button.focus({preventScroll:true});
    };
    const apply=(operation:TableOperation,options:{allowExpansion?:boolean;focus?:TablePosition;edit?:boolean}={})=>{
      try{
        safe();const result=applyTableOperation(source,operation,{allowExpansion:options.allowExpansion});
        if(result.requiresConfirmation){pendingOperation=operation;review.hidden=false;setUIText(reviewText,'This paste expands the table to {rows} rows and {columns} columns.',{rows:String(result.expansion!.rows),columns:String(result.expansion!.columns)});reviewData.textContent=operation.type==='paste'?operation.cells.map(row=>row.join('\t')).join('\n'):'';return false;}
        if(!result.patches.length){if(options.focus)focus(options.focus,options.edit);return true;}
        focusRequests.set(view,{from,at:options.focus??result.selection,edit:options.edit??false});
        dispatchSourcePatches(view,result.patches.map(patch=>({...patch,from:from+patch.from,to:from+patch.to})),{isolateHistory:true});
        if(operation.type==='delete-table'){view.dispatch({selection:{anchor:Math.min(from,view.state.doc.length)}});view.focus();}
        return true;
      }catch(failure){report(failure);return false;}
    };
    const finish=(save:boolean,destination?:TablePosition)=>{
      if(!editing)return true;
      const current=editing;if(current.composing)return false;
      const value=narrow()?field.value:current.input.value;
      if(save){try{safe();}catch(failure){report(failure);return false;}}
      editing=null;sheet.hidden=true;current.input.hidden=true;current.preview.hidden=false;
      if(!save){current.input.value=current.original;field.value=current.original;if(stale){source=latest;stale=false;render();}else current.preview.focus({preventScroll:true});return true;}
      if(value!==current.original){const success=apply({type:'cell',at:current.at,value},{focus:destination??current.at,edit:!!destination});if(!success){editing=current;current.input.hidden=narrow();current.preview.hidden=!narrow();sheet.hidden=!narrow();}return success;}
      if(destination)focus(destination,true);else current.preview.focus({preventScroll:true});return true;
    };
    const navigate=(direction:1|-1)=>{
      try{
        const at=editing?.at??selected;
        const current=editing,original=current?.original,value=current?(narrow()?field.value:current.input.value):undefined;
        if(current?.composing)return;
        safe();
        const step=nextTablePosition(source,at,direction);
        if(step.exit){finish(true);const first=panel.querySelector<HTMLButtonElement>('.cm-preview-toolbar button');first?.focus();return;}
        if(step.appendRow){
          // Save the current cell and append in one source transaction.
          let next=source;if(value!==undefined&&value!==original)next=applyTableOperation(next,{type:'cell',at,value}).source;
          next=applyTableOperation(next,{type:'insert-row',index:step.position.row}).source;
          editing=null;sheet.hidden=true;focusRequests.set(view,{from,at:step.position,edit:true});
          dispatchSourcePatches(view,[{from,to,expected:source,insert:next}],{isolateHistory:true});
        }else if(current)finish(true,step.position);else focus(step.position,true);
      }catch(failure){report(failure);}
    };
    const start=(at:TablePosition)=>{
      if(editing){if(key(editing.at)!==key(at))finish(true,at);return;}
      const control=controls.get(key(at));if(!control)return;select(at);error.textContent='';
      editing={at:{...at},input:control.input,original:control.value,preview:control.button,composing:false};
      control.input.value=control.value;field.value=control.value;
      if(narrow()){sheet.hidden=false;selectedLabel();field.focus();field.select();}
      else{control.button.hidden=true;control.input.hidden=false;control.input.focus();control.input.select();}
    };
    const copy=async()=>{
      try{const text=copyTableRectangle(source,rectangle);const event=new CustomEvent('tegg-copy-text',{detail:text,bubbles:true,cancelable:true});if(!panel.dispatchEvent(event))return;await navigator.clipboard.writeText(text);setUIText(status,'Copied');}
      catch{setUIText(error,'Copy unavailable. Select the source to copy.');}
    };
    const paste=(event:ClipboardEvent)=>{
      if(!event.clipboardData)return;
      const prepared=preparePaste(captureClipboard(event.clipboardData),{target:'table-cell'});
      if(!prepared.cells)return; // ordinary cell text stays in its own input history
      event.preventDefault();event.stopPropagation();pendingPaste=prepared;
      if(prepared.status!=='ready'){review.hidden=false;reviewText.textContent=prepared.issues.map(issue=>issue.message).join(' ');reviewData.textContent=prepared.plainText||prepared.cells.map(row=>row.join('\t')).join('\n');return;}
      const at=editing?.at??selected;if(editing?.composing)return;
      if(prepared.resources.length){
        try{safe();const planned=applyTableOperation(source,{type:'paste',at,cells:prepared.cells});
          if(planned.requiresConfirmation){pendingOperation={type:'paste',at,cells:prepared.cells};review.hidden=false;setUIText(reviewText,'This paste expands the table to {rows} rows and {columns} columns.',{rows:String(planned.expansion!.rows),columns:String(planned.expansion!.columns)});reviewData.textContent=prepared.plainText;return;}
          const delegated=new CustomEvent('tegg-table-resource-paste',{bubbles:true,cancelable:true,detail:{from,to,expected:source,prepared:{...prepared,markdown:planned.source,cells:undefined}}});
          if(panel.dispatchEvent(delegated))report('This Host does not support storing attachments.');else{editing=null;sheet.hidden=true;}
        }catch(failure){report(failure);}return;
      }
      editing=null;sheet.hidden=true;
      apply({type:'paste',at,cells:prepared.cells});
    };
    const inputKeys=(event:KeyboardEvent)=>{
      event.stopPropagation();if(event.isComposing||event.keyCode===229)return;
      if(event.key==='Escape'){event.preventDefault();finish(false);}
      if(event.key==='Enter'){event.preventDefault();finish(true);}
      if(event.key==='Tab'){event.preventDefault();navigate(event.shiftKey?-1:1);}
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){
        // Draft text uses the platform input undo; after committing the document owns undo.
        if(!editing){event.preventDefault();(event.shiftKey?redo:undo)(view);}
      }
    };
    field.addEventListener('keydown',inputKeys);field.addEventListener('paste',paste);
    field.addEventListener('compositionstart',()=>{if(editing)editing.composing=true;});field.addEventListener('compositionend',()=>{if(editing)editing.composing=false;});
    const sheetActions=document.createElement('div');sheetActions.className='md-table-cell-actions';
    sheetActions.append(button('Previous cell',()=>navigate(-1)),button('Next cell',()=>navigate(1)),button('Apply',()=>finish(true)),button('Cancel',()=>finish(false)));
    sheet.append(sheetPosition,field,sheetActions);
    review.append(reviewText,reviewData,button('Apply simplified paste',()=>{
      if(pendingPaste){const prepared=preparePaste(pendingPaste.original,{target:'table-cell',acceptSimplification:true});if(prepared.status!=='ready'||!prepared.cells){report('The paste cannot be simplified safely. The original input is retained.');return;}pendingPaste=prepared;pendingOperation={type:'paste',at:editing?.at??selected,cells:prepared.cells};}
      if(!pendingOperation)return;
      if(pendingPaste?.resources.length){
        try{safe();const prepared=pendingPaste;const planned=applyTableOperation(source,pendingOperation,{allowExpansion:true});
          const delegated=new CustomEvent('tegg-table-resource-paste',{bubbles:true,cancelable:true,detail:{from,to,expected:source,prepared:{...prepared,markdown:planned.source,cells:undefined}}});
          if(panel.dispatchEvent(delegated))report('This Host does not support storing attachments.');else{editing=null;sheet.hidden=true;review.hidden=true;pendingPaste=null;pendingOperation=null;}
        }catch(failure){report(failure);}return;
      }
      editing=null;sheet.hidden=true;
      if(apply(pendingOperation,{allowExpansion:true})){pendingPaste=null;pendingOperation=null;review.hidden=true;}
    }),button('Cancel paste',()=>{pendingPaste=null;pendingOperation=null;review.hidden=true;}));
    const render=()=>{
      const model=parseMarkdownTable(source);if(!model){panel.textContent=source;return;}
      controls.clear();panel.replaceChildren();panel.dataset.teggTableFrom=String(from);
      const toolbar=document.createElement('div');toolbar.className='cm-preview-toolbar';toolbar.contentEditable='false';
      const label=document.createElement('span');setUIText(label,'{rows} rows × {columns} columns',{rows:String(model.rows.length),columns:String(model.headers.length)});
      const actions=document.createElement('div');actions.className='md-table-actions';
      const action=(operation:TableOperation)=>{
        if(!editing){apply(operation);return;}
        try{
          safe();const current=editing,value=narrow()?field.value:current.input.value;
          let next=value===current.original?source:applyTableOperation(source,{type:'cell',at:current.at,value}).source;
          const result=applyTableOperation(next,operation);next=result.source;
          editing=null;sheet.hidden=true;focusRequests.set(view,{from,at:result.selection,edit:false});
          dispatchSourcePatches(view,[{from,to,expected:source,insert:next}],{isolateHistory:true});
        }catch(failure){report(failure);}
      };
      actions.append(button('Add Row',()=>action({type:'insert-row',index:model.rows.length+1})),button('Add Column',()=>action({type:'insert-column',index:model.headers.length})),button('Select range',()=>{if(editing&&!finish(true))return;anchor={...selected};setUIText(status,'Select the opposite corner of the range.');}),button('Copy cells',()=>{void copy();}));
      const menu=document.createElement('select');setUILabel(menu,'Table actions');
      for(const [value,label] of [['','Table actions'],['row-before','Insert row before'],['row-after','Insert row after'],['delete-row','Delete row'],['column-before','Insert column before'],['column-after','Insert column after'],['delete-column','Delete column'],['align-left','Align left'],['align-center','Align center'],['align-right','Align right'],['align-none','Clear alignment'],['delete-table','Delete table']]){const option=document.createElement('option');option.value=value;setUIText(option,label);menu.append(option);}
      menu.addEventListener('change',()=>{
        const value=menu.value;menu.value='';
        if(value==='delete-table'){review.hidden=false;setUIText(reviewText,'Delete this table? Undo can restore it.');reviewData.textContent=source;pendingOperation={type:'delete-table'};pendingPaste=null;return;}
        if(value==='row-before')action({type:'insert-row',index:selected.row});
        if(value==='row-after')action({type:'insert-row',index:selected.row+1});
        if(value==='delete-row')action({type:'delete-row',index:selected.row});
        if(value==='column-before')action({type:'insert-column',index:selected.column});
        if(value==='column-after')action({type:'insert-column',index:selected.column+1});
        if(value==='delete-column')action({type:'delete-column',index:selected.column});
        if(value.startsWith('align-'))action({type:'align',column:selected.column,alignment:value==='align-none'?null:value.slice(6) as 'left'|'center'|'right'});
      });actions.append(menu,button('Edit Source',()=>{if(editing&&!finish(true))return;view.dispatch({selection:{anchor:from},scrollIntoView:true});view.focus();}));
      toolbar.append(label,actions);
      const table=document.createElement('table');table.setAttribute('role','grid');setUILabel(table,'Editable Markdown table');
      const head=document.createElement('thead'),body=document.createElement('tbody');
      [model.headers,...model.rows].forEach((row,r)=>{
        const tr=document.createElement('tr');row.forEach((value,c)=>{
          const at={row:r,column:c},cell=document.createElement(r===0?'th':'td');cell.setAttribute('role',r===0?'columnheader':'gridcell');
          const shell=document.createElement('div');shell.className='cm-live-table-cell';if(model.alignments[c])shell.dataset.align=model.alignments[c]!;
          const preview=document.createElement('button');preview.type='button';preview.className='cm-live-table-preview';setUILabel(preview,'Edit table cell: {value}',{value});
          const context=view.state.facet(resourceContext);preview.innerHTML=sanitizeRenderedHtml(parserFor(context.profile).renderInline(value),context.documentPath,context.resolveImage);
          if(!value)preview.textContent='\u00a0';
          const input=document.createElement('input');input.value=value;input.hidden=true;setUILabel(input,'Table cell: {value}',{value:value||'Empty'});
          preview.addEventListener('click',event=>{if(event.shiftKey||anchor){if(editing&&!finish(true))return;select(at,true);}else start(at);});
          preview.addEventListener('keydown',event=>{
            if(event.key==='Enter'||event.key==='F2'){event.preventDefault();start(at);}
            if(event.key==='Tab'){event.preventDefault();select(at);navigate(event.shiftKey?-1:1);}
            if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){
              event.preventDefault();const destination={row:Math.max(0,Math.min(model.rows.length,at.row+(event.key==='ArrowDown'?1:event.key==='ArrowUp'?-1:0))),column:Math.max(0,Math.min(model.headers.length-1,at.column+(event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0)))};
              if(event.shiftKey){anchor??={...at};select(destination,true);controls.get(key(destination))?.button.focus();}else focus(destination);
            }
            if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='c'){event.preventDefault();void copy();}
          });preview.addEventListener('paste',paste);
          input.addEventListener('keydown',inputKeys);input.addEventListener('paste',paste);
          input.addEventListener('compositionstart',()=>{if(editing)editing.composing=true;});input.addEventListener('compositionend',()=>{if(editing)editing.composing=false;});
          input.addEventListener('blur',event=>{if(editing?.input!==input||editing.composing)return;if(event.relatedTarget instanceof Node&&panel.contains(event.relatedTarget))return;finish(true);});
          controls.set(key(at),{button:preview,input,cell,value});shell.append(preview,input);cell.append(shell);tr.append(cell);
        });(r===0?head:body).append(tr);
      });table.append(head,body);panel.append(toolbar,status,table,sheet,review,error);paintSelection();
      const request=focusRequests.get(view);if(request?.from===from){focusRequests.delete(view);queueMicrotask(()=>{if(!destroyed&&panel.isConnected)focus(request.at,request.edit);});}
    };
    panel.addEventListener('keydown',event=>{if(event.key==='Escape'&&!editing){anchor=null;rectangle={from:selected,to:selected};paintSelection();view.focus();}});
    mounted.set(panel,{update(next,start,end){from=start;to=end;latest=next;panel.dataset.teggTableFrom=String(from);if(next===source)return true;if(editing||!review.hidden){stale=true;report('The table changed. Your cell draft is retained. Cancel to reload the table.');return true;}return false;},destroy(){destroyed=true;mounted.delete(panel);}});
    render();return panel;
  }
  destroy(dom:HTMLElement){mounted.get(dom)?.destroy();}
  ignoreEvent(){return true;}
}
