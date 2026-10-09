// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {renderMarkdown,locateRenderedSourceRange} from './markdown';
import {ContentDisplaySession} from './contentDisplaySession';
afterEach(()=>{vi.restoreAllMocks();document.body.replaceChildren();});
function root(){return document.body.appendChild(document.createElement('div'));}
it('locates the actual registered owner and rejects author-provided source attributes',async()=>{
 const target=root(),source='First **paragraph**\n\nSecond';await renderMarkdown(source,target,{enhancedInteractions:false});
 const first=target.querySelector('p')!;expect(locateRenderedSourceRange(target,{from:0,to:source.indexOf('\n')})).toBe(first);expect(document.activeElement).toBe(first);
 const forged=target.appendChild(document.createElement('p'));forged.dataset.sourceFrom='100';forged.dataset.sourceTo='200';forged.textContent='Forged';expect(locateRenderedSourceRange(target,{from:100,to:200})).toBeNull();
 expect(locateRenderedSourceRange(target,{from:-1,to:2})).toBeNull();target.remove();expect(locateRenderedSourceRange(target,{from:0,to:1})).toBeNull();
});
it('locates a collapsed Callout at its visible owner without focusing hidden body or changing author source',async()=>{
 const target=root(),source='> [!note]- Title\n> Hidden body',session=new ContentDisplaySession();await renderMarkdown(source,target,{displaySession:session});
 const quote=target.querySelector<HTMLElement>('.callout')!;expect(locateRenderedSourceRange(target,{from:0,to:source.length})).toBe(quote);expect(quote.dataset.calloutExpanded).toBe('false');expect(target.querySelector('.callout-title')).not.toBe(document.activeElement);
});
it('revokes detached old owners and uses remapped ranges after a renderer update',async()=>{
 const target=root();await renderMarkdown('Old\n\nTail',target,{enhancedInteractions:false});const old=target.querySelector('p')!;await renderMarkdown('New heading\n\nSecond paragraph',target,{enhancedInteractions:false});
 const current=locateRenderedSourceRange(target,{from:13,to:29});expect(current?.textContent).toBe('Second paragraph');expect(current).not.toBe(old);expect(target.contains(current)).toBe(true);
});
