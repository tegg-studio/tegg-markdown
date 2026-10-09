/** @vitest-environment jsdom */
import {afterEach,it,expect,vi} from 'vitest';
import {bindTableCellTouch} from './tableCellTouch';
const stops:Array<()=>void>=[];
afterEach(()=>{stops.splice(0).forEach(stop=>stop());document.body.replaceChildren();});
function pointer(node:Element,type:string,x=30,y=40,targetType='touch'){const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y});Object.defineProperties(event,{pointerType:{value:targetType},pointerId:{value:1}});node.dispatchEvent(event);return event;}
function tap(node:Element){pointer(node,'pointerdown');pointer(node,'pointerup');}
function fixture(){const table=document.body.appendChild(document.createElement('div')),cell=table.appendChild(document.createElement('div'));cell.innerHTML='<strong>old</strong><a href="target">link</a>';return {table,cell,text:cell.querySelector('strong')!};}
it('two deliberate taps enter a selected cell without a timing requirement, and its retargeted compatibility click cannot cancel the new draft',()=>{const {table,cell,text}=fixture();let edited=0,cancelled=0;const edit=()=>{edited++;const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.addEventListener('click',()=>cancelled++);table.replaceChildren(cancel);};stops.push(bindTableCellTouch(cell,{enabled:()=>true,selected:()=>true,edit}));tap(text);expect(edited).toBe(0);tap(text);expect(edited).toBe(1);const cancel=table.querySelector('button')!;const synthetic=new MouseEvent('click',{bubbles:true,cancelable:true,clientX:30,clientY:40,detail:1});cancel.dispatchEvent(synthetic);expect(synthetic.defaultPrevented).toBe(true);expect(cancelled).toBe(0);pointer(cancel,'pointerdown');cancel.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:30,clientY:40,detail:1}));expect(cancelled).toBe(1);});
it('scroll, cancellation and outside input break the two tap sequence instead of editing',()=>{const {cell,text}=fixture(),edit=vi.fn();stops.push(bindTableCellTouch(cell,{enabled:()=>true,selected:()=>true,edit}));tap(text);pointer(text,'pointerdown');pointer(text,'pointermove',40,60);pointer(text,'pointerup',40,60);tap(text);expect(edit).not.toHaveBeenCalled();pointer(text,'pointerdown');pointer(text,'pointercancel');tap(text);expect(edit).not.toHaveBeenCalled();pointer(document.body,'pointerdown');tap(text);expect(edit).not.toHaveBeenCalled();});
it('author links, mouse clicks and unavailable cells do not arm the touch edit gesture',()=>{const {cell,text}=fixture(),edit=vi.fn();let enabled=true;stops.push(bindTableCellTouch(cell,{enabled:()=>enabled,selected:()=>true,edit}));tap(cell.querySelector('a')!);tap(text);expect(edit).not.toHaveBeenCalled();pointer(text,'pointerdown',30,40,'mouse');pointer(text,'pointerup',30,40,'mouse');tap(text);expect(edit).not.toHaveBeenCalled();enabled=false;tap(text);enabled=true;tap(text);expect(edit).not.toHaveBeenCalled();});

it('opts actual link labels into the existing first-select second-edit touch sequence',()=>{
 const {table,cell}=fixture(),link=cell.querySelector('a')!,edit=vi.fn();let selected=false;
 cell.addEventListener('click',event=>{event.preventDefault();selected=true;});
 stops.push(bindTableCellTouch(cell,{allowLinks:true,enabled:()=>true,selected:()=>selected,edit}));
 tap(link);link.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:30,clientY:40,detail:1}));
 expect(selected).toBe(true);expect(edit).not.toHaveBeenCalled();
 tap(link);expect(edit).toHaveBeenCalledOnce();expect(edit).toHaveBeenCalledWith({x:30,y:40});
 const compatibility= new MouseEvent('click',{bubbles:true,cancelable:true,clientX:30,clientY:40,detail:1});
 table.dispatchEvent(compatibility);expect(compatibility.defaultPrevented).toBe(true);
});
it('does not opt nested controls or object toolbars into link-cell touch editing',()=>{
 const {cell}=fixture(),edit=vi.fn();cell.innerHTML='<a href="target"><span>label</span></a><input><textarea></textarea><select></select><summary>summary</summary><div class="md-object-toolbar"><a href="target">tool</a></div><div class="md-html-object-actions"><a href="target">action</a></div>';
 const link=cell.querySelector('a span')!;stops.push(bindTableCellTouch(cell,{allowLinks:true,enabled:()=>true,selected:()=>true,edit}));
 for(const control of cell.querySelectorAll('input,textarea,select,summary,.md-object-toolbar a,.md-html-object-actions a')){tap(link);tap(control);tap(link);expect(edit).not.toHaveBeenCalled();pointer(document.body,'pointerdown');}
});
it('preserves scroll, cancel, availability and outside reset for opted-in link labels',()=>{
 const {cell}=fixture(),link=cell.querySelector('a')!,edit=vi.fn();let enabled=true;
 stops.push(bindTableCellTouch(cell,{allowLinks:true,enabled:()=>enabled,selected:()=>true,edit}));
 tap(link);pointer(link,'pointerdown');pointer(link,'pointermove',50,70);pointer(link,'pointerup',50,70);tap(link);expect(edit).not.toHaveBeenCalled();
 pointer(link,'pointerdown');pointer(link,'pointercancel');tap(link);expect(edit).not.toHaveBeenCalled();
 enabled=false;tap(link);enabled=true;tap(link);expect(edit).not.toHaveBeenCalled();
 pointer(document.body,'pointerdown');tap(link);expect(edit).not.toHaveBeenCalled();
 tap(link);expect(edit).toHaveBeenCalledOnce();
});
it('keeps link opt-in specific to touch and discards an arm when the binding is disposed',()=>{
 const {cell}=fixture(),link=cell.querySelector('a')!,edit=vi.fn();
 const stop=bindTableCellTouch(cell,{allowLinks:true,enabled:()=>true,selected:()=>true,edit});stops.push(stop);
 tap(link);pointer(link,'pointerdown',30,40,'mouse');pointer(link,'pointerup',30,40,'mouse');tap(link);expect(edit).not.toHaveBeenCalled();
 stop();stops.push(bindTableCellTouch(cell,{allowLinks:true,enabled:()=>true,selected:()=>true,edit}));tap(link);expect(edit).not.toHaveBeenCalled();tap(link);expect(edit).toHaveBeenCalledOnce();
});

