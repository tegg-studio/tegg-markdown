import {editCurrentLink} from './liveLinks';
import {registerReferenceLinkContext,referenceDocumentSource,referenceLinkContext} from './referenceLinkEditing';
import {applySourcePatches,validateSourcePatches} from './sourcePatch';
import {attachNestedEditingUI} from './editingUI';
import {prepareEditingLeave} from './editingLeave';
import {commitMetadataPanel} from './metadata';
import {executeEditorCommand} from './editorToolbar';
import {getSupportedCommands} from './commandRegistry';
import {executeHtmlDirectCommand,htmlDirectEditingOwnsFocus,htmlDirectEditingIsComposing} from './htmlDirectEditing';
import {commitHtmlTableDrafts,executeHtmlTableCommand,htmlTableWidgetOwnsFocus,htmlTableWidgetIsComposing} from './htmlTableWidget';
import {commitTableDrafts,executeFocusedTableCommand,tableWidgetOwnsFocus,tableWidgetIsComposing} from './tableWidget';
import {EditorState,type Extension,type ChangeDesc} from '@codemirror/state';
import {EditorView,WidgetType} from '@codemirror/view';
import {markdown} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {isolateHistory} from '@codemirror/commands';
import {editorSetup} from './editorSetup';
import {dispatchSourcePatches} from './editorPatches';
import {resourceContext,displaySessionFor} from './editorHost';
import {undo,redo} from './selectionHistory';
import {setUILabel,setUIText} from './uiContext';
import {footnoteLayout,footnoteNavigation,type FootnoteGroup} from './footnoteLayout';
import {footnoteBodyPosition,type FootnoteReference} from './footnoteModel';
export type LiveFootnote={label:string;value:string;from:number;to:number;number?:number;missing?:boolean;draft?:boolean;duplicate?:boolean;key?:string;references?:readonly FootnoteReference[]};
type Mounted={update(notes:readonly LiveFootnote[]):boolean;destroy():void;focus(label:string):boolean;ready():boolean;focused():EditorView|null;sourceRange(child:EditorView,range:{from:number;to:number}):{from:number;to:number}|null;prepare():boolean;command(name:string):boolean};
const panels=new WeakMap<HTMLElement,Mounted>();
const views=new WeakMap<EditorView,Set<HTMLElement>>();
export function footnoteEditingIsComposing(view:EditorView):boolean{for(const panel of views.get(view)??[])if(!panels.get(panel)?.ready())return true;return false;}
export function focusedFootnoteEditor(view:EditorView):EditorView|null {for(const panel of views.get(view)??[]){const child=panels.get(panel)?.focused();if(child)return child;}return null;}
export function footnoteSourceRangeFor(view:EditorView,child:EditorView,range:{from:number;to:number}){for(const panel of views.get(view)??[]){const mapped=panels.get(panel)?.sourceRange(child,range);if(mapped)return mapped;}return null;}
export function executeFocusedFootnoteCommand(view:EditorView,command:string):boolean {
  const child=focusedFootnoteEditor(view);if(!child||view.state.readOnly||child.state.readOnly||child.composing||footnoteEditingIsComposing(view)||htmlDirectEditingIsComposing(child)||htmlTableWidgetIsComposing(child)||tableWidgetIsComposing(child))return false;
  const nestedFocus=htmlDirectEditingOwnsFocus(child)||htmlTableWidgetOwnsFocus(child)||tableWidgetOwnsFocus(child);
  if(nestedFocus){
    if(!['bold','italic','underline','strike','highlight','subscript','superscript','code','link','wikilink','undo','redo'].includes(command))return false;
    return executeHtmlDirectCommand(child,command)||executeHtmlTableCommand(child,command)||executeFocusedTableCommand(child,command);
  }
  if(routeFootnoteCommand(view,command))return true;
  if(!getSupportedCommands(child.state.facet(resourceContext).profile).includes(command))return false;
  if(command==='undo'||command==='redo'){const done=(command==='undo'?undo:redo)(view);child.focus();return done;}
  executeEditorCommand(child,command,'live');return true;
}
export function prepareFootnoteChildren(view:EditorView){for(const panel of views.get(view)??[])if(!panels.get(panel)?.prepare())return false;return true;}
export function routeFootnoteCommand(view:EditorView,name:string){for(const panel of views.get(view)??[])if(panels.get(panel)?.command(name))return true;return false;}
const returnPositions=new WeakMap<EditorView,Map<string,number>>();
export function rememberFootnoteReference(view:EditorView,label:string,from:number){const map=returnPositions.get(view)??new Map<string,number>();map.set(label,from);returnPositions.set(view,map);}
export function mapFootnoteReferences(view:EditorView,changes:ChangeDesc){for(const [label,from] of returnPositions.get(view)??[])returnPositions.get(view)!.set(label,changes.mapPos(from,1));}
export function focusFootnote(view:EditorView,label:string):boolean{for(const panel of views.get(view)??[])if(panels.get(panel)?.focus(label))return true;return false;}
function writeFootnote(raw:string,value:string){const header=raw.match(/^\[\^[^\]\n]+\]:[ \t]*/)?.[0];if(!header)throw new Error('The footnote changed.');const sourceLines=raw.split('\n'),oldLines=[sourceLines[0].slice(header.length),...sourceLines.slice(1).map(line=>line.replace(/^(?: {4}|\t)/,''))];return value.split('\n').map((line,index)=>line===oldLines[index]?sourceLines[index]:index?(sourceLines[index]?.match(/^(?: {4}|\t)/)?.[0]??'    ')+line:header+line).join('\n');}

