// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {captureMetadataActiveDrafts,createMetadataPanel,disposeMetadataPanel,commitMetadataPanel,bindMetadataEditingLeave,metadataPanelIsComposing} from './metadata';
import {sanitizeRenderedHtml} from './renderKit';
import {EditorView} from '@codemirror/view';
import {EditorState} from '@codemirror/state';
import {editingLeaveIsComposing,prepareIndependentEditingLeave} from './editingPreflight';
import {applySourcePatches,type SourcePatch} from './sourcePatch';
const cleanups:Array<()=>void>=[];
afterEach(()=>{cleanups.splice(0).reverse().forEach(stop=>stop());document.body.replaceChildren();});
function fixture(initial='title: Original'){
 const root=document.body.appendChild(document.createElement('div'));let source=initial;
 const change=vi.fn((patch:SourcePatch)=>{source=applySourcePatches(source,[patch]);return true;});
 const panel=createMetadataPanel(initial,undefined,{expanded:true,onChange:change});root.append(panel);cleanups.push(()=>disposeMetadataPanel(panel));
 const trigger=panel.querySelector<HTMLButtonElement>('.md-metadata-value-edit')!;
 return {root,panel,trigger,change,get source(){return source;},open(){trigger.click();return panel.querySelector<HTMLInputElement>('input')!;}};
}
function button(panel:HTMLElement,text:string){return [...panel.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent===text)!;}
it('only registers an existing generated editable form, not closed or Reader metadata',()=>{
 const f=fixture();expect(captureMetadataActiveDrafts(f.root)).toEqual([]);const input=f.open();
 const [lease]=captureMetadataActiveDrafts(f.root);expect(lease.panel).toBe(input.parentElement);expect(lease.current()).toBe(true);expect(typeof lease.token).toBe('symbol');
 const reader=createMetadataPanel('title: Reader');f.root.append(reader);cleanups.push(()=>disposeMetadataPanel(reader));expect(captureMetadataActiveDrafts(f.root)).toHaveLength(1);
});
it('safe authored HTML class names cannot acquire draft authority even though sanitizer retains the original classes',()=>{
 const root=document.body.appendChild(document.createElement('div'));
 root.innerHTML=sanitizeRenderedHtml('<div class="frontmatter"><div class="md-metadata-value-form"><p>old</p></div></div>');
 expect(root.querySelector('.frontmatter .md-metadata-value-form p')?.textContent).toBe('old');expect(captureMetadataActiveDrafts(root)).toEqual([]);
 const f=fixture();f.open();const copy=f.panel.cloneNode(true) as HTMLElement;root.append(copy);expect(root.querySelector('input')).not.toBeNull();expect(captureMetadataActiveDrafts(root)).toEqual([]);
});
it('captured existing form saves through its exact original SourcePatch and permanently revokes its token',()=>{
 const f=fixture('title: Original # keep');const input=f.open(),[lease]=captureMetadataActiveDrafts(f.root);input.value='Reviewed';
 expect(lease.current()).toBe(true);button(lease.panel,'Save').click();expect(f.source).toBe('title: "Reviewed" # keep');expect(f.change).toHaveBeenCalledOnce();expect(lease.current()).toBe(false);expect(captureMetadataActiveDrafts(f.root)).toEqual([]);
 // A detached old callback must not submit the same patch again.
 button(lease.panel,'Save').click();expect(f.change).toHaveBeenCalledOnce();expect(f.source).toBe('title: "Reviewed" # keep');
});
it('Cancel keeps exact Source and new explicit form receives a different token without resurrecting old authority',()=>{
 const f=fixture(),input=f.open(),[old]=captureMetadataActiveDrafts(f.root);input.value='unapplied';button(old.panel,'Cancel').click();
 expect(f.source).toBe('title: Original');expect(f.change).not.toHaveBeenCalled();expect(old.current()).toBe(false);f.open();const [next]=captureMetadataActiveDrafts(f.root);
 expect(next.token).not.toBe(old.token);expect(next.panel).not.toBe(old.panel);expect(next.current()).toBe(true);expect(old.current()).toBe(false);
 button(old.panel,'Save').click();button(old.panel,'Cancel').click();old.panel.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(f.change).not.toHaveBeenCalled();expect(next.current()).toBe(true);
});
it('Escape and commit-for-leave revoke actual forms without granting later reopened forms the old token',()=>{
 const f=fixture();let input=f.open();const [escaped]=captureMetadataActiveDrafts(f.root);input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(escaped.current()).toBe(false);
 input=f.open();const [left]=captureMetadataActiveDrafts(f.root);input.value='Saved';expect(commitMetadataPanel(f.panel)).toBe(true);expect(f.source).toBe('title: "Saved"');expect(left.current()).toBe(false);expect(captureMetadataActiveDrafts(f.root)).toEqual([]);
});
it('IME rejects Save and leave without revoking the current form or replaying an action at composition end',()=>{
 const f=fixture(),input=f.open(),[lease]=captureMetadataActiveDrafts(f.root);input.value='Reviewed';input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));button(lease.panel,'Save').click();expect(commitMetadataPanel(f.panel)).toBe(false);expect(f.change).not.toHaveBeenCalled();expect(lease.current()).toBe(true);
 input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));expect(f.change).not.toHaveBeenCalled();expect(lease.current()).toBe(true);button(lease.panel,'Save').click();expect(f.source).toBe('title: "Reviewed"');expect(lease.current()).toBe(false);
});
it('invalid input keeps actual existing draft and Source, then permits an explicit valid Save',()=>{
 const f=fixture('count: 12'),input=f.open(),[lease]=captureMetadataActiveDrafts(f.root);input.value='not a number';button(lease.panel,'Save').click();expect(f.source).toBe('count: 12');expect(lease.current()).toBe(true);expect(input.getAttribute('aria-invalid')).toBe('true');
 input.value='13';button(lease.panel,'Save').click();expect(f.source).toBe('count: 13');expect(lease.current()).toBe(false);
});
it('dispose revokes source authority and old form Save cannot write even if stale DOM remains connected',()=>{
 const f=fixture(),input=f.open(),[lease]=captureMetadataActiveDrafts(f.root);input.value='late';disposeMetadataPanel(f.panel);expect(lease.current()).toBe(false);expect(captureMetadataActiveDrafts(f.root)).toEqual([]);button(lease.panel,'Save').click();expect(f.change).not.toHaveBeenCalled();expect(f.source).toBe('title: Original');
});
it('moving a real form into another root or detaching it irreversibly revokes the captured root identity',()=>{
 const f=fixture();f.open();const [moved]=captureMetadataActiveDrafts(f.root),other=document.body.appendChild(document.createElement('div'));other.append(f.panel);expect(moved.current()).toBe(false);f.root.append(f.panel);expect(moved.current()).toBe(false);
 const [detached]=captureMetadataActiveDrafts(f.root);f.panel.remove();expect(detached.current()).toBe(false);f.root.append(f.panel);expect(detached.current()).toBe(false);expect(captureMetadataActiveDrafts(f.root)[0].current()).toBe(true);
});

