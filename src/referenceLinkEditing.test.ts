/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest';
import {EditorState,StateEffect} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {markdown} from '@codemirror/lang-markdown';
import {GFM} from '@lezer/markdown';
import {history,undo} from '@codemirror/commands';
import {resourceContext} from './editorHost';
import {buildReferenceLinkIndex,referenceDefinitionPatch,referenceOccurrences,referenceDefinitions,referenceLabelReplacement} from './referenceLinkEditing';
import {editCurrentLink,linkAt,linkReplacement,liveLinks} from './liveLinks';
import {prepareIndependentEditingLeave,editingLeaveAwaitingChoice} from './editingPreflight';
const views:EditorView[]=[];
afterEach(()=>{for(const view of views.splice(0))view.destroy();vi.restoreAllMocks();document.body.replaceChildren();});
function open(source:string,position=2){const view=new EditorView({parent:document.body,state:EditorState.create({doc:source,selection:{anchor:position},extensions:[markdown({extensions:GFM}),resourceContext.of({documentPath:'',profile:'tegg'}),history(),liveLinks]})});views.push(view);vi.spyOn(view,'coordsAtPos').mockReturnValue({left:20,right:30,top:20,bottom:40});expect(editCurrentLink(view)).toBe(true);return view;}
function field(name:string,value:string){const element=document.querySelector<HTMLInputElement>('input[aria-label="'+name+'"]')!;expect(element).toBeTruthy();element.value=value;element.dispatchEvent(new Event('input'));return element;}
function button(name:string){const element=Array.from(document.querySelectorAll<HTMLButtonElement>('.md-link-editor button')).find(item=>item.textContent===name)!;expect(element).toBeTruthy();element.click();}
function save(){document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}

