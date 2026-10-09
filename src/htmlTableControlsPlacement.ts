/** Default SDK chrome stays outside the grid. A Host that sets its own table
 * controls mode retains its placement and typography authority. */
export function bindHtmlTableControlsPlacement(wrapper:HTMLElement,table:HTMLTableElement,controls:HTMLElement,activeCell:()=>HTMLElement|undefined){
 const win=wrapper.ownerDocument.defaultView!;let alive=true,frame=0;
 const owned=new Map<HTMLElement,Map<string,string>>(),more=controls.querySelector('details'),menu=more?.querySelector<HTMLElement>(':scope > div');
 const set=(key:string,value:string,node=controls)=>{let values=owned.get(node);if(!values)owned.set(node,values=new Map());values.set(key,value);if(node.style.getPropertyValue(key)!==value)node.style.setProperty(key,value);};
 const clear=()=>{delete controls.dataset.defaultPlacement;for(const [node,values]of owned)for(const [key,value]of values)if(node.style.getPropertyValue(key)===value)node.style.removeProperty(key);owned.clear();};
 const sync=()=>{
  if(!alive||!wrapper.isConnected)return;
  if(wrapper.dataset.mdTableControls!==undefined){clear();return;}
  controls.dataset.defaultPlacement='true';
  if(wrapper.dataset.cellSelected!=='true')return;
  const viewport=win.visualViewport,left=(viewport?.offsetLeft??0)+8,top=(viewport?.offsetTop??0)+8,right=(viewport?.offsetLeft??0)+(viewport?.width??win.innerWidth)-8,bottom=(viewport?.offsetTop??0)+(viewport?.height??win.innerHeight)-8;
  set('max-width',Math.max(44,right-left)+'px');set('max-height',Math.max(44,bottom-top)+'px');
  const grid=table.getBoundingClientRect(),bar=controls.getBoundingClientRect(),cell=activeCell()?.getBoundingClientRect()??grid;
  if(!bar.width||!bar.height)return;
  // Prefer a table boundary. Large/offscreen tables use the edge furthest from
  // the active cell rather than laying chrome over its native text input.
  const below=grid.bottom+4,above=grid.top-bar.height-4;
  const y=below+bar.height<=bottom&&below>=top?below:above>=top&&above+bar.height<=bottom?above:cell.top+cell.height/2<(top+bottom)/2?bottom-bar.height:top;
  set('left',Math.max(left,Math.min(grid.right-bar.width,right-bar.width))+'px');set('top',Math.max(top,y)+'px');
  controls.dataset.edge=y>(top+bottom)/2?'bottom':'top';
  if(more?.open&&menu){set('max-width',Math.max(44,right-left)+'px',menu);const trigger=more.getBoundingClientRect(),above=trigger.top-top-4,below=bottom-trigger.bottom-4,onTop=above>=44&&(controls.dataset.edge==='bottom'||below<44);set('max-height',Math.max(44,onTop?above:below)+'px',menu);const popup=menu.getBoundingClientRect(),py=onTop?trigger.top-popup.height-4:trigger.bottom+4;set('left',Math.max(left,Math.min(trigger.right-popup.width,right-popup.width))+'px',menu);set('top',Math.max(top,Math.min(py,bottom-popup.height))+'px',menu);}
 };
 const schedule=()=>{if(alive&&!frame)frame=win.requestAnimationFrame(()=>{frame=0;sync();});};
 const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(schedule);observer?.observe(table);observer?.observe(controls);observer?.observe(wrapper);
 const modes=typeof MutationObserver==='undefined'?undefined:new MutationObserver(records=>{if(records.some(record=>record.attributeName==='data-md-table-controls'))schedule();});modes?.observe(wrapper,{attributes:true,attributeFilter:['data-md-table-controls']});
 win.addEventListener('resize',schedule);win.addEventListener('scroll',schedule,true);win.visualViewport?.addEventListener('resize',schedule);win.visualViewport?.addEventListener('scroll',schedule);wrapper.addEventListener('focusin',schedule);more?.addEventListener('toggle',schedule);schedule();
 return {sync,dispose(){alive=false;if(frame)win.cancelAnimationFrame(frame);observer?.disconnect();modes?.disconnect();win.removeEventListener('resize',schedule);win.removeEventListener('scroll',schedule,true);win.visualViewport?.removeEventListener('resize',schedule);win.visualViewport?.removeEventListener('scroll',schedule);wrapper.removeEventListener('focusin',schedule);more?.removeEventListener('toggle',schedule);clear();}};
}