it('Tags use the actual generated form and keep exact YAML bytes while Cancel/reopen use different tokens',()=>{
 const f=fixture('tags: [one, "two"] # keep'),add=f.open() as HTMLInputElement,[old]=captureMetadataActiveDrafts(f.root);expect(old.panel.classList.contains('md-metadata-tags-form')).toBe(true);add.value='pending';button(old.panel,'Cancel').click();expect(f.source).toBe('tags: [one, "two"] # keep');expect(old.current()).toBe(false);
 const nextAdd=f.open(),[next]=captureMetadataActiveDrafts(f.root);expect(next.token).not.toBe(old.token);expect(next.current()).toBe(true);button(old.panel,'Save').click();expect(f.change).not.toHaveBeenCalled();expect(next.current()).toBe(true);
 nextAdd.value='three';button(next.panel,'Save').click();expect(f.source).toBe('tags: [ one, "two", "three" ] # keep');expect(f.change).toHaveBeenCalledOnce();expect(next.current()).toBe(false);expect(old.current()).toBe(false);
});
it('Tags composition retains the original form without Save, Cancel or leave replay and later explicit Save works',()=>{
 const f=fixture('tags: [one]'),add=f.open(),[lease]=captureMetadataActiveDrafts(f.root);add.value='two';add.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));button(lease.panel,'Save').click();button(lease.panel,'Cancel').click();expect(commitMetadataPanel(f.panel)).toBe(false);expect(f.source).toBe('tags: [one]');expect(f.change).not.toHaveBeenCalled();expect(lease.current()).toBe(true);
 add.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));expect(f.change).not.toHaveBeenCalled();expect(lease.current()).toBe(true);button(lease.panel,'Save').click();expect(f.source).toBe('tags: [ one, "two" ]');expect(lease.current()).toBe(false);
});
it('Tags disposal revokes the actual form and stale Save or tag callbacks never mutate Source',()=>{
 const f=fixture('tags: [one]'),add=f.open(),[lease]=captureMetadataActiveDrafts(f.root);add.value='late';const save=button(lease.panel,'Save'),remove=button(lease.panel,'×');disposeMetadataPanel(f.panel);expect(lease.current()).toBe(false);save.click();remove.click();expect(f.change).not.toHaveBeenCalled();expect(f.source).toBe('tags: [one]');expect(captureMetadataActiveDrafts(f.root)).toEqual([]);
});

