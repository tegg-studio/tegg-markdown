import type {ChangeDesc} from '@codemirror/state';
type DisplayEntry={kind:string;from:number;to:number;expanded:boolean;id:string;scrollLeft:number};
/** Display-only state lasts for one open document and follows source position mapping. */
export class ContentDisplaySession {
  private sequence=0;private entries:DisplayEntry[]=[];private listeners=new Set<()=>void>();
  expanded(kind:string,from:number,to:number,initial:boolean){let item=this.entries.find(entry=>entry.kind===kind&&entry.from===from);if(!item){item={kind,from,to,expanded:initial,id:'content-object-'+(++this.sequence),scrollLeft:0};this.entries.push(item);}else item.to=to;return item.expanded;}
  setExpanded(kind:string,from:number,to:number,value:boolean){this.expanded(kind,from,to,value);this.entries.find(entry=>entry.kind===kind&&entry.from===from)!.expanded=value;for(const listener of this.listeners)listener();}
  /** Read an already registered object without recreating an obsolete source key. */
  expandedById(id:string):boolean|undefined{return this.entries.find(entry=>entry.id===id)?.expanded;}
  setExpandedById(id:string,value:boolean):boolean{const item=this.entries.find(entry=>entry.id===id);if(!item)return false;item.expanded=value;for(const listener of this.listeners)listener();return true;}
  objectId(kind:string,from:number,to:number){this.expanded(kind,from,to,true);return this.entries.find(entry=>entry.kind===kind&&entry.from===from)!.id;}
  horizontalOffset(kind:string,from:number,to:number){this.objectId(kind,from,to);return this.entries.find(entry=>entry.kind===kind&&entry.from===from)!.scrollLeft;}
  setHorizontalOffset(kind:string,from:number,to:number,value:number){this.objectId(kind,from,to);this.entries.find(entry=>entry.kind===kind&&entry.from===from)!.scrollLeft=Math.max(0,Number.isFinite(value)?value:0);}
  remapped(position:(at:number)=>number):ContentDisplaySession {const parent=this;return new class extends ContentDisplaySession {
    override expanded(kind:string,from:number,to:number,initial:boolean){return parent.expanded(kind,position(from),position(to),initial);}
    override setExpanded(kind:string,from:number,to:number,value:boolean){parent.setExpanded(kind,position(from),position(to),value);}
    override expandedById(id:string){return parent.expandedById(id);}
    override setExpandedById(id:string,value:boolean){return parent.setExpandedById(id,value);}
    override objectId(kind:string,from:number,to:number){return parent.objectId(kind,position(from),position(to));}
    override horizontalOffset(kind:string,from:number,to:number){return parent.horizontalOffset(kind,position(from),position(to));}
    override setHorizontalOffset(kind:string,from:number,to:number,value:number){parent.setHorizontalOffset(kind,position(from),position(to),value);}
    override map(_changes:ChangeDesc){}override clear(){}override subscribe(listener:()=>void){return parent.subscribe(listener);}
  };}
  map(changes:ChangeDesc){this.entries=this.entries.filter(entry=>{if(entry.from>changes.length||entry.to>changes.length)return false;let removed=false,replaced=false,replacedStart=false;changes.iterChangedRanges((from,to,fromB,toB)=>{if(from<=entry.from&&to>entry.from&&toB>fromB)replacedStart=true;if(from<=entry.from&&to>=entry.to&&to>from){if(toB===fromB)removed=true;else replaced=true;}});if(removed)return false;entry.from=changes.mapPos(entry.from,replacedStart?-1:1);entry.to=changes.mapPos(entry.to,replaced?1:-1);return entry.to>=entry.from;});}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  clear(){this.entries=[];}
}
