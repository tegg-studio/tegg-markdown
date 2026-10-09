/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from "vitest";
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history,undoDepth} from '@codemirror/commands';
import {sourcePreservingHtmlDraft} from './richHtmlDraft';
import {attachHtmlObjectEditing} from './htmlObjectEditing';
import {enhanceFigures,renderedImageViewControls,disposeRenderedImageView} from "./renderInteraction";
afterEach(()=>{document.body.replaceChildren();vi.unstubAllGlobals();});
function fixture(html:string){
 const frames:FrameRequestCallback[]=[];vi.stubGlobal('requestAnimationFrame',(f:FrameRequestCallback)=>{frames.push(f);return frames.length;});
 const root=document.createElement('div');root.innerHTML=html;document.body.append(root);
 for(const image of root.querySelectorAll('img')){Object.defineProperties(image,{naturalWidth:{value:320},naturalHeight:{value:200},complete:{value:true}});image.getBoundingClientRect=()=>({x:0,y:0,top:0,left:0,bottom:200,right:320,width:320,height:200,toJSON(){}});}
 return {root,flush:()=>{for(const f of frames.splice(0))f(0);}};
}
it('registers only real generated controls for a tight image-first list and remains stable on repeated enhancement',()=>{
 const {root,flush}=fixture('<ul><li><img src="data:image/png;base64,AA==" alt="First"><ul><li>Nested author text</li></ul></li></ul>'),owner=root.querySelector('li')!,image=owner.querySelector('img')!;
 enhanceFigures(root);flush();const controls=renderedImageViewControls(owner);expect(controls).toHaveLength(1);expect(controls[0].parentElement).toBe(owner);expect(controls[0].querySelector('button')?.getAttribute('aria-label')).toBe('View image');
 enhanceFigures(root);flush();expect(renderedImageViewControls(owner)).toEqual(controls);expect(owner.querySelectorAll('.md-image-view-actions')).toHaveLength(1);expect(owner.querySelector('ul')!.textContent).toBe('Nested author text');expect(image.alt).toBe('First');
 const forged=controls[0].cloneNode(true) as HTMLElement;owner.append(forged);expect(renderedImageViewControls(owner)).toEqual(controls);controls[0].remove();expect(renderedImageViewControls(owner)).toEqual([]);expect(owner.contains(forged)).toBe(true);
});
it('does not treat linked, adjacent-text, multi-image, or authored control-class content as standalone projections',()=>{
 const {root,flush}=fixture('<ul><li><a href="#author"><img src="x"></a></li><li>Before <img src="x"></li><li><img src="x"> After</li><li><img src="x"><img src="x"></li><li><img src="x"><div class="md-image-view-actions" data-tegg-editor-projection="true">Authored content</div></li></ul>');enhanceFigures(root);flush();
 for(const owner of root.querySelectorAll('li'))expect(renderedImageViewControls(owner)).toEqual([]);expect(root.querySelector('a')!.getAttribute('href')).toBe('#author');expect(root.textContent).toContain('Authored content');
});
it('keeps controls unavailable when the complete action group cannot fit inside the image',()=>{
 const {root,flush}=fixture('<ul><li><img src="x"></li></ul>'),owner=root.querySelector('li')!,image=owner.querySelector('img')!;image.getBoundingClientRect=()=>({x:0,y:0,top:0,left:0,bottom:20,right:20,width:20,height:20,toJSON(){}});enhanceFigures(root);flush();
 expect(renderedImageViewControls(owner)[0].hidden).toBe(true);image.click();expect(owner.dataset.imageSelected).toBe('false');expect(root.querySelector('dialog')).toBeNull();
});

it('refreshing an existing image revokes only its actual controls and creates a fresh working View group',()=>{
 const {root,flush}=fixture('<figure><img src="x"><figcaption>Caption</figcaption><span class="md-image-view-actions" data-tegg-editor-projection="true">Author</span></figure>'),owner=root.querySelector('figure')!,image=root.querySelector('img')!,author=owner.querySelector('span')!;
 enhanceFigures(root);flush();const old=renderedImageViewControls(owner)[0];expect(old).toBeDefined();disposeRenderedImageView(image);expect(old.isConnected).toBe(false);expect(author.isConnected).toBe(true);expect(author.textContent).toBe('Author');expect(renderedImageViewControls(owner)).toEqual([]);
 enhanceFigures(root);flush();const next=renderedImageViewControls(owner);expect(next).toHaveLength(1);expect(next[0]).not.toBe(old);expect(next[0].querySelector('button')?.getAttribute('aria-label')).toBe('View image');expect(author.isConnected).toBe(true);
});