/** Direct source-backed footnote bodies are projected together at the document end. */
export class LiveFootnoteSection extends WidgetType {
  constructor(readonly notes:readonly LiveFootnote[],readonly projection:Extension){super();}
  eq(other:WidgetType){return other instanceof LiveFootnoteSection&&JSON.stringify(this.notes)===JSON.stringify(other.notes);}
  updateDOM(dom:HTMLElement){return panels.get(dom)?.update(this.notes)??false;}
  toDOM(view:EditorView){
    const section=document.createElement('section');section.className='footnotes cm-live-footnotes';section.contentEditable='false';setUILabel(section,'Footnotes');
    const layout=footnoteLayout(section);const group=(note:LiveFootnote):FootnoteGroup=>note.missing?'missing':note.duplicate?'duplicates':note.number===undefined?'unreferenced':'main';const key=(note:LiveFootnote)=>note.key??note.label;
    const records=new Map<string,{note:LiveFootnote;editor:EditorView;node:HTMLElement;own:string|null;composing:boolean;base:string;error:HTMLElement;content:HTMLElement;mount:HTMLElement;number:HTMLElement;navigation?:HTMLElement;nested:ReturnType<typeof attachNestedEditingUI>;referenceCleanup?:()=>void;suppressParent?:boolean}>();
    const create=(note:LiveFootnote)=>{
      const item=document.createElement('li');item.className='footnote-item md-render-footnote-definition cm-live-footnote-definition';item.dataset.footnoteLabel=note.label;item.dataset.footnoteKey=key(note);item.dataset.sourceFrom=String(note.from);item.dataset.sourceTo=String(note.to);
      const content=document.createElement('div');content.className='footnote-content';const number=document.createElement('span');number.className='footnote-number';const mount=document.createElement('div');mount.className='footnote-body';const error=document.createElement('div');error.setAttribute('role','alert');content.append(mount,error);item.append(number,content);layout.group(group(note)).list.append(item);
      const record={suppressParent:false,referenceCleanup:undefined as (()=>void)|undefined,note,editor:null as unknown as EditorView,node:item,own:null as string|null,composing:false,base:view.state.sliceDoc(note.from,note.to),error,content,mount,number,navigation:undefined as HTMLElement|undefined,nested:null as ReturnType<typeof attachNestedEditingUI>};
      const commit=(isolated=false)=>{
        if(record.suppressParent||record.composing||record.editor.composing)return;
        const value=record.editor.state.doc.toString();if(value===record.note.value||record.note.missing&&!value.trim())return;
        const raw=view.state.sliceDoc(record.note.from,record.note.to);
        if(view.state.readOnly){error.textContent='This document is read-only.';return;}
        if(raw!==record.base){error.textContent='The footnote changed. Your input is retained.';return;}
        const next=record.note.missing?(view.state.doc.length&&!view.state.doc.toString().endsWith('\n\n')?'\n\n':'')+'[^'+record.note.label+']: '+value.split('\n').map((line,index)=>index?'    '+line:line).join('\n'):writeFootnote(raw,value);record.own=value;
        try{dispatchSourcePatches(view,[{from:record.note.from,to:record.note.to,expected:raw,insert:next}],{userEvent:'input.type',isolateHistory:isolated});}catch(failure){error.textContent=failure instanceof Error?failure.message:'Could not edit the footnote.';}
      };
      const editor=new EditorView({parent:mount,state:EditorState.create({doc:note.value,extensions:[editorSetup,markdown({extensions:GFM}),resourceContext.of({...view.state.facet(resourceContext),displaySession:displaySessionFor(view).remapped(at=>record.note.from+footnoteBodyPosition(view.state.sliceDoc(record.note.from,record.note.to),at))}),EditorView.lineWrapping,this.projection,EditorState.readOnly.of(view.state.readOnly)]}),dispatchTransactions:transactions=>{editor.update(transactions);if(transactions.some(tr=>tr.docChanged))commit(transactions.some(tr=>tr.annotation(isolateHistory)!==undefined));}});record.editor=editor;record.referenceCleanup=registerReferenceLinkContext(editor,{source:()=>referenceDocumentSource(view),applyShared:(shared,local=[])=>{
        try{if(view.state.readOnly||editor.composing||record.composing||view.state.sliceDoc(record.note.from,record.note.to)!==record.base)return false;const full=referenceDocumentSource(view);validateSourcePatches(full,shared);const value=applySourcePatches(editor.state.doc.toString(),local),raw=view.state.sliceDoc(record.note.from,record.note.to),next=writeFootnote(raw,value),patches=next===raw?[]:[{from:record.note.from,to:record.note.to,expected:raw,insert:next}];const inherited=referenceLinkContext(view);
          record.suppressParent=true;if(local.length)dispatchSourcePatches(editor,local,{isolateHistory:true});record.suppressParent=false;record.own=value;
          if(inherited)return inherited.applyShared(shared,patches);dispatchSourcePatches(view,[...patches,...shared],{isolateHistory:true});return true;
        }catch(failure){record.suppressParent=false;error.textContent=failure instanceof Error?failure.message:String(failure);return false;}
      }});
      editor.dom.addEventListener('tegg-edit-object',event=>{event.preventDefault();event.stopImmediatePropagation();record.nested??=attachNestedEditingUI(view,editor);const detail=(event as CustomEvent).detail;if(record.nested&&detail)record.nested.ui.openObject(detail.kind,detail.to===undefined?undefined:{from:detail.from,to:detail.to},detail.from,detail.create===true);});
      editor.dom.addEventListener('tegg-table-resource-paste',event=>{if(event.target===editor.dom)return;event.preventDefault();event.stopImmediatePropagation();record.nested??=attachNestedEditingUI(view,editor);if(record.nested)editor.dom.dispatchEvent(new CustomEvent('tegg-table-resource-paste',{cancelable:true,detail:(event as CustomEvent).detail}));});
      editor.dom.addEventListener('tegg-source-mode-request',event=>{event.preventDefault();event.stopImmediatePropagation();const detail=(event as CustomEvent).detail;if(!Number.isInteger(detail?.from))return;const from=record.note.from+footnoteBodyPosition(view.state.sliceDoc(record.note.from,record.note.to),detail.from);view.dom.dispatchEvent(new CustomEvent('tegg-source-mode-request',{bubbles:true,cancelable:true,detail:{...detail,from}}));});
      editor.dom.addEventListener('compositionstart',()=>{record.base=view.state.sliceDoc(record.note.from,record.note.to);record.composing=true;});editor.dom.addEventListener('compositionend',()=>{record.composing=false;commit();});
      editor.dom.addEventListener('keydown',event=>{event.stopPropagation();if(event.isComposing||record.composing)return;if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();executeFocusedFootnoteCommand(view,event.shiftKey?'redo':'undo');}});
      records.set(key(note),record);return record;
    };
    const update=(notes:readonly LiveFootnote[])=>{
      const labels=new Set(notes.map(key));for(const [id,record]of records)if(!labels.has(id)){record.referenceCleanup?.();record.nested?.destroy();record.editor.destroy();record.node.remove();records.delete(id);}
      for(const note of [...notes].sort((a,b)=>(a.number??Infinity)-(b.number??Infinity))){const record=records.get(key(note))??create(note);const previous=record.note;record.note=note;if(!record.composing)record.base=view.state.sliceDoc(note.from,note.to);record.node.dataset.sourceFrom=String(note.from);record.node.dataset.sourceTo=String(note.to);record.number.textContent=note.missing?'?':note.number===undefined?'':String(note.number);
        if(note.missing)setUILabel(record.editor.contentDOM,'Undefined footnote: {label}',{label:note.label});
        else if(note.duplicate)setUILabel(record.editor.contentDOM,'Repeated footnote definition: {label}',{label:note.label});
        else if(note.number===undefined)setUILabel(record.editor.contentDOM,'Unreferenced footnote: {label}',{label:note.label});
        else setUILabel(record.editor.contentDOM,'Footnote {value}',{value:String(note.number)});
        const target=layout.group(group(note)).list;if(record.node.parentElement!==target){const focused=record.editor.hasFocus;target.append(record.node);if(focused)record.editor.focus();}
        record.content.querySelectorAll(':scope > .footnote-label,:scope > .footnote-missing-description,:scope > .footnote-duplicate-description').forEach(node=>node.remove());
        if(group(note)!=='main'){const label=document.createElement('code');label.className='footnote-label';label.textContent=note.label;record.content.prepend(label);}if(note.missing){const explanation=document.createElement('p');explanation.className='footnote-missing-description';setUIText(explanation,'This footnote has no definition.');record.content.insertBefore(explanation,record.mount);}else if(note.duplicate){const warning=document.createElement('p');warning.className='footnote-duplicate-description';setUIText(warning,'This label has repeated definitions. Each source definition is preserved.');record.content.insertBefore(warning,record.mount);}
        record.mount.hidden=!!note.missing&&!note.draft;
        const references=note.references??[];
        if(!record.navigation||JSON.stringify(previous.references)!==JSON.stringify(note.references)){record.navigation?.remove();record.navigation=references.length?footnoteNavigation(references,reference=>{rememberFootnoteReference(view,note.label,reference.from);view.dom.querySelector<HTMLElement>('[data-footnote-reference-from="'+reference.from+'"]')?.focus({preventScroll:true});}):undefined;if(record.navigation)record.content.append(record.navigation);}
        if(record.editor.state.doc.toString()!==note.value&&!record.composing){const selection=record.editor.state.selection.main;record.editor.dispatch({changes:{from:0,to:record.editor.state.doc.length,insert:note.value},selection:{anchor:Math.min(selection.anchor,note.value.length),head:Math.min(selection.head,note.value.length)}});}record.own=null;
      }layout.prune();return true;
    };
    const set=views.get(view)??new Set<HTMLElement>();set.add(section);views.set(view,set);
    panels.set(section,{update,prepare(){for(const record of records.values()){if(record.nested){if(!prepareEditingLeave(record.editor,record.nested.ui.element,record.nested.controller))return false;}else {if(!commitTableDrafts(record.editor)||!commitHtmlTableDrafts(record.editor)||!prepareFootnoteChildren(record.editor))return false;for(const panel of record.editor.dom.querySelectorAll<HTMLElement>('.frontmatter'))if(!commitMetadataPanel(panel))return false;}}return true;},command(name){const record=[...records.values()].find(item=>item.editor.hasFocus||item.editor.dom.contains(document.activeElement));if(!record||record.composing||record.editor.composing||record.editor.state.readOnly||htmlDirectEditingOwnsFocus(record.editor)||htmlTableWidgetOwnsFocus(record.editor)||tableWidgetOwnsFocus(record.editor))return false;if(name==='link'&&editCurrentLink(record.editor))return true;const objects:Record<string,string>={formula:'math',math:'math',mermaid:'mermaid',graphviz:'graphviz',image:'image',link:'link',footnote:'footnote'};const kind=objects[name];if(!kind&&name!=='edit-object')return false;record.nested??=attachNestedEditingUI(view,record.editor);if(!record.nested)return false;record.nested.ui.openObject(kind as Parameters<typeof record.nested.ui.openObject>[0]);return true;},focused(){return [...records.values()].find(record=>record.editor.hasFocus||record.editor.dom.contains(document.activeElement))?.editor??null;},sourceRange(child,range){const record=[...records.values()].find(record=>record.editor===child);if(!record)return null;const raw=view.state.sliceDoc(record.note.from,record.note.to);return {from:record.note.from+footnoteBodyPosition(raw,range.from),to:record.note.from+footnoteBodyPosition(raw,range.to)};},ready(){return ![...records.values()].some(record=>record.composing||record.editor.composing||htmlDirectEditingIsComposing(record.editor)||htmlTableWidgetIsComposing(record.editor)||tableWidgetIsComposing(record.editor)||record.editor.dom.querySelector('[data-callout-temporary-composing="true"]'));},focus(label){const record=[...records.values()].find(item=>item.note.label===label);if(!record)return false;record.mount.hidden=false;record.editor.focus();record.editor.dispatch({selection:{anchor:0},scrollIntoView:true});record.node.scrollIntoView?.({block:'nearest'});return true;},destroy(){for(const record of records.values()){record.referenceCleanup?.();record.nested?.destroy();record.editor.destroy();}records.clear();set.delete(section);panels.delete(section);}});
    update(this.notes);return section;
  }
  destroy(dom:HTMLElement){panels.get(dom)?.destroy();}
  ignoreEvent(){return true;}
}