it('the second touch consumes its retargeted mouse focus default, but a new real pointer is never consumed',()=>{
 const {table,cell,text}=fixture();const input=document.createElement('input');const edit=()=>{table.append(input);input.focus();};stops.push(bindTableCellTouch(cell,{enabled:()=>true,selected:()=>true,edit}));tap(text);tap(text);expect(document.activeElement).toBe(input);
 const compatibilityDown=new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:30,clientY:40,detail:1});table.dispatchEvent(compatibilityDown);expect(compatibilityDown.defaultPrevented).toBe(true);
 const compatibilityClick=new MouseEvent('click',{bubbles:true,cancelable:true,clientX:30,clientY:40,detail:1});table.dispatchEvent(compatibilityClick);expect(compatibilityClick.defaultPrevented).toBe(true);expect(document.activeElement).toBe(input);
 tap(text);tap(text);pointer(input,'pointerdown',30,40,'mouse');const next=new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:30,clientY:40,detail:1});input.dispatchEvent(next);expect(next.defaultPrevented).toBe(false);
});

it('selects on the first touch without a compatibility click before the second touch arrives',()=>{
 const {cell,text}=fixture(),edit=vi.fn();let selected=false;const select=vi.fn(()=>{selected=true;});
 stops.push(bindTableCellTouch(cell,{enabled:()=>true,selected:()=>selected,select,edit}));
 tap(text);expect(selected).toBe(true);expect(select).toHaveBeenCalledOnce();expect(edit).not.toHaveBeenCalled();
 tap(text);expect(edit).toHaveBeenCalledOnce();expect(select).toHaveBeenCalledOnce();
 const delayed=new MouseEvent('click',{bubbles:true,cancelable:true,clientX:30,clientY:40,detail:1});cell.dispatchEvent(delayed);expect(delayed.defaultPrevented).toBe(true);
});
it('does not select after scrolling/cancelled touch and starts a fresh selection for a different cell',()=>{
 const {table,cell,text}=fixture(),other=table.appendChild(document.createElement('div')),edit=vi.fn(),selected=new Set<HTMLElement>();
 const select=(target:HTMLElement)=>{selected.clear();selected.add(target);};
 for(const target of [cell,other])stops.push(bindTableCellTouch(target,{enabled:()=>true,selected:()=>selected.has(target),select:()=>select(target),edit}));
 pointer(text,'pointerdown');pointer(text,'pointermove',50,70);pointer(text,'pointerup',50,70);expect(selected.size).toBe(0);
 pointer(text,'pointerdown');pointer(text,'pointercancel');pointer(text,'pointerup');expect(selected.size).toBe(0);
 tap(text);expect(selected.has(cell)).toBe(true);tap(other);expect(selected.has(other)).toBe(true);expect(edit).not.toHaveBeenCalled();tap(other);expect(edit).toHaveBeenCalledOnce();
});

it.each([false,true])('applies first-touch selection only to the allowed author link child target (allowLinks=%s)',allowLinks=>{
 const {cell}=fixture();cell.querySelector('a')!.innerHTML='<span>link text</span>';const target=cell.querySelector('a span')!,edit=vi.fn();let selected=false;const select=vi.fn(()=>{selected=true;});
 stops.push(bindTableCellTouch(cell,{allowLinks,enabled:()=>true,selected:()=>selected,select,edit}));
 tap(target);expect(select).toHaveBeenCalledTimes(allowLinks?1:0);expect(edit).not.toHaveBeenCalled();
 tap(target);expect(edit).toHaveBeenCalledTimes(allowLinks?1:0);expect(cell.querySelector('a')!.getAttribute('href')).toBe('target');
});