it('the real HTML object refresh keeps View mounted and never removes author lookalike controls',()=>{
 const source='<figure><img src="x"><figcaption>Caption<span class="md-image-view-actions">Author</span></figcaption></figure>',{root,flush}=fixture(source),parent=document.body.appendChild(document.createElement('div')),view=new EditorView({parent,state:EditorState.create({doc:source,extensions:[history()]})}),owner=root.querySelector('figure')!,author=root.querySelector('figcaption span')!,draft=sourcePreservingHtmlDraft(root,source);
 enhanceFigures(root);flush();const initial=renderedImageViewControls(owner)[0];
 const editing=attachHtmlObjectEditing(root,view,draft,{uiRoot:root,readOnly:()=>false,composing:()=>false,current:()=>true,changed:()=>{},report:error=>{throw error;}});
 try{flush();expect(renderedImageViewControls(owner)).toHaveLength(1);expect(renderedImageViewControls(owner)[0]).not.toBe(initial);expect(author.isConnected).toBe(true);editing.refresh();flush();expect(renderedImageViewControls(owner)).toHaveLength(1);expect(author.textContent).toBe('Author');expect(draft.serialize()).toBe(source);expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);}finally{editing.dispose();view.destroy();}
});

it('the real HTML image action group retains both actions when it fits and keeps only the original Edit fallback when it does not',()=>{
 const source='<figure><img src="x"><figcaption>Caption</figcaption></figure>',{root,flush}=fixture(source),parent=document.body.appendChild(document.createElement('div')),view=new EditorView({parent,state:EditorState.create({doc:source,extensions:[history()]})}),owner=root.querySelector('figure')!,image=root.querySelector('img')!,draft=sourcePreservingHtmlDraft(root,source);
 let width=320;image.getBoundingClientRect=()=>({x:0,y:0,top:0,left:0,bottom:200,right:width,width,height:200,toJSON(){}});
 enhanceFigures(root);const original=renderedImageViewControls(owner)[0];
 const editing=attachHtmlObjectEditing(root,view,draft,{uiRoot:root,readOnly:()=>false,composing:()=>false,current:()=>true,changed:()=>{},report:error=>{throw error;}});
 try{
  flush();const controls=renderedImageViewControls(owner)[0];expect(controls).not.toBe(original);expect(controls.hidden).toBe(false);expect([...controls.querySelectorAll('button')].map(button=>button.getAttribute('aria-label'))).toEqual(['Edit image','View image']);
  const edit=controls.querySelector<HTMLElement>('.md-html-object-actions')!;width=40;window.dispatchEvent(new Event('resize'));expect(controls.hidden).toBe(true);expect(image.nextElementSibling).toBe(edit);expect(edit.isConnected).toBe(true);expect(renderedImageViewControls(owner)).toEqual([controls,edit]);
  width=320;window.dispatchEvent(new Event('resize'));expect(controls.hidden).toBe(false);expect(controls.firstElementChild).toBe(edit);expect(renderedImageViewControls(owner)).toEqual([controls]);expect(draft.serialize()).toBe(source);expect(view.state.doc.toString()).toBe(source);expect(undoDepth(view.state)).toBe(0);
 }finally{editing.dispose();view.destroy();}
});


it('image resize observation defers fitting until the next frame and disposal leaves no stale controls',()=>{
 const callbacks:ResizeObserverCallback[]=[];
 vi.stubGlobal('ResizeObserver',class {constructor(callback:ResizeObserverCallback){callbacks.push(callback);}observe(){}disconnect(){}unobserve(){}});
 const {root,flush}=fixture('<figure><img src="x"></figure>'),owner=root.querySelector('figure')!,image=root.querySelector('img')!;
 let width=320;image.getBoundingClientRect=()=>({x:0,y:0,top:0,left:0,bottom:200,right:width,width,height:200,toJSON(){}});
 enhanceFigures(root);flush();const controls=renderedImageViewControls(owner)[0];expect(controls.hidden).toBe(false);
 width=20;callbacks[0]([],{} as ResizeObserver);callbacks[0]([],{} as ResizeObserver);expect(controls.hidden).toBe(false);flush();expect(controls.hidden).toBe(true);
 width=320;callbacks[0]([],{} as ResizeObserver);disposeRenderedImageView(image);flush();expect(controls.isConnected).toBe(false);expect(renderedImageViewControls(owner)).toEqual([]);
});
