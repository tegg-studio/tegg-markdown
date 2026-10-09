import {blockIcon as iconElement} from "./blockIcons";
import {captureTableActions,tableActionsAtNode,type TableActionLease} from "./tableActionCatalog";
import {ViewPlugin, EditorView, type ViewUpdate} from "@codemirror/view";
import type {EditorSelection, Extension} from "@codemirror/state";
import {ensureSyntaxTree, syntaxTree} from "@codemirror/language";
import type {SyntaxNode} from "@lezer/common";
import {blockContext} from "./blockContext";
import {objectAt, sameEditingIdentity, type EditingController, type EditingIdentity, type ObjectKind} from "./editingController";
import {getSupportedCommands} from "./commandRegistry";
import {dispatchSourcePatches} from "./editorPatches";
import {commandBlockAt, planBlockHeading, type BlockTarget} from "./commandBlockTarget";
import {planStructuralInsert, moveBlockTarget} from "./structuralCommands";
import {focusCodeAtSelection} from "./codeEditing";
import {message, setUIText, setUILabel} from "./uiContext";

type Item = {label: string; command: string; icon: string; markdown?: string; kind?: "code" | "block"; tableAction?:string};
const insertItems: readonly Item[] = [
  {label: "Heading 1", command: "heading1", icon: "H1"}, {label: "Heading 2", command: "heading2", icon: "H2"},
  {label: "Heading 3", command: "heading3", icon: "H3"}, {label: "Heading 4", command: "heading4", icon: "H4"},
  {label: "Heading 5", command: "heading5", icon: "H5"}, {label: "Heading 6", command: "heading6", icon: "H6"},
  {label: "Bullet list", command: "list", icon: "bullet"}, {label: "Numbered list", command: "orderedList", icon: "ordered"},
  {label: "Task list", command: "task", icon: "task"}, {label: "Quote", command: "quote", icon: "quote"},
  {label: "Code block", command: "codeBlock", icon: "code", markdown: "```text\n\n```", kind: "code"},
  {label: "Table", command: "table", icon: "table", markdown: "| Column 1 | Column 2 |\n| --- | --- |\n|  |  |"},
  {label: "Divider", command: "divider", icon: "divider", markdown: "---"},
  {label: "Math block", command: "mathBlock", icon: "math", markdown: "$$\n\n$$"},
  {label: "Mermaid", command: "mermaid", icon: "mermaid", markdown: "```mermaid\n\n```", kind: "code"},
  {label: "Graphviz", command: "graphviz", icon: "graphviz", markdown: "```graphviz\n\n```", kind: "code"},
];
const blockItems: readonly Item[] = [
  {label: "Paragraph", command: "heading0", icon: "T"},
  ...insertItems.filter(item => ["heading1", "heading2", "heading3", "heading4", "heading5", "heading6", "list", "orderedList", "task", "quote"].includes(item.command)),
  {label: "Move up", command: "moveBlockUp", icon: "up"},
  {label: "Move down", command: "moveBlockDown", icon: "down"},
];
type Menu = {kind: "slash" | "insert" | "block"; from: number; to: number; query: string; target: number; identity: EditingIdentity; selection?: EditorSelection; tableActions?:TableActionLease};

