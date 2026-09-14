// @vitest-environment jsdom
import {describe,it,expect,vi} from 'vitest';
import {captureClipboard,preparePaste,renderPreparedPaste,renderPreparedPasteCells} from './clipboard';
import {htmlToMarkdown,imageMarkdown,markdownTitle} from './htmlToMarkdown';
import {markdownParser} from './markdownParser';

describe('source-first paste decisions',()=>{
  it('copies event data before asynchronous work and keeps explicit Markdown',()=>{
    const values:Record<string,string>={'text/plain':'label','text/markdown':'[label](target.md)\r\n','text/html':'<b>label</b>'};
    const input=captureClipboard({getData:type=>values[type]??'',files:[]});
    Object.keys(values).forEach(key=>delete values[key]);
    expect(preparePaste(input).markdown).toBe('[label](target.md)\r\n');
    expect(Object.isFrozen(input)).toBe(true);
  });
  it('pastes literal text into code and for the explicit plain action',()=>{
    const input={text:'**literal**\n| A |',html:'<b>literal</b>',files:[{id:'file',name:'image.png',type:'image/png',size:2}]};
    expect(preparePaste(input,{target:'code'})).toMatchObject({status:'ready',markdown:input.text,resources:[]});
    expect(preparePaste(input,{plainText:true}).markdown).toBe(input.text);
  });
  it('converts common HTML without mounting or executing its content',()=>{
    const before=document.body.innerHTML;
    const converted=htmlToMarkdown('<h2>Title</h2><p><strong>Bold</strong> and <a href="docs/a b.md">link</a></p><ul><li>one</li><li>two</li></ul><pre><code class="language-js">a &lt; b\n```</code></pre><script>window.bad=1</script>');
    expect(converted.markdown).toContain('## Title');expect(converted.markdown).toContain('**Bold** and [link](<docs/a%20b.md>)');expect(converted.markdown).toContain('- one\n- two');expect(converted.markdown).toContain('````js\na < b\n```\n````');
    expect(converted.markdown).not.toContain('window.bad');expect(document.body.innerHTML).toBe(before);expect((window as any).bad).toBeUndefined();
  });
  it('preserves unsafe link labels without executable schemes',()=>{
    expect(htmlToMarkdown('<a href="javascript:alert(1)">Keep this</a>').markdown).toBe('Keep this');
  });
  it('requires a review for complex tables and retains every source cell',()=>{
    const input={html:'<table><tr><th colspan="2">Combined</th></tr><tr><td>first</td><td>second</td></tr></table>'};
    const pending=preparePaste(input);expect(pending.status).toBe('needs-review');expect(pending.original.html).toBe(input.html);expect(pending.markdown).toContain('second');
    const accepted=preparePaste(input,{acceptSimplification:true});expect(accepted.status).toBe('ready');expect(renderPreparedPaste(accepted)).toContain('Combined');
  });
  it('does not guess CSV from prose but honors explicit CSV and TSV',()=>{
    expect(preparePaste({text:'Hello, world'}).cells).toBeUndefined();
    expect(preparePaste({text:'A,B\n"C,D",E',delimiter:','}).cells).toEqual([['A','B'],['C,D','E']]);
    expect(preparePaste({text:'A\tB\nC\tD'},{target:'table-cell'})).toMatchObject({markdown:'',cells:[['A','B'],['C','D']]});
  });
  it('holds a resource batch until all persistent references exist',()=>{
    const prepared=preparePaste({text:'Photos',files:[{id:'one',name:'a.png',type:'image/png',size:2},{id:'two',name:'a.pdf',type:'application/pdf',size:2}]});
    expect(()=>renderPreparedPaste(prepared,{one:'assets/a.png'})).toThrow('persistent');
    expect(()=>renderPreparedPaste(prepared,{one:'blob:temp',two:'assets/a.pdf'})).toThrow('persistent');
    expect(renderPreparedPaste(prepared,{one:'assets/a.png',two:'assets/a.pdf'})).toBe('Photos\n\n![a.png](<assets/a.png>)\n\n[a.pdf](<assets/a.pdf>)');
  });
  it('associates a uniquely named HTML image and file without duplicate insertion',()=>{
    const prepared=preparePaste({html:'<p>Photo</p><img src="file:///tmp/a.png" alt="cat">',files:[{id:'one',name:'a.png',type:'image/png',size:3}]});
    expect(prepared.resources).toHaveLength(1);expect(renderPreparedPaste(prepared,{one:'assets/cat.png'}).match(/!\[/g)).toHaveLength(1);
    expect(renderPreparedPaste(prepared,{one:'assets/cat.png'})).toContain('![cat](<assets/cat.png>)');
  });
  it('keeps remote references without fetching them',()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    const prepared=preparePaste({html:'<img src="https://example.test/a.png" alt="a">'});
    expect(renderPreparedPaste(prepared)).toBe('![a](<https://example.test/a.png>)');expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();
  });
  it('requires review for multiline cells and preserves original values',()=>{
    const input={cells:[['header'],['line one\nline two']]};
    expect(preparePaste(input,{target:'table-cell'})).toMatchObject({status:'needs-review',cells:input.cells});
    expect(preparePaste(input,{target:'table-cell',acceptSimplification:true}).cells).toEqual([['header'],['line one line two']]);
  });
  it('retains inline formatting and resolves images when pasting HTML cells',()=>{
    const prepared=preparePaste({html:'<table><tr><th>A</th></tr><tr><td><b>bold</b> <img src="file:///a.png" alt="cat"></td></tr></table>',files:[{id:'image',name:'a.png',type:'image/png',size:1}]},{target:'table-cell'});
    expect(prepared.status).toBe('ready');expect(renderPreparedPasteCells(prepared,{image:'assets/cat.png'})).toEqual([['A'],['**bold** ![cat](<assets/cat.png>)']]);
  });
  it('captures HTML-only clipboard data without inventing an empty plain representation',()=>{
    const input=captureClipboard({types:['text/html'],getData:type=>type==='text/html'?'<p>text</p>':''});
    expect(preparePaste(input,{plainText:true}).markdown).toBe('text');
  });
  it('preserves title entities, line breaks and destination backslashes through Markdown parsing',()=>{
    const title='quoted " &copy; \n\t'+String.fromCharCode(92);
    const markup=imageMarkdown(String.raw`a\b&name; .png`,'alt',title);
    const node=document.createElement('template');node.innerHTML=markdownParser.render(markup);
    expect(node.content.querySelector('img')?.getAttribute('title')).toBe(title);
    expect(node.content.querySelector('img')?.getAttribute('src')).toBe('a%5Cb&name;%20.png');
    expect(markdownTitle('line\nnext')).toBe('"line&#10;next"');
  });
  it('resolves remote and repeated local image tokens in table cell matrices',()=>{
    const remote=preparePaste({html:'<table><tr><td><img src="https://example.test/a.png" alt="remote"></td></tr></table>'},{target:'table-cell'});
    expect(remote.status).toBe('ready');expect(renderPreparedPasteCells(remote)).toEqual([['![remote](<https://example.test/a.png>)']]);
    const local=preparePaste({html:'<table><tr><th><img src="file:///a.png" alt="same"></th><th><img src="file:///a.png" alt="same"></th></tr></table>',files:[{id:'image',name:'a.png',type:'image/png',size:1}]});
    expect(local.resources).toHaveLength(1);expect(renderPreparedPaste(local,{image:'assets/a.png'})).toBe('| ![same](<assets/a.png>) | ![same](<assets/a.png>) |\n| --- | --- |');
  });
  it('handles deeply nested HTML with an iterative retained-text fallback',()=>{
    const html='<div>'.repeat(150)+'retained'+'</div>'.repeat(150);
    const result=htmlToMarkdown(html);expect(result.plainText).toBe('retained');expect(result.markdown).toBe('retained');expect(result.issues.some(issue=>issue.code==='html-budget')).toBe(true);
  });
  it('bounds explicit cell text and overwide HTML tables before table serialization',()=>{
    expect(preparePaste({cells:[['x'.repeat(1_048_577)]]}).status).toBe('rejected');
    const html='<table><tr>'+'<td>x</td>'.repeat(101)+'</tr></table>';const result=htmlToMarkdown(html);
    expect(result.cells).toBeUndefined();expect(result.markdown).toContain('x');expect(result.issues.some(issue=>issue.code==='html-budget')).toBe(true);
  });
  it('preserves plain alternative text and HTML text that resembles Markdown or entities',()=>{
    const alt='**stars** `code` ~~strike~~ &copy; <tag> [link] ==mark== $x$ a^b^ :smile:';
    const node=document.createElement('template');node.innerHTML=markdownParser.render(imageMarkdown('assets/a.png',alt));
    expect(node.content.querySelector('img')?.getAttribute('alt')).toBe(alt);
    node.innerHTML=markdownParser.render(htmlToMarkdown('<p>&amp;copy; ~~plain~~</p>').markdown);
    expect(node.content.textContent?.trim()).toBe('&copy; ~~plain~~');
  });
  it('converts checkbox list HTML into Markdown task items',()=>{
    const result=preparePaste({html:'<ul><li><input type="checkbox" checked disabled> Done</li><li><input type="checkbox" disabled> Todo</li></ul>'});
    expect(result.status).toBe('ready');expect(result.markdown).toBe('- [x]  Done\n- [ ]  Todo');
  });
  it('never commits an unreviewed paste or duplicate resource identity',()=>{
    expect(()=>renderPreparedPaste(preparePaste({html:'<div style="display:grid">content</div>'}))).toThrow('Review');
    expect(preparePaste({files:[{id:'a',name:'one',type:'',size:0},{id:'a',name:'two',type:'',size:0}]}).status).toBe('rejected');
  });
});
