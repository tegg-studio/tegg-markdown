/** @vitest-environment jsdom */
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history,undo,redo} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {livePreview} from './livePreview';
import {resourceContext} from './editorHost';
import {HeadingIndex} from './headingIndex';
beforeAll(()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){} unobserve(){} disconnect(){}});
  if(!Range.prototype.getClientRects)Range.prototype.getClientRects=()=>({length:0,item:()=>null,[Symbol.iterator]:function*(){}}) as DOMRectList;
  if(!Range.prototype.getBoundingClientRect)Range.prototype.getBoundingClientRect=()=>new DOMRect();
});
const mounted:EditorView[]=[];
function mount(source:string,head:number){const parent=document.createElement('div');document.body.append(parent);const view=new EditorView({parent,state:EditorState.create({doc:source,selection:{anchor:head},extensions:[history(),markdown({extensions:GFM}),resourceContext.of({profile:'tegg',documentPath:'',resolveImage:src=>src}),livePreview]})});mounted.push(view);return view;}
afterEach(()=>{mounted.splice(0).forEach(view=>view.destroy());document.body.replaceChildren();});
function snapshot(view:EditorView){return view.contentDOM.innerHTML;}
function fresh(view:EditorView){return mount(view.state.doc.toString(),view.state.selection.main.head);}
function change(view:EditorView,from:number,to:number,insert:string){view.dispatch({changes:{from,to,insert},selection:{anchor:from+insert.length},userEvent:'input.type'});}
describe('incremental Live Preview matches a fresh editor',()=>{
  it.each([
    {name:'ordinary insertion',source:'Plain paragraph\n\n# Heading',from:5,to:5,insert:'new '},
    {name:'ordinary deletion',source:'Plain paragraph\n\n# Heading',from:5,to:10,insert:''},
    {name:'delete entire line text',source:'Plain paragraph\n\n# Heading',from:0,to:15,insert:''},
    {name:'cross-line deletion',source:'Plain\nnext\n\n# Heading',from:3,to:8,insert:''},
    {name:'complete an emoji token',source:':smi le:\n\nend',from:4,to:5,insert:''},
    {name:'form a bare autolink',source:'www.example .com\n\nend',from:11,to:12,insert:''},
    {name:'HTML block text',source:'<div>\nPlain text\n</div>\n\nend',from:10,to:10,insert:'new '},
    {name:'Setext title edit',source:'Plain title\n===========\n\nend',from:5,to:5,insert:'new '},
    {name:'form an ordered list',source:'1.item\n\nend',from:2,to:2,insert:' '},
    {name:'form an indented code block',source:'Plain paragraph\n\nend',from:0,to:0,insert:'    '},
    {name:'form a trailing hard break',source:'Plain text \nnext\n\nend',from:11,to:11,insert:' '},
  ])('$name, undo and redo',({source,from,to,insert})=>{
    const view=mount(source,from);change(view,from,to,insert);expect(snapshot(view)).toBe(snapshot(fresh(view)));
    undo(view);expect(snapshot(view)).toBe(snapshot(fresh(view)));redo(view);expect(snapshot(view)).toBe(snapshot(fresh(view)));
  });
  it('keeps dense containment ranges literal while rendering syntax outside them',()=>{
    const literal=Array.from({length:40},()=>String.fromCharCode(96)+':smile: $x$ **literal**'+String.fromCharCode(96)).join(' ');
    const source=literal+'\n\nOutside :smile: $x$\n\nPlain line',view=mount(source,source.length);change(view,source.length,source.length,' more');
    expect(view.dom.querySelectorAll('.cm-live-inline-code')).toHaveLength(40);expect(view.dom.querySelectorAll('.cm-live-emoji')).toHaveLength(1);expect(view.dom.querySelectorAll('.cm-live-math-inline')).toHaveLength(1);expect(view.dom.querySelectorAll('.cm-live-strong')).toHaveLength(0);
    expect(snapshot(view)).toBe(snapshot(fresh(view)));
  });
  it('keeps a distant image action bound to the mapped source position',()=>{
    const source='Plain text\n\n![image](assets/a.png)\n\nend',view=mount(source,5);change(view,5,5,'new ');
    let requested=-1;view.dom.addEventListener('tegg-edit-object',event=>{event.preventDefault();requested=(event as CustomEvent).detail.from;});
    (view.dom.querySelector('.cm-live-image button') as HTMLButtonElement).click();expect(requested).toBe(view.state.doc.toString().indexOf('!['));
  });
  it('keeps a distant task checkbox bound to the mapped source patch',()=>{
    const source='Plain text\n\n- [ ] task\n\nend',view=mount(source,5);change(view,5,5,'new ');
    const errors:string[]=[];const error=(event:ErrorEvent)=>{event.preventDefault();errors.push(String(event.error));};window.addEventListener('error',error);
    try{(view.dom.querySelector('.cm-live-task') as HTMLInputElement).click();}finally{window.removeEventListener('error',error);}
    expect(errors).toEqual([]);expect(view.state.doc.toString()).toBe('Plainnew  text\n\n- [x] task\n\nend');
  });
});
describe('HeadingIndex cached source revisions',()=>{
  it('matches fresh semantic heading results across deletions, duplicates, syntax and profile changes',()=>{
    const index=new HeadingIndex();
    const revisions=['# Same\n\nbody\n\n## Same\n\n# Last','before\n\n# Same\n\n## Same\n\n# Last','# Same\n\n# Same\n\n# Last','Title\n=====\n\n# [link](target.md) :smile:','---\ntitle: note\n---\n\n# Frontmatter','no headings'];
    for(const profile of ['tegg','github','gfm'] as const)for(const source of revisions){
      const actual=index.update(source,profile),expected=new HeadingIndex().update(source,profile);
      expect(actual.map(({id,...heading})=>heading)).toEqual(expected.map(({id,...heading})=>heading));expect(index.update(source,profile)).toBe(actual);
    }
  });
  it('preserves existing heading identities when ordinary text or a new heading shifts their positions',()=>{
    const index=new HeadingIndex(),before=index.update('# A\n\nbody\n\n## B'),ids=before.map(item=>item.id);
    const after=index.update('# New\n\n# A\n\nlonger body\n\n## B');expect(after.slice(1).map(item=>item.id)).toEqual(ids);expect(ids).not.toContain(after[0].id);
  });
});
