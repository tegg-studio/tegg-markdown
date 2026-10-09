import type {EditorView} from '@codemirror/view';

/** Internal mounted-table actions. Never infer ownership from author attributes. */
export type TableAction = {readonly id:string;readonly label:string};
export type TableActionKind = 'gfm'|'html';
export const gfmTableActions:readonly TableAction[] = [
  {id:'edit-cell',label:'Edit cell'},
  {id:'add-row',label:'Add Row'}, {id:'add-column',label:'Add Column'},
  {id:'select-range',label:'Select range'}, {id:'copy-cells',label:'Copy cells'},
  {id:'cut-cells',label:'Cut cells'}, {id:'paste-cells',label:'Paste'},
  {id:'paste-plain',label:'Paste plain text'}, {id:'merge-cells',label:'Merge cells'},
  {id:'insert-paragraph',label:'Insert paragraph'}, {id:'keep-empty-paragraph',label:'Keep empty paragraph'},
  {id:'edit-source',label:'Edit Source'}, {id:'row-before',label:'Insert row before'},
  {id:'row-after',label:'Insert row after'}, {id:'delete-row',label:'Delete row'},
  {id:'column-before',label:'Insert column before'}, {id:'column-after',label:'Insert column after'},
  {id:'delete-column',label:'Delete column'}, {id:'align-left',label:'Align left'},
  {id:'align-center',label:'Align center'}, {id:'align-right',label:'Align right'},
  {id:'align-none',label:'Clear alignment'}, {id:'delete-table',label:'Delete table'},
];
export const htmlTableActions:readonly TableAction[] = [
  {id:'edit-cell',label:'Edit cell'}, {id:'copy-cells',label:'Copy cells'},
  {id:'cut-cells',label:'Cut cells'}, {id:'paste-cells',label:'Paste'},
  {id:'paste-plain',label:'Paste plain text'}, {id:'delete-table',label:'Delete table'},
  {id:'insert-paragraph',label:'Insert paragraph'}, {id:'insert-list-item',label:'Insert list item'},
  {id:'keep-empty-paragraph',label:'Keep empty paragraph'}, {id:'range-start',label:'Set range start'},
  {id:'range-end',label:'Set range end'}, {id:'clear-content',label:'Clear content'},
  {id:'merge-cells',label:'Merge cells'}, {id:'unmerge-cell',label:'Unmerge cell'},
  {id:'row-below',label:'Insert row below'}, {id:'column-after',label:'Insert column after'},
  {id:'delete-row',label:'Delete row'}, {id:'delete-column',label:'Delete column'},
];
export type TableActionLease = {
  readonly kind:TableActionKind;
  readonly readOnly:boolean;
  readonly items:readonly TableAction[];
  current():boolean;
  /** true means accepted by the original action, not asynchronous clipboard completion. */
  execute(id:string):boolean;
};
type MountedTableActions = {
  readonly panel:HTMLElement;
  readonly kind:TableActionKind;
  from():number;
  containsPreview(node:Node):boolean;
  /** Capture real source/context/range ownership in the widget which owns them. */
  capture():Omit<TableActionLease,'kind'|'items'>|null;
};
const mounted = new WeakMap<EditorView,Set<MountedTableActions>>();
export function registerTableActions(view:EditorView,entry:MountedTableActions):()=>void {
  let entries=mounted.get(view);if(!entries){entries=new Set();mounted.set(view,entries);}
  entries.add(entry);
  let disposed=false;
  return ()=>{if(disposed)return;disposed=true;entries!.delete(entry);if(!entries!.size&&mounted.get(view)===entries)mounted.delete(view);};
}
export function captureTableActions(view:EditorView,from:number,options:{readOnly?:boolean}={}):TableActionLease|null {
  const matches=[...mounted.get(view)??[]].filter(entry=>entry.from()===from&&
    entry.panel.isConnected&&view.dom.contains(entry.panel));
  // Multiple actual owners at the same range are ambiguous; do not pick by DOM order.
  if(matches.length!==1)return null;
  const entry=matches[0],captured=entry.capture();if(!captured)return null;
  const readOnly=captured.readOnly||!!options.readOnly,catalog=entry.kind==='gfm'?gfmTableActions:htmlTableActions;
  const items=readOnly?catalog.filter(item=>item.id==='copy-cells'):catalog;
  const current=()=>mounted.get(view)?.has(entry)===true&&entry.from()===from&&
    entry.panel.isConnected&&view.dom.contains(entry.panel)&&captured.current();
  return {kind:entry.kind,readOnly,items,current,execute(id){
    if(!current()||!items.some(item=>item.id===id))return false;
    return captured.execute(id);
  }};
}

/** Actual mounted preview ownership for touch targeting; never read author source attributes. */
export function tableActionsAtNode(view:EditorView,node:Node,options:{readOnly?:boolean}={}):{from:number;panel:HTMLElement}|null {
  const matches=[...mounted.get(view)??[]].filter(entry=>entry.panel.isConnected&&
    view.dom.contains(entry.panel)&&entry.containsPreview(node));
  if(matches.length!==1)return null;
  const entry=matches[0],from=entry.from(),lease=captureTableActions(view,from,options);
  return lease?.current()?{from,panel:entry.panel}:null;
}