it('counts normalized full/collapsed/shortcut link and image references, excluding inline, Wiki, code, footnotes and literal brackets',()=>{
 const source='[One][A  b] [a b][] [a b] ![Image][A b] [same](old) [[old]] [literal] [^a]\n\n`[code][A b]`\n\n```md\n[block][A b]\n```\n\n[A b]: old "note"';
 const index=buildReferenceLinkIndex(source),refs=referenceOccurrences(index,'A B');expect(refs.map(item=>item.raw)).toEqual(['[One][A  b]','[a b][]','[a b]','![Image][A b]']);expect(referenceDefinitions(index,'A B')).toMatchObject([{target:'old',title:'note'}]);expect(index.occurrences.some(item=>item.raw==='[literal]')).toBe(false);
 const definition=index.definitions[0],patch=referenceDefinitionPatch(definition,'new','note');expect(source.slice(0,patch.from)+patch.insert+source.slice(patch.to)).toBe(source.replace('[A b]: old','[A b]: <new>'));
});
it('keeps current reference identity when changing full, collapsed or shortcut plain label',()=>{
 for(const raw of ['[one][id]','[id][]','[id]']){const source=raw+'\n\n[id]: old',index=buildReferenceLinkIndex(source),item=index.occurrences[0];expect(referenceLabelReplacement(item,'new')).toBe('[new][id]');const view=open(source);field('Display text','new');save();expect(view.state.doc.toString()).toBe('[new][id]\n\n[id]: old');expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(source);view.destroy();views.splice(views.indexOf(view),1);}
});
it('edits one shared definition after showing exact affected text and source positions, then undoes all in one parent transaction',()=>{
 const source="[First][id] and [Second][ID]\n\n[inline](old) [[old]]\n\n[id]: old 'author title'\n";const view=open(source);expect(document.querySelector('.md-link-reference-occurrences')).toBeNull();expect(document.querySelector<HTMLInputElement>('[aria-label="Link destination"]')!.readOnly).toBe(true);field('Link destination','new');save();expect(view.state.doc.toString()).toBe(source);expect(document.querySelector('[role="alert"]')?.textContent).toContain('shared target scope');
 button('Shared target (2 occurrences)');const rows=Array.from(document.querySelectorAll<HTMLElement>('.md-link-reference-occurrences li'));expect(rows.map(item=>item.textContent)).toEqual(['First — Line 1','Second — Line 1']);expect(rows.map(item=>Number(item.dataset.sourceFrom))).toEqual([0,source.indexOf('[Second]')]);field('Link destination','new');save();expect(view.state.doc.toString()).toBe(source.replace(': old ',': <new> '));expect(document.querySelector('.md-link-editor')).toBeNull();expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(source);expect(undo(view)).toBe(false);
});
it('protects formatted/entity/multiline display labels with semantic previews while editing only target/title',()=>{
 for(const raw of ["[**bold**](old 'title')", "[a &amp; b](old 'title')", "[first\nsecond](old 'title')", "[`code`](old 'title')"]){const view=open(raw);expect(document.querySelector('[aria-label="Display text"]')?.tagName).toBe('DIV');expect(document.querySelector('input[aria-label="Display text"]')).toBeNull();expect(document.querySelector('.md-link-label-note')?.textContent).toContain('preserve its formatting');field('Link destination','new');save();expect(view.state.doc.toString()).toBe(raw.replace('(old ', '(<new> '));expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(raw);view.destroy();views.splice(views.indexOf(view),1);}
});
it('keeps description conditional and never creates an empty title just by expanding it',()=>{const view=open('[Text](old)');const details=document.querySelector<HTMLDetailsElement>('.md-link-title-details')!;expect(details.open).toBe(false);details.open=true;save();expect(view.state.doc.toString()).toBe('[Text](old)');expect(undo(view)).toBe(false);expect(editCurrentLink(view)).toBe(true);field('Description (optional)','new description');save();expect(view.state.doc.toString()).toBe('[Text](old "new description")');expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe('[Text](old)');});
it('does not invent a Wiki alias or anchor when only its target changes, and retains explicit rich aliases',()=>{
 for(const [raw,next] of [['[[Old]]','[[New]]'],['[[Old|Old]]','[[New|Old]]'],['[[Old#^block|**Rich**]]','[[New#^block|**Rich**]]']]){const target=raw.includes('#')?'New#^block':'New',view=open(raw);field('Link destination',target);save();expect(view.state.doc.toString()).toBe(next);expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(raw);view.destroy();views.splice(views.indexOf(view),1);}
 const state=EditorState.create({doc:'[[Old]]',extensions:[markdown({extensions:GFM}),resourceContext.of({documentPath:'',profile:'tegg'})]}),link=linkAt({state} as EditorView,2)!;expect(linkReplacement(link,link.label,'New')).toBe('[[New]]');
});
it('creates a missing definition only in the reviewed shared scope, and refuses conflicting definitions without merging',()=>{
 const source='[First][missing] [Second][missing]',view=open(source);button('Shared target (2 occurrences)');expect(document.querySelector('.md-link-shared-scope')?.textContent).toContain('definition is missing');field('Link destination','target.md');save();expect(view.state.doc.toString()).toBe(source+'\n\n[missing]: <target.md>');expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(source);view.destroy();views.splice(views.indexOf(view),1);
 const conflict='[First][id]\n\n[id]: first\n[id]: second',other=open(conflict);button('Shared target (1 occurrences)');expect(Array.from(document.querySelectorAll('.md-link-conflicting-definition')).map(item=>item.textContent)).toEqual(['[id]: first','[id]: second']);expect(document.querySelector<HTMLInputElement>('[aria-label="Link destination"]')!.readOnly).toBe(true);field('Link destination','new');save();expect(other.state.doc.toString()).toBe(conflict);expect(document.querySelector('[role="alert"]')?.textContent).toContain('multiple definitions');expect(undo(other)).toBe(false);
});
it('rejects a changed shared definition or occurrence scope and retains the independent draft',()=>{
 const source='[First][id]\n\n[id]: old',view=open(source);button('Shared target (1 occurrences)');field('Link destination','draft');view.dispatch({changes:{from:view.state.doc.length,insert:'\n\n[New][id]'}});save();expect(view.state.doc.toString()).toBe(source+'\n\n[New][id]');expect(document.querySelector('[role="alert"]')?.textContent).toContain('scope changed');expect(document.querySelector<HTMLInputElement>('[aria-label="Link destination"]')!.value).toBe('draft');expect(prepareIndependentEditingLeave(view)).toBe(false);button('Discard changes');expect(document.querySelector('.md-link-editor')).toBeNull();
});
it('keeps shared drafts through composition and read-only rejection without replaying a cancelled leave',()=>{
 const source='[First][id]\n\n[id]: old',view=open(source);let resolved=0;view.dom.addEventListener('tegg-editing-leave-resolved',()=>resolved++);button('Shared target (1 occurrences)');const input=field('Link destination','draft');expect(prepareIndependentEditingLeave(view)).toBe(false);button('Keep editing');input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));button('Cancel');save();expect(view.state.doc.toString()).toBe(source);expect(document.querySelector('.md-link-editor')).not.toBeNull();input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));view.dispatch({effects:StateEffect.appendConfig.of(EditorState.readOnly.of(true))});save();expect(view.state.doc.toString()).toBe(source);expect(document.querySelector('[role="alert"]')?.textContent).toContain('read-only');expect(prepareIndependentEditingLeave(view)).toBe(false);expect(editingLeaveAwaitingChoice(view)).toBe(true);button('Discard changes');expect(resolved).toBe(1);
});