class Surface {
  private plus = document.createElement("button");
  private more = document.createElement("button");
  private list = document.createElement("div");
  private menu: Menu | null = null;
  private dismissed: {from: number; query: string} | null = null;
  private items: Item[] = [];
  private active = 0;
  private keyboardNavigation = false;
  private lastPointer: {x:number;y:number}|null = null;
  private movedPointerEvent: PointerEvent|null = null;
  private hovered: BlockTarget | null = null;
  private keyboardTarget = false;
  private focusBlockAfterMeasure = false;
  private pointer: {x:number;y:number} | null = null;
  private hoveredElement: HTMLElement | null = null;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;
  private frame = 0;
  private lifetime = new AbortController();
  private objectLabels: Record<string,{label:string;icon:string}> = {
    definition:{label:'Definition list',icon:'definition'},
    table:{label:'Table',icon:'table'},code:{label:'Code block',icon:'code'},math:{label:'Math block',icon:'math'},
    mermaid:{label:'Mermaid',icon:'mermaid'},graphviz:{label:'Graphviz',icon:'graphviz'},image:{label:'Image',icon:'image'},
    callout:{label:'Callout',icon:'callout'},footnote:{label:'Footnote',icon:'footnote'},source:{label:'Markdown source',icon:'source'},divider:{label:'Divider',icon:'divider'},
  };
  constructor(readonly view: EditorView, readonly controller: EditingController) {
    this.plus.type = this.more.type = "button";
    this.plus.className = "tegg-command-plus"; this.more.className = "tegg-command-more";
    this.plus.append(iconElement("plus")); this.more.append(iconElement("T"));
    this.list.hidden=true;this.list.className = "tegg-command-menu"; this.list.setAttribute("role", "listbox");
    for (const button of [this.plus, this.more]) button.addEventListener("mousedown", event => event.preventDefault());
    this.plus.addEventListener("click", event => {event.stopPropagation(); this.open("insert", event.detail === 0 && this.keyboardTarget);});
    this.more.addEventListener("click", event => {event.stopPropagation(); this.open("block", event.detail === 0 && this.keyboardTarget);});
    this.view.dom.append(this.plus, this.more, this.list);
    setUILabel(this.plus, "Insert block"); setUILabel(this.more, "Block actions"); setUILabel(this.list, "Block commands");
    this.view.dom.addEventListener("keydown", this.key, true);
    document.addEventListener("mousedown", this.outside, true);
    document.addEventListener("focusin", this.focusCheck, true);
    const signal=this.lifetime.signal;
    document.addEventListener('pointermove',event=>{
      this.movedPointerEvent=!this.lastPointer||Math.abs(event.clientX-this.lastPointer.x)>=1||Math.abs(event.clientY-this.lastPointer.y)>=1?event:null;
      this.lastPointer={x:event.clientX,y:event.clientY};
    },{signal,capture:true});
    this.view.dom.addEventListener('pointermove',this.pointerMove,{signal});
    this.view.dom.addEventListener('pointerleave',this.pointerLeave,{signal});
    this.view.dom.addEventListener('pointerdown',event=>{
      this.lastPointer={x:event.clientX,y:event.clientY};
      if(this.list.contains(event.target as Node)||this.more.contains(event.target as Node)||this.plus.contains(event.target as Node))return;
      this.keyboardTarget=event.pointerType==='touch';
      if(event.pointerType==='touch'){
        if(this.leaveTimer){clearTimeout(this.leaveTimer);this.leaveTimer=null;}
        const mounted=event.target instanceof Node?tableActionsAtNode(this.view,event.target,{readOnly:!!this.controller.identity.readOnly}):null;
        const target=mounted?commandBlockAt(this.view.state,mounted.from+1,this.controller.identity.profile):null;
        this.hovered=target&&target.from===mounted?.from?target:null;
        this.hoveredElement=this.hovered?mounted!.panel:null;
        this.pointer=null;this.sync();
      }else{this.hovered=null;this.hide();}
    },{signal,capture:true});
    this.view.dom.addEventListener('compositionstart',()=>{this.hovered=null;this.close();this.hide();},{signal,capture:true});
    document.addEventListener('scroll',this.scroll,{signal,capture:true,passive:true});
    window.addEventListener('resize',this.scroll,{signal});
    for(const button of [this.plus,this.more]) {
      button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
      button.setAttribute('aria-keyshortcuts','Alt+Shift+B');
    }
    this.sync();
  }
  destroy() {this.lifetime.abort();if(this.leaveTimer)clearTimeout(this.leaveTimer);cancelAnimationFrame(this.frame);this.view.dom.removeEventListener("keydown", this.key, true); document.removeEventListener("mousedown", this.outside, true); document.removeEventListener("focusin", this.focusCheck, true); this.plus.remove(); this.more.remove(); this.list.remove();}
  update(update: ViewUpdate) {
    if(update.docChanged){this.hovered=null;this.hoveredElement=null;if(this.menu?.kind!=='slash')this.close();}
    if(this.menu?.selection&&update.selectionSet&&!this.menu.selection.eq(update.state.selection))this.close();
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged || update.geometryChanged) this.sync();
  }
  private hide(){this.plus.hidden=this.more.hidden=true;this.focusBlockAfterMeasure=false;}
  private target():BlockTarget|null {
    if(this.menu)return commandBlockAt(this.view.state,this.menu.target,this.controller.identity.profile);
    return this.hovered ?? (this.keyboardTarget?commandBlockAt(this.view.state,this.view.state.selection.main.anchor,this.controller.identity.profile):null);
  }
  private pointerMove=(event:PointerEvent)=>{
    if(this.view.dom.querySelector('.md-table-paste-review:not([hidden]),.md-html-table-review:not([hidden])')){this.hovered=null;this.hide();return;}
    if(event.pointerType==='touch')return;
    // Scrolling/layout can dispatch pointermove without moving the mouse.
    // Keep an explicit keyboard target until the pointer actually moves.
    if(this.keyboardTarget&&this.movedPointerEvent!==event)return;
    if(this.leaveTimer){clearTimeout(this.leaveTimer);this.leaveTimer=null;}
    if(event.buttons||this.view.composing){this.hovered=null;this.hide();return;}
    this.pointer={x:event.clientX,y:event.clientY};
    if(this.menu)return;
    const element=event.target instanceof Element?event.target:null;
    if(element?.closest('.tegg-command-more,.tegg-command-plus,.tegg-command-menu'))return;
    this.keyboardTarget=false;
    if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.hitTest();});
  };
  private hitTest(){
    if(!this.pointer||this.menu||!this.available())return;
    const {x,y}=this.pointer;
    const hit=document.elementFromPoint(x,y);
    let element=hit?.closest<HTMLElement>('[data-tegg-block-from],.cm-live-table,.cm-live-code-block')??hit?.closest<HTMLElement>('.cm-line')??null;
    // The gutter and paragraph-to-button bridge belong to the same row.
    if(!element||!this.view.contentDOM.contains(element)) {
      element=Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>('[data-tegg-block-from],.cm-live-table,.cm-live-code-block,.cm-line')).find(node=>{
        const rect=node.getBoundingClientRect();return rect.height>1&&y>=rect.top&&y<=rect.bottom;
      })??null;
    }
    if(!element||!this.view.contentDOM.contains(element)){this.hovered=null;this.hoveredElement=null;this.sync();return;}
    if(element===this.hoveredElement&&this.hovered)return;
    let at:number;
    try {
      const stored=element.dataset.teggBlockFrom??element.dataset.teggTableFrom??element.dataset.sourceFrom;
      at=stored!==undefined?Number(stored)+1:this.view.posAtDOM(element,0);
      if(stored===undefined)at=this.view.state.doc.lineAt(at).to;
    }catch{return;}
    this.hovered=commandBlockAt(this.view.state,at,this.controller.identity.profile);this.hoveredElement=element;this.sync();
  }
  private pointerLeave=(event:PointerEvent)=>{
    if(event.pointerType==='touch')return;
    this.pointer=null;
    if(this.menu)return;
    if(this.leaveTimer)clearTimeout(this.leaveTimer);
    this.leaveTimer=setTimeout(()=>{this.hovered=null;this.hoveredElement=null;this.sync();},140);
  };
  private scroll=()=>{
    if(this.menu){this.position();return;}
    this.hoveredElement=null;
    if(this.pointer){if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.hitTest();this.position();});}
    else this.position();
  };
  private available() {
    if(document.activeElement instanceof Element&&this.view.dom.contains(document.activeElement)&&document.activeElement.closest('.md-html-cell-editing,.md-html-table-controls,.md-html-object-actions,.md-table-inline-editor,.md-table-paste-review'))return false;
    return this.controller.identity.mode === "live" && [null,"read-only"].includes(this.controller.unavailableReason) &&
      this.controller.session?.status !== "editing" && this.controller.session?.status !== "stale" && !this.view.composing;
  }
  private tableActions(target:BlockTarget|null) {return target?captureTableActions(this.view,target.from,{readOnly:!!this.controller.identity.readOnly}):null;}
  private safeTarget(position:number) {return commandBlockAt(this.view.state,position,this.controller.identity.profile)?.kind==='text';}
  private ownsFocus() {
    const active = document.activeElement;
    return this.view.hasFocus || active === this.plus || active === this.more || this.list.contains(active);
  }
  private currentStyles(position: number) {
    const state = this.view.state;
    const context = blockContext(state, position);
    const tree = ensureSyntaxTree(state, context.lineTo, 100) ?? syntaxTree(state);
    const nodes: SyntaxNode[] = [];
    for (let node: SyntaxNode | null = tree.resolveInner(Math.min(position, context.lineTo), -1); node; node = node.parent) nodes.push(node);
    const heading = nodes.map(node => node.name.match(/^(?:ATX|Setext)Heading([1-6])$/)?.[1]).find(Boolean);
    const paragraph = heading ? {command: `heading${heading}`, icon: `H${heading}`, label: `Heading ${heading}`}
      : {command: "heading0", icon: "T", label: "Paragraph"};
    const item = nodes.find(node => node.name === "ListItem");
    const mark = item?.getChild("ListMark");
    let list: {command: string; icon: string; label: string} | null = null;
    if (mark) {
      const marker = state.sliceDoc(mark.from, mark.to);
      const task = /^\[[ xX]\]/.test(state.sliceDoc(mark.to, state.doc.lineAt(mark.to).to).trimStart());
      list = task ? {command: "task", icon: "task", label: "Task list"}
        : /^\d/.test(marker) ? {command: "orderedList", icon: "ordered", label: "Numbered list"}
        : {command: "list", icon: "bullet", label: "Bullet list"};
    }
    return {paragraph, list, quoted: context.containers.includes("quote")};
  }
  private currentType(position: number) {
    const styles = this.currentStyles(position);
    return styles.paragraph.command !== "heading0" ? styles.paragraph
      : styles.list ?? (styles.quoted ? {command: "quote", icon: "quote", label: "Quote"} : styles.paragraph);
  }
  private position() {
    if(this.view.dom.querySelector('.md-table-paste-review:not([hidden]),.md-html-table-review:not([hidden])')){this.hide();return;}
    const target=this.target();if(!target){this.hide();return;}
    this.view.requestMeasure({
      key:this,
      read:view=>{
        const host=view.dom.getBoundingClientRect(), viewport=view.scrollDOM.getBoundingClientRect();
        const content=view.contentDOM.getBoundingClientRect(), padding=parseFloat(getComputedStyle(view.contentDOM).paddingLeft)||0;
        const object=target.kind!=='text'?Array.from(view.contentDOM.querySelectorAll<HTMLElement>('[data-tegg-block-from],.cm-live-table,[data-source-from]')).find(node=>Number(node.dataset.teggBlockFrom??node.dataset.teggTableFrom??node.dataset.sourceFrom)===target.from):null;
        const rect=object?.getBoundingClientRect();
        const caret=view.coordsAtPos(this.menu?.target??target.position);
        const leading=rect?{left:rect.left,right:rect.left,top:Math.max(rect.top,viewport.top)+6,bottom:Math.max(rect.top,viewport.top)+34}:view.coordsAtPos(target.position);
        if(!leading)return null;
        const height=this.more.getBoundingClientRect().height||28;
        const menu=this.list.getBoundingClientRect();
        return {host,viewport,leading,caret:caret??leading,height,left:content.left+padding-height-10,
          objectBottom:rect?.bottom,menuWidth:menu.width||214,menuHeight:Math.min(460,this.list.scrollHeight||this.items.length*32+80)};
      },
      write:geometry=>{
        if(!geometry)return;
        const {host,viewport,leading,caret,height,left,objectBottom,menuWidth,menuHeight}=geometry;
        const top=(leading.top+leading.bottom-height)/2;
        const visibleTop=Math.max(0,host.top,viewport.top),visibleBottom=Math.min(window.innerHeight,viewport.bottom||host.bottom);
        const visible=top+height>visibleTop&&top<visibleBottom&&(objectBottom===undefined||objectBottom>visibleTop+height);
        // Viewport measurement may briefly clip a just-focused button while
        // CodeMirror completes scrollIntoView. Restore its focus when visible.
        if(!visible&&this.keyboardTarget&&(document.activeElement===this.plus||document.activeElement===this.more))this.focusBlockAfterMeasure=true;
        for(const button of [this.plus,this.more]) {
          button.style.left=`${Math.max(4,left-host.left)}px`;button.style.top=`${top-host.top}px`;
          button.style.visibility=visible?'visible':'hidden';
        }
        if(this.focusBlockAfterMeasure&&visible&&this.keyboardTarget){
          this.focusBlockAfterMeasure=false;
          (this.plus.hidden?this.more:this.plus).focus({preventScroll:true});
        }
        const anchor=this.menu?.kind==='slash'?caret:{...leading,top,bottom:top+height};
        const below=Math.max(0,visibleBottom-8-anchor.bottom-6),above=Math.max(0,anchor.top-6-visibleTop-8);
        const flip=below<menuHeight&&above>below,limit=Math.min(menuHeight,flip?above:below);
        this.list.style.maxHeight=`${limit}px`;
        this.list.style.top=`${Math.max(visibleTop+8,flip?anchor.top-6-limit:anchor.bottom+6)-host.top}px`;
        this.list.style.left=`${Math.max(8,Math.min(left,window.innerWidth-menuWidth-8))-host.left}px`;
      },
    });
  }
  private sync() {
    const selection=this.view.state.selection.main;
    if(this.menu&&!sameEditingIdentity(this.menu.identity,this.controller.identity)){this.close();this.hovered=null;}
    if(!this.available()){this.close();this.hide();return;}
    // Slash completion follows the insertion caret; explicit block menus follow Hover.
    const context=blockContext(this.view.state,selection.anchor);
    const content=this.view.state.sliceDoc(context.contentFrom,context.lineTo);
    const query=this.ownsFocus()&&selection.empty&&this.safeTarget(selection.anchor)?content.match(/^\/([^\s]*)$/):null;
    if(query&&selection.anchor===context.lineTo&&(!this.menu||this.menu.kind==='slash')&&
      (this.dismissed?.from!==context.contentFrom||this.dismissed.query!==query[1])) {
      if(this.menu?.kind!=='slash'||this.menu.query!==query[1]){this.active=0;this.keyboardNavigation=true;}
      this.menu={kind:'slash',from:context.contentFrom,to:context.lineTo,query:query[1],target:selection.anchor,identity:this.controller.identity};this.render();
    }else if(this.menu?.kind==='slash')this.close();
    if(!content.match(/^\/([^\s]*)$/))this.dismissed=null;
    const target=this.target();
    if(!target||(!selection.empty&&!this.menu)){this.hide();return;}
    const readonly=this.controller.unavailableReason==='read-only';
    if(readonly&&!this.tableActions(target)?.readOnly){this.hide();return;}
    const empty=target.kind==='text'&&!this.view.state.sliceDoc(target.position,target.to).trim();
    this.plus.hidden=readonly||!empty;this.more.hidden=empty;
    const current=target.kind==='text'?this.currentType(target.position):{...this.objectLabels[target.kind],command:target.kind};
    if(this.more.dataset.blockType!==current.command)this.more.replaceChildren(iconElement(current.icon));this.more.dataset.blockType=current.command;
    this.more.dataset.blockFrom=String(target.from);this.more.dataset.blockTo=String(target.to);
    const styles=target.kind==='text'?this.currentStyles(target.position):null;
    const labels=styles?[styles.paragraph.label,styles.list?.label,styles.quoted?'Quote':null].filter(Boolean) as string[]:[current.label];
    setUILabel(this.more,'Block actions for {value}',{value:labels.map(label=>message(this.more,label)).join(' · ')});
    this.more.title=this.more.getAttribute('aria-label')+' (Alt+Shift+B)';
    for(const button of [this.more,this.plus])button.setAttribute('aria-expanded',String(!!this.menu));
    this.position();
  }
  private open(kind:'insert'|'block', keyboard=false) {
    if(!this.available()||!this.view.state.selection.main.empty)return;
    if(this.menu?.kind===kind){this.close();this.sync();return;}
    const block=this.target();if(!block)return;
    const tableActions=kind==='block'?this.tableActions(block):null;
    if(this.controller.unavailableReason==='read-only'&&(kind!=='block'||!tableActions?.readOnly))return;
    if(kind==='insert'&&block.kind!=='text')return;
    const target=block.position,context=blockContext(this.view.state,target),styles=this.currentStyles(target);
    const initial=styles.paragraph.command!=='heading0'?styles.paragraph.command:styles.list?.command??'heading0';
    this.active=kind==='block'&&block.kind==='text'?Math.max(0,blockItems.findIndex(item=>item.command===initial)):0;
    this.keyboardNavigation=keyboard;
    this.menu={kind,from:context.contentFrom,to:context.lineTo,query:'',target,identity:this.controller.identity,selection:this.view.state.selection,tableActions:tableActions??undefined};
    this.render();this.sync();
  }
  private render() {
    if (!this.menu) return;
    const supported = new Set(getSupportedCommands(this.controller.identity.profile ?? "tegg"));
    const target=this.target();
    const object=this.menu.kind==='block'&&target?.kind!=='text'?target:null;
    const styles = this.menu.kind === "block" && !object ? this.currentStyles(this.menu.target) : null;
    const tableActions=this.menu.tableActions?.current()?this.menu.tableActions:null;
    if(this.controller.unavailableReason==='read-only'&&!tableActions?.readOnly){this.close();this.hide();return;}
    const objectItems:Item[]=object?tableActions?[
      ...tableActions.items.map(item=>({label:item.label,command:'objectTable:'+item.id,icon:'table',tableAction:item.id})),
      ...(!tableActions.readOnly&&!tableActions.items.some(item=>item.id==='edit-source')?[{label:'Edit Source',command:'objectSource',icon:'source'}]:[]),
    ]:[
      ...(!['source','divider','definition'].includes(object.kind)?[{label:'Edit object',command:'objectEdit',icon:'edit'}]:[]),
      {label:'Edit Source',command:'objectSource',icon:'source'}]:[];
    const choices = this.menu.kind === "block" ? object?objectItems:blockItems.filter(item => item.command !== "quote" || !styles?.quoted) : insertItems;
    const moveScope = moveBlockTarget(this.view.state, this.menu.target)?.name;
    const scopedChoices = choices.map(item => {
      if (!item.command.startsWith("moveBlock")) return item;
      const up = item.command === "moveBlockUp";
      const label = moveScope === "Blockquote" ? up ? "Move entire quote up" : "Move entire quote down"
        : moveScope === "ListItem" ? up ? "Move list item up" : "Move list item down" : item.label;
      return {...item, label};
    });
    const query = this.menu.query.toLocaleLowerCase();
    this.items = scopedChoices.filter(item => (item.command.startsWith('object')||supported.has(item.command)) &&
      (item.label.toLocaleLowerCase().includes(query) || message(this.list, item.label).toLocaleLowerCase().includes(query)));
    this.active = Math.min(this.active, Math.max(0, this.items.length - 1));
    this.list.replaceChildren();this.list.dataset.keyboard=String(this.keyboardNavigation);
    if(object){const title=document.createElement('div');title.className='tegg-command-group';setUIText(title,tableActions?'Table':this.objectLabels[object.kind].label);this.list.append(title);}
    let group = "";
    for (const [index, item] of this.items.entries()) {
      if (this.menu.kind === "block" && !object) {
        const nextGroup = item.command.startsWith("moveBlock") ? "Move block"
          : item.command === "quote" ? "Wrap in quote"
          : item.command === "list" || item.command === "orderedList" || item.command === "task" ? "List style"
          : "Paragraph style";
        if (nextGroup !== group) {
          const heading = document.createElement("div");
          heading.className = "tegg-command-group"; heading.setAttribute("role", "presentation");
          this.list.append(heading); setUIText(heading, nextGroup); group = nextGroup;
        }
      }
      const option = document.createElement("button"); option.type = "button";
      option.className = "tegg-command-option"; option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === this.active));
      const isCurrent = styles?.paragraph.command === item.command || styles?.list?.command === item.command;
      option.dataset.current = String(isCurrent);
      if (isCurrent) option.setAttribute("aria-current", "true");
      const icon = document.createElement("span"); icon.className = "tegg-command-option-icon";
      icon.append(iconElement(item.icon)); icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span"); label.className = "tegg-command-option-label";
      option.append(icon, label);
      if (isCurrent) {
        const check = document.createElement("span"); check.className = "tegg-command-option-current";
        check.append(iconElement("check")); check.setAttribute("aria-hidden", "true"); option.append(check);
      }
      option.addEventListener("pointermove", event => {
        // Repositioning/scrolling a menu can emit pointer events beneath a stationary
        // cursor. Only physical movement may take navigation back from the keyboard.
        if(this.movedPointerEvent!==event)return;
        this.keyboardNavigation=false;this.list.dataset.keyboard='false';this.active=index;
        for(const [i,node] of this.list.querySelectorAll('.tegg-command-option').entries())node.setAttribute('aria-selected',String(i===index));
      });
      option.addEventListener("mousedown", event => event.preventDefault());
      option.addEventListener("click", event => {event.stopPropagation(); this.apply(index);});
      this.list.append(option);
      setUIText(label, this.menu.kind === "block" && item.command === "quote"
        ? styles?.list ? "Wrap list in quote" : "Wrap in quote" : item.label);
    }
    if (!this.items.length) {const empty = document.createElement("span"); this.list.append(empty); setUIText(empty, "No commands");}
    this.list.hidden = false;
    this.position();
  }
  private apply(index: number) {
    const menu = this.menu, item = this.items[index];
    if (!menu || !item || !sameEditingIdentity(menu.identity, this.controller.identity) ||
      !this.available() || !this.view.state.selection.main.empty ||
      (menu.selection?!menu.selection.eq(this.view.state.selection):this.view.state.selection.main.anchor!==menu.target)) {this.close(); return;}
    if(this.controller.unavailableReason==='read-only'&&(item.tableAction!=='copy-cells'||!menu.tableActions?.readOnly)){this.close();return;}
    const state = this.view.state;
    if (menu.kind === "block") {
      const target=this.target();if(!target){this.close();return;}
      if(item.tableAction){
        const captured=menu.tableActions;
        this.close();this.hovered=null;this.hide();
        if(captured?.current())captured.execute(item.tableAction);
        return;
      }
      if(item.command.startsWith('object')) {
        this.close();this.hovered=null;this.hide();
        if(item.command==='objectSource'){
          this.view.dispatch({selection:{anchor:Math.min(target.to,target.from+1)},scrollIntoView:true});this.view.focus();
        }else if(target.kind==='code'){
          this.view.dispatch({selection:{anchor:target.position}});focusCodeAtSelection(this.view);
        }else this.view.dom.dispatchEvent(new CustomEvent('tegg-edit-object',{bubbles:true,cancelable:true,detail:{from:target.from,to:target.to,kind:target.kind}}));
        return;
      }
      if(target.kind!=='text'){this.close();return;}
      const styles = this.currentStyles(menu.target);
      if (item.command === styles.paragraph.command || item.command === styles.list?.command) {this.close(); this.view.focus(); return;}
      this.close();
      // Only a chosen command may transfer editing context away from the original caret.
      if(item.command.startsWith('heading')){
        const plan=planBlockHeading(state,target,Number(item.command.slice(7)));
        if(plan)dispatchSourcePatches(this.view,plan.patches,{selection:plan.selection,isolateHistory:true,scrollIntoView:true});
      }else{
        this.view.dispatch({selection: {anchor: menu.target}});this.view.focus();this.controller.command(item.command);
      }
    } else {
      if (state.sliceDoc(menu.from, menu.to) !== (menu.kind === "slash" ? "/" + menu.query : "")) {this.close(); return;}
      const range = {from: menu.from, to: menu.to};
      const draftKind: ObjectKind | null = item.command === "mathBlock" ? "math"
        : item.command === "mermaid" ? "mermaid" : item.command === "graphviz" ? "graphviz" : null;
      if (draftKind) {
        this.view.dom.dispatchEvent(new CustomEvent("tegg-edit-object", {bubbles: true, cancelable: true,
          detail: {...range, kind: draftKind, create: true}}));
        this.close();
        return;
      }
      if (item.markdown !== undefined) {
        const plan = planStructuralInsert(state, range, item.markdown, item.kind);
        if (!plan) {this.close(); return;}
        dispatchSourcePatches(this.view, plan.patches, {selection: plan.selection, isolateHistory: true, scrollIntoView: true});
        if (item.kind === "code") {
          const doc=this.view.state.doc, anchor=this.view.state.selection.main.anchor, identity=this.controller.identity;
          requestAnimationFrame(() => {if(this.view.dom.isConnected&&this.view.state.doc===doc&&
            this.view.state.selection.main.anchor===anchor&&sameEditingIdentity(identity,this.controller.identity))
            focusCodeAtSelection(this.view);});
        }
      } else {
        const marker = item.command.startsWith("heading") ? `${"#".repeat(Number(item.command.slice(7)))} ` :
          item.command === "list" ? "- " : item.command === "orderedList" ? "1. " : item.command === "task" ? "- [ ] " : "> ";
        dispatchSourcePatches(this.view, [{...range, expected: state.sliceDoc(range.from, range.to), insert: marker}],
          {selection: {anchor: range.from + marker.length}, isolateHistory: true, scrollIntoView: true});
      }
    }
    this.close(); this.view.focus();
  }
  private close() {
    const hadMenu=!!this.menu;
    for(const button of [this.plus,this.more])button.setAttribute('aria-expanded','false');
    this.menu=null;this.items=[];this.list.hidden=true;this.list.replaceChildren();
    if(hadMenu&&!this.keyboardTarget&&!this.pointer){this.hovered=null;this.hide();}
    if(hadMenu&&this.pointer&&!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.hoveredElement=null;this.hitTest();});
  }
  private outside = (event: MouseEvent) => {
    if (!this.menu || this.list.contains(event.target as Node) ||
      this.plus.contains(event.target as Node) || this.more.contains(event.target as Node)) return;
    if (this.menu.kind === "slash") this.dismissed = {from: this.menu.from, query: this.menu.query};
    this.close();
  };
  private focusCheck = (event: FocusEvent) => {
    if(!this.view.dom.contains(event.target as Node)){this.keyboardTarget=false;if(!this.pointer)this.hide();}
    if (!this.menu || this.view.contentDOM.contains(event.target as Node) ||
      event.target === this.plus || event.target === this.more || this.list.contains(event.target as Node)) return;
    if (this.menu.kind === "slash") this.dismissed = {from: this.menu.from, query: this.menu.query};
    this.close();
  };
  private key = (event: KeyboardEvent) => {
    if(event.isComposing||this.view.composing)return;
    if(event.altKey&&event.shiftKey&&event.code==='KeyB'&&!this.menu){
      if(!this.available()||!this.view.state.selection.main.empty)return;
      event.preventDefault();event.stopPropagation();this.keyboardTarget=true;this.hovered=null;this.pointer=null;cancelAnimationFrame(this.frame);this.frame=0;this.sync();
      const button=this.plus.hidden?this.more:this.plus;
      if(!button.hidden){
        button.focus({preventScroll:true});
        // The previous geometry may still be visibility:hidden. Retry only after
        // the requested measurement makes this keyboard target visible.
        this.focusBlockAfterMeasure=document.activeElement!==button;
      }
      return;
    }
    if(!this.menu){
      if(!event.altKey&&!event.metaKey&&!event.ctrlKey&&event.key.length===1){this.hovered=null;this.keyboardTarget=false;this.hide();}
      return;
    }
    if (event.key === "Escape") {event.preventDefault(); event.stopPropagation(); if (this.menu.kind === "slash") this.dismissed = {from: this.menu.from, query: this.menu.query}; this.close(); this.view.focus(); return;}
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); event.stopPropagation();this.keyboardNavigation=true;
      if (this.items.length) this.active = (this.active + (event.key === "ArrowDown" ? 1 : -1) + this.items.length) % this.items.length;
      this.render();
      this.list.querySelectorAll<HTMLElement>(".tegg-command-option")[this.active]?.scrollIntoView?.({block: "nearest"});
      return;
    }
    if (event.key === "Enter" && this.items.length) {event.preventDefault(); event.stopPropagation(); this.apply(this.active);}
  };
}

/** Attach once to a Live Edit view; the controller remains the sole mutation owner. */
export function createCommandSurface(controller: EditingController): Extension {
  return [EditorView.editorAttributes.of(()=>controller.identity.mode==='live'?{class:'tegg-block-surface'}:null),
    ViewPlugin.fromClass(class extends Surface {constructor(view: EditorView) {super(view, controller);}})];
}