it.each(['title: Original','tags: [one]'])('registers real metadata IME with the owning leave boundary and blocks focus-changing Save/Cancel pointer events: %s',initial=>{
 const f=fixture(initial),view=new EditorView({parent:f.root,state:EditorState.create({doc:initial})});cleanups.push(()=>view.destroy());view.dom.append(f.panel);const stop=bindMetadataEditingLeave(f.panel,view);cleanups.push(stop);const input=f.open(),[lease]=captureMetadataActiveDrafts(f.root);input.value='reviewed';
 expect(metadataPanelIsComposing(f.panel)).toBe(false);input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));expect(metadataPanelIsComposing(f.panel)).toBe(true);expect(editingLeaveIsComposing(view)).toBe(true);expect(prepareIndependentEditingLeave(view)).toBe(false);expect(f.change).not.toHaveBeenCalled();
 for(const type of ['pointerdown','mousedown'])for(const label of ['Save','Cancel']){const event=new MouseEvent(type,{bubbles:true,cancelable:true});expect(button(lease.panel,label).dispatchEvent(event)).toBe(false);expect(event.defaultPrevented).toBe(true);expect(lease.current()).toBe(true);expect(editingLeaveIsComposing(view)).toBe(true);}
 input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));expect(editingLeaveIsComposing(view)).toBe(false);expect(f.change).not.toHaveBeenCalled();expect(lease.current()).toBe(true);expect(prepareIndependentEditingLeave(view)).toBe(true);expect(f.change).toHaveBeenCalledOnce();expect(lease.current()).toBe(false);disposeMetadataPanel(f.panel);expect(editingLeaveIsComposing(view)).toBe(false);expect(prepareIndependentEditingLeave(view)).toBe(true);
});
it('rejects author metadata class impersonation in registered global composition and leave authority',()=>{
 const root=document.body.appendChild(document.createElement('div')),view=new EditorView({parent:root});cleanups.push(()=>view.destroy());const fake=document.createElement('section');fake.className='frontmatter';fake.innerHTML='<span class="md-metadata-value-form"><input></span>';view.dom.append(fake);const stop=bindMetadataEditingLeave(fake,view);cleanups.push(stop);fake.querySelector('input')!.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));expect(metadataPanelIsComposing(fake)).toBe(false);expect(editingLeaveIsComposing(view)).toBe(false);expect(captureMetadataActiveDrafts(root)).toEqual([]);
});