it('preserves every untouched ordinary link field byte when changing the label, target, title or removing only the title',()=>{
 const raw="[plain](<folder/a%20b.md?literal=%2520> 'author &amp; title')";
 const view=open(raw);field('Display text','new');save();expect(view.state.doc.toString()).toBe(raw.replace('[plain]','[new]'));expect(undo(view)).toBe(true);
 expect(editCurrentLink(view)).toBe(true);field('Description (optional)','new title');save();expect(view.state.doc.toString()).toBe(raw.replace("'author &amp; title'",'"new title"'));expect(undo(view)).toBe(true);
 expect(editCurrentLink(view)).toBe(true);field('Description (optional)','');save();expect(view.state.doc.toString()).toBe(raw.replace("'author &amp; title'",''));expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(raw);
});

it('counts nested bracket labels and never counts a Wiki target that matches a defined shortcut key',()=>{
 const source='[outer [nested]][id] [[id]] [id]\n\n[id]: old';
 const index=buildReferenceLinkIndex(source);expect(referenceOccurrences(index,'ID').map(item=>item.raw)).toEqual(['[outer [nested]][id]','[id]']);expect(index.occurrences[0].label).toBe('outer [nested]');
});

it('counts actual references outside opaque TeX, safe HTML attributes and Callout type markers',()=>{
 const source='[Visible][id] $[math][id]$\n\n$$\n[block][id]\n$$\n\n> [!id] [Header][id]\n> [Body][id]\n\n<span data-value="[attribute][id]">[Text][id]</span>\n\n[id]: old\n[!id]: marker';
 expect(buildReferenceLinkIndex(source).occurrences.map(item=>item.raw)).toEqual(['[Visible][id]','[Header][id]','[Body][id]','[Text][id]']);
});

it('resolves external parent definitions without manufacturing local definitions or counting local Wiki syntax',()=>{
 const source='[Outside][id]\n\n[id]: parent.md "title"',index=buildReferenceLinkIndex('[[id]] [Cell][id] [id]','tegg',source);
 expect(index.definitions).toEqual([]);expect(index.resolved.ID).toEqual({href:'parent.md',title:'title'});expect(index.occurrences.map(item=>item.raw)).toEqual(['[Cell][id]','[id]']);
});
it('retains authored multiline quoted definition title bytes when changing only a target',()=>{
 const source='> [id]: old\n>   "first\n>   second"\n\n[Text][id]',view=open(source,source.indexOf('[Text]')+2);button('Shared target (1 occurrences)');field('Link destination','new');save();expect(view.state.doc.toString()).toBe(source.replace(': old',': <new>'));expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(source);
});

it('includes shared references inside a footnote body without counting the footnote citation or label as links',()=>{const source='[Outside][id] note[^n]\n\n[id]: old\n\n[^n]: [Note][id]';expect(buildReferenceLinkIndex(source).occurrences.map(item=>item.raw)).toEqual(['[Outside][id]','[Note][id]']);});

 it('indexes definitions after frontmatter in original CRLF coordinates and patches only destination bytes',()=>{
 const source='---\r\ntitle: "[Not][ref]"\r\n---\r\n\r\nBefore\r\n\r\n[Linked][ref] **bold**\r\n\r\nSecond &amp; text\r\n\r\n[ref]: <secret.md> "Exact title"\r\n[unused]: other.md';
 const index=buildReferenceLinkIndex(source),definition=referenceDefinitions(index,'REF')[0];
 expect(referenceOccurrences(index,'REF').map(item=>item.raw)).toEqual(['[Linked][ref]']);
 expect(index.resolved.REF).toEqual({href:'secret.md',title:'Exact title'});
 expect(definition).toMatchObject({from:source.indexOf('[ref]:'),to:source.indexOf('\r\n[unused]'),raw:'[ref]: <secret.md> "Exact title"',target:'secret.md',title:'Exact title'});
 expect(source.slice(definition.from,definition.to)).toBe(definition.raw);
 const patch=referenceDefinitionPatch(definition,'updated.md','Exact title');
 expect(source.slice(0,patch.from)+patch.insert+source.slice(patch.to)).toBe(source.replace('<secret.md>','<updated.md>'));
 expect(index.definitions.map(item=>item.raw)).toEqual(['[ref]: <secret.md> "Exact title"','[unused]: other.md']);
 });
