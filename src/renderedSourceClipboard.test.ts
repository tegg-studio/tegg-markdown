// @vitest-environment jsdom
import {afterEach,describe,expect,it} from 'vitest';
import {isRenderedClipboardOpaque,mapRenderedClipboardRange,registerRenderedClipboardOpaque,registerRenderedClipboardLiteral,registerRenderedSourceRange} from './renderedSourceClipboard';

afterEach(()=>document.body.replaceChildren());
function mount(html:string){const root=document.body.appendChild(document.createElement('div'));root.innerHTML=html;return root;}
function selected(node:Node,whole=false){const range=document.createRange();whole?range.selectNode(node):range.selectNodeContents(node);return range;}
function textRange(node:Node,from:number,to:number){const range=document.createRange();range.setStart(node,from);range.setEnd(node,to);return range;}

describe('trusted rendered source clipboard ranges',()=>{
 it('identifies only registered generated nodes and retains newer registration ownership',()=>{
  const root=mount('<button class="callout-icon" data-tegg-temporary>authored</button><button>generated</button>'),author=root.firstChild!,generated=root.lastChild!;
  expect(isRenderedClipboardOpaque(author)).toBe(false);expect(isRenderedClipboardOpaque(generated)).toBe(false);
  const old=registerRenderedClipboardOpaque(generated),current=registerRenderedClipboardOpaque(generated);
  old();expect(isRenderedClipboardOpaque(generated)).toBe(true);expect(isRenderedClipboardOpaque(generated.cloneNode(true))).toBe(false);
  current();expect(isRenderedClipboardOpaque(generated)).toBe(false);
 });
 it('maps a complete formatted paragraph to its original source, including authored syntax',()=>{
  const source='**first** &amp; text';const root=mount('<p><strong>first</strong> &amp; text</p>'),p=root.firstChild!;
  registerRenderedSourceRange(p,{from:0,to:source.length});expect(mapRenderedClipboardRange(root,selected(p),source)).toEqual({from:0,to:source.length});
 });
 it('maps full block endpoints through text-node boundaries, preserving inter-block source whitespace',()=>{
  const source='one\n\n\n**two**';const root=mount('<p>one</p>\n<p><strong>two</strong></p>'),a=root.children[0],b=root.children[1];
  registerRenderedSourceRange(a,{from:0,to:3});registerRenderedSourceRange(b,{from:6,to:13});
  const range=document.createRange();range.setStart(a.firstChild!,0);range.setEnd(b.firstChild!.firstChild!,3);
  expect(mapRenderedClipboardRange(root,range,source)).toEqual({from:0,to:13});
 });
 it('refuses a partial ordinary inline selection for controlled-HTML fallback',()=>{
  const source='**first**';const root=mount('<p><strong>first</strong></p>'),p=root.firstChild!,text=p.firstChild!.firstChild!;
  registerRenderedSourceRange(p,{from:0,to:source.length});expect(mapRenderedClipboardRange(root,textRange(text,1,4),source)).toBeNull();
 });
 it('does not infer source authority from author data attributes or familiar classes',()=>{
  const root=mount('<p data-source-from="0" data-source-to="99" data-tegg-source-key="trusted" class="cm-live-code">author</p>');
  expect(mapRenderedClipboardRange(root,selected(root),'secret source')).toBeNull();
 });
 for(const [kind,source,html] of [
  ['code','```text\n\t **literal**\n\n```','<pre><code>\t **literal**\n\n</code></pre>'],
  ['table','| a | b |\n| --- | --- |\n| c | d |','<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>'],
  ['math','$$\nx+1\n$$','<div><span>x+1</span></div>'],
  ['diagram','```mermaid\ngraph TD;A-->B\n```','<figure><svg><text>A</text></svg></figure>'],
  ['safe HTML','<details data-original="yes"><summary>title</summary><p>body</p></details>','<details><summary>title</summary><p>body</p></details>']
 ] as const){it(`expands an object-internal ${kind} text endpoint to the complete original object`,()=>{
   const root=mount(html),object=root.firstChild!;registerRenderedSourceRange(object,{from:0,to:source.length,object:true});
   const walker=document.createTreeWalker(object,NodeFilter.SHOW_TEXT),text=walker.nextNode()!;
   expect(mapRenderedClipboardRange(root,textRange(text,0,1),source)).toEqual({from:0,to:source.length});
 });}
 it('maps a selected image with no text nodes to its complete source',()=>{
  const source='![actual alt](image.png "title")';const root=mount('<img src="image.png" alt="actual alt">'),image=root.firstChild!;
  registerRenderedSourceRange(image,{from:0,to:source.length,object:true});expect(mapRenderedClipboardRange(root,selected(image,true),source)).toEqual({from:0,to:source.length});
 });
 it('expands partial first/last objects while keeping complete middle blocks and source gaps',()=>{
  const source='```a\none\n```\n\nmiddle\n\n$$two$$',root=mount('<pre><code>one</code></pre><p>middle</p><div>two</div>');
  const [a,b,c]=Array.from(root.children);registerRenderedSourceRange(a,{from:0,to:12,object:true});registerRenderedSourceRange(b,{from:14,to:20});registerRenderedSourceRange(c,{from:22,to:29,object:true});
  const range=document.createRange();range.setStart(a.firstChild!.firstChild!,1);range.setEnd(c.firstChild!,2);
  expect(mapRenderedClipboardRange(root,range,source)).toEqual({from:0,to:29});
 });
 it('refuses mixed objects plus a partial ordinary endpoint instead of discarding the partial text',()=>{
  const source='$$one$$\n\ntwo',root=mount('<div>one</div><p>two</p>'),a=root.firstChild!,b=root.lastChild!;
  registerRenderedSourceRange(a,{from:0,to:7,object:true});registerRenderedSourceRange(b,{from:9,to:12});
  const range=document.createRange();range.setStart(a.firstChild!,1);range.setEnd(b.firstChild!,2);expect(mapRenderedClipboardRange(root,range,source)).toBeNull();
 });
 it('copies the complete folded Callout, including hidden source, when its wrapper is selected',()=>{
  const source='> [!note]- Title\n> hidden **body**',root=mount('<aside><button>toggle</button><h4>Title</h4><div hidden>hidden body</div></aside>');
  const callout=root.firstChild!,title=(callout as Element).querySelector('h4')!;
  registerRenderedSourceRange(callout,{from:0,to:source.length,object:true});registerRenderedSourceRange(title,{from:0,to:source.length,calloutTitle:true});
  registerRenderedClipboardOpaque((callout as Element).querySelector('button')!);
  expect(mapRenderedClipboardRange(root,selected(callout,true),source)).toEqual({from:0,to:source.length});
 });
 for(const wholeTitle of [false,true])it(`does not expand a ${wholeTitle?'whole title node':'partial title text'} selection into hidden Callout source`,()=>{
  const source='> [!note]- Title\n> hidden',root=mount('<aside><h4>Title</h4><div hidden>hidden</div></aside>'),callout=root.firstChild!,title=callout.firstChild!;
  registerRenderedSourceRange(callout,{from:0,to:source.length,object:true});registerRenderedSourceRange(title,{from:0,to:source.length,calloutTitle:true});
  expect(mapRenderedClipboardRange(root,wholeTitle?selected(title,true):textRange(title.firstChild!,1,3),source)).toBeNull();
 });

 it('keeps partial and complete internal code text on the literal fallback path',()=>{
  const source='```text\n\tfirst\n\n```',root=mount('<pre><code>\tfirst\n\n</code></pre>'),object=root.firstChild!,code=object.firstChild!;
  registerRenderedSourceRange(object,{from:0,to:source.length,object:true});registerRenderedClipboardLiteral(code);
  expect(mapRenderedClipboardRange(root,textRange(code.firstChild!,1,4),source)).toBeNull();
  expect(mapRenderedClipboardRange(root,selected(code),source)).toBeNull();
  expect(mapRenderedClipboardRange(root,selected(code,true),source)).toBeNull();
  expect(mapRenderedClipboardRange(root,selected(object,true),source)).toEqual({from:0,to:source.length});
 });
 it('keeps a same-cell internal selection from expanding to the entire table',()=>{
  const source='| a | b |\n| --- | --- |\n| c | d |',root=mount('<table><tr><td><strong>alpha</strong></td><td>beta</td></tr></table>'),table=root.firstChild!,cell=(table as Element).querySelector('td')!;
  registerRenderedSourceRange(table,{from:0,to:source.length,object:true});registerRenderedClipboardLiteral(cell);
  expect(mapRenderedClipboardRange(root,textRange(cell.firstChild!.firstChild!,1,4),source)).toBeNull();
  expect(mapRenderedClipboardRange(root,selected(cell,true),source)).toBeNull();
  expect(mapRenderedClipboardRange(root,selected(table,true),source)).toEqual({from:0,to:source.length});
 });
 it('expands an object when an external selection enters a registered literal body',()=>{
  const source='before\n\n```text\nfirst\n```',root=mount('<p>before</p><pre><code>first</code></pre>'),before=root.firstChild!,object=root.lastChild!,code=object.firstChild!;
  registerRenderedSourceRange(before,{from:0,to:6});registerRenderedSourceRange(object,{from:8,to:source.length,object:true});registerRenderedClipboardLiteral(code);
  const range=document.createRange();range.setStart(before.firstChild!,0);range.setEnd(code.firstChild!,2);
  expect(mapRenderedClipboardRange(root,range,source)).toEqual({from:0,to:source.length});
 });
 it('uses actual literal registrations instead of author attributes and preserves a newer owner',()=>{
  const source='$$expression$$',root=mount('<div><span data-literal="true">expression</span></div>'),object=root.firstChild!,body=object.firstChild!,range=textRange(body.firstChild!,1,4);
  registerRenderedSourceRange(object,{from:0,to:source.length,object:true});
  expect(mapRenderedClipboardRange(root,range,source)).toEqual({from:0,to:source.length});
  const old=registerRenderedClipboardLiteral(body),current=registerRenderedClipboardLiteral(body);old();expect(mapRenderedClipboardRange(root,range,source)).toBeNull();
  current();expect(mapRenderedClipboardRange(root,range,source)).toEqual({from:0,to:source.length});
 });
 it('uses the complete registered outer quote/list container when all of it is selected',()=>{
  const source='> one\n>\n> two',root=mount('<blockquote><p>one</p><p>two</p></blockquote>'),quote=root.firstChild!;
  registerRenderedSourceRange(quote,{from:0,to:source.length});registerRenderedSourceRange(quote.firstChild!,{from:0,to:5});registerRenderedSourceRange(quote.lastChild!,{from:8,to:source.length});
  expect(mapRenderedClipboardRange(root,selected(quote),source)).toEqual({from:0,to:source.length});
 });
 it('does not include an adjacent unselected registered paragraph',()=>{
  const source='one\n\ntwo\n\nthree',root=mount('<p>one</p><p>two</p><p>three</p>');
  Array.from(root.children).forEach((node,index)=>registerRenderedSourceRange(node,{from:[0,5,10][index],to:[3,8,15][index]}));
  expect(mapRenderedClipboardRange(root,selected(root.children[1]),source)).toEqual({from:5,to:8});
 });
 it('refuses selected unregistered middle text instead of swallowing unknown source',()=>{
  const source='one\n\nunknown\n\ntwo',root=mount('<p>one</p><section>unknown</section><p>two</p>');
  registerRenderedSourceRange(root.firstChild!,{from:0,to:3});registerRenderedSourceRange(root.lastChild!,{from:14,to:17});
  expect(mapRenderedClipboardRange(root,selected(root),source)).toBeNull();
 });
 it('refuses an unregistered image or empty explicit block between registered paragraphs',()=>{
  for(const html of ['<img alt="unknown">','<p></p>','<p> \t </p>','<br>']){
   const root=mount(`<p>one</p>${html}<p>two</p>`),source='one\n\nunknown\n\ntwo';
   registerRenderedSourceRange(root.firstChild!,{from:0,to:3});registerRenderedSourceRange(root.lastChild!,{from:14,to:17});
   expect(mapRenderedClipboardRange(root,selected(root),source)).toBeNull();
  }
 });
 it('does not let a generated control endpoint select its surrounding atomic object',()=>{
  const source='```text\nbody\n```',root=mount('<figure><button><span>Copy</span></button><pre>body</pre></figure>'),object=root.firstChild!,button=(object as Element).querySelector('button')!;
  registerRenderedSourceRange(object,{from:0,to:source.length,object:true});registerRenderedClipboardOpaque(button);
  expect(mapRenderedClipboardRange(root,selected(button),source)).toBeNull();
  expect(mapRenderedClipboardRange(root,selected(button,true),source)).toBeNull();
  expect(mapRenderedClipboardRange(root,textRange(button.firstChild!.firstChild!,1,3),source)).toBeNull();
  expect(mapRenderedClipboardRange(root,selected(object,true),source)).toEqual({from:0,to:source.length});
 });
 it('refuses a generated control between selected blocks',()=>{
  const source='one\n\ntwo',root=mount('<p>one</p><button>generated</button><p>two</p>');
  registerRenderedSourceRange(root.firstChild!,{from:0,to:3});registerRenderedSourceRange(root.lastChild!,{from:5,to:8});registerRenderedClipboardOpaque(root.children[1]);
  expect(mapRenderedClipboardRange(root,selected(root),source)).toBeNull();
 });
 it('rejects reversed or overlapping source coordinates in DOM order',()=>{
  for(const span of [{from:0,to:3},{from:1,to:4}]){
   const root=mount('<p>one</p><p>two</p>');registerRenderedSourceRange(root.firstChild!,{from:2,to:5});registerRenderedSourceRange(root.lastChild!,span);
   expect(mapRenderedClipboardRange(root,selected(root),'123456')).toBeNull();
  }
 });
 it('rejects invalid source boundaries rather than guessing',()=>{
  for(const span of [{from:-1,to:3},{from:0,to:99},{from:1.5,to:3},{from:0,to:0},{from:NaN,to:3}]){
   const root=mount('<p>one</p>');registerRenderedSourceRange(root.firstChild!,span);expect(mapRenderedClipboardRange(root,selected(root),'one')).toBeNull();
  }
 });
 it('refuses collapsed and detached/outside-root ranges',()=>{
  const root=mount('<p>one</p>'),other=mount('<p>other</p>');registerRenderedSourceRange(root.firstChild!,{from:0,to:3});
  expect(mapRenderedClipboardRange(root,textRange(root.firstChild!.firstChild!,1,1),'one')).toBeNull();
  expect(mapRenderedClipboardRange(root,selected(other),'one')).toBeNull();
  const old=root.firstChild!,range=selected(old);root.replaceChildren();expect(mapRenderedClipboardRange(root,range,'one')).toBeNull();
 });
 it('copies registration values and keeps a newer registration when an old owner disposes',()=>{
  const root=mount('<p>one</p>'),node=root.firstChild!,span={from:0,to:3};const dispose=registerRenderedSourceRange(node,span);span.to=99;
  expect(mapRenderedClipboardRange(root,selected(node),'one')).toEqual({from:0,to:3});
  registerRenderedSourceRange(node,{from:2,to:5});dispose();expect(mapRenderedClipboardRange(root,selected(node),'__one')).toEqual({from:2,to:5});
 });
 it('keeps a new opaque owner when an older owner disposes',()=>{
  const root=mount('<p>one</p>'),node=root.firstChild!;registerRenderedSourceRange(node,{from:0,to:3});
  const old=registerRenderedClipboardOpaque(node),current=registerRenderedClipboardOpaque(node);old();
  expect(mapRenderedClipboardRange(root,selected(node),'one')).toBeNull();current();
  expect(mapRenderedClipboardRange(root,selected(node),'one')).toEqual({from:0,to:3});
 });
 it('clears only the current registration and supports opaque teardown',()=>{
  const root=mount('<p>one</p>'),node=root.firstChild!;const dispose=registerRenderedSourceRange(node,{from:0,to:3});const clearOpaque=registerRenderedClipboardOpaque(node);
  expect(mapRenderedClipboardRange(root,selected(node),'one')).toBeNull();clearOpaque();expect(mapRenderedClipboardRange(root,selected(node),'one')).toEqual({from:0,to:3});dispose();
  expect(mapRenderedClipboardRange(root,selected(node),'one')).toBeNull();
 });
});
