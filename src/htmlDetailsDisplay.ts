import type {ContentDisplaySession} from './contentDisplaySession';

type DetailsEntry={element:HTMLDetailsElement;from:number;to:number;id?:string};
/** Synchronizes only the actual details nodes supplied by an owned projection. */
export function bindHtmlDetailsDisplay(session:ContentDisplaySession,entries:()=>readonly DetailsEntry[],canPaint:()=>boolean=()=>true){
  let alive=true;const listeners=new Map<HTMLDetailsElement,()=>void>();
  const sync=()=>{
    if(!alive||!canPaint())return;
    for(const entry of entries()){
      const {element,from,to}=entry;
      if(!listeners.has(element)){
        const toggle=()=>{if(!alive)return;const current=entries().find(item=>item.element===element);if(current){if(current.id)session.setExpandedById(current.id,element.open);else session.setExpanded('html-details',current.from,current.to,element.open);}};
        listeners.set(element,toggle);element.addEventListener('toggle',toggle);
      }
      const expanded=entry.id?session.expandedById(entry.id):session.expanded('html-details',from,to,element.open);
      if(expanded!==undefined&&element.open!==expanded)element.open=expanded;
    }
  };
  const stop=session.subscribe(sync);sync();
  return {sync,remember:()=>{
    if(!alive)return;
    // Broadcasting the first write may repaint later nodes. Capture all native
    // states first so a pending toggle cannot be replaced by that repaint.
    const snapshot=entries().map(entry=>({...entry,expanded:entry.element.open}));
    for(const entry of snapshot){if(entry.id)session.setExpandedById(entry.id,entry.expanded);else session.setExpanded('html-details',entry.from,entry.to,entry.expanded);}
  },dispose:()=>{alive=false;stop();for(const [element,toggle] of listeners)element.removeEventListener('toggle',toggle);listeners.clear();}};
}
