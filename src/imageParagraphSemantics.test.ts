/** @vitest-environment jsdom */
import {it,expect,vi,beforeAll} from 'vitest';
import {enhanceFigures} from './renderInteraction';
import {renderMarkdown} from './markdown';
import {sourcePreservingHtmlDraft} from './richHtmlDraft';
beforeAll(()=>{vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});vi.stubGlobal('requestAnimationFrame',()=>1);});

it.each([
 ['<p> Before <img src="small.png"> after </p>',false],
 ['<p> Before <a href="#link"><img src="small.png"></a> after </p>',false],
 ['<p><a href="#link">Text <img src="small.png"></a></p>',false],
 ['<p><img src="first.png"><img src="second.png"></p>',false],
 ['<p> \n<img src="small.png"> \n</p>',true],
 ['<p><a href="#link"> \n<img src="small.png"> \n</a></p>',true],
])('classifies authored paragraph content rather than element count: %s',(source,standalone)=>{
 const root=document.createElement('div');root.innerHTML=source;enhanceFigures(root);
 expect(root.querySelector('p')!.dataset.imageParagraph==='true').toBe(standalone);
 enhanceFigures(root);expect(root.querySelector('p')!.dataset.imageParagraph==='true').toBe(standalone);
});

it('preserves noninteractive image-only presentation without adding a viewer control',async()=>{
 const root=document.createElement('div');await renderMarkdown('![Image](small.png)',root,{enhancedInteractions:false});
 expect(root.querySelector('p')!.dataset.imageParagraph).toBe('true');expect(root.querySelector('button')).toBeNull();
});

it('removes the generated paragraph marker after authored content changes and never writes it to source',()=>{
 const source='<p><img src="small.png" alt="Small"></p>',root=document.createElement('div');root.innerHTML=source;enhanceFigures(root);
 const draft=sourcePreservingHtmlDraft(root,source),p=root.querySelector('p')!;
 p.prepend(document.createTextNode('Before '));draft.markChanged();enhanceFigures(root);
 expect(p.dataset.imageParagraph).toBeUndefined();expect(draft.serialize()).toBe('<p>Before <img src="small.png" alt="Small"></p>');
});
