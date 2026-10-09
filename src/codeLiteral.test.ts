// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {parsedCodeBody} from './codeLiteral';
import {renderMarkdown} from './markdown';
afterEach(()=>document.body.replaceChildren());
it.each([
 ['first\nsecond\n','```','```','first\nsecond'],
 ['first\n\n','```','```','first\n'],
 ['first\n\n\n','~~~','  ~~~~','first\n\n'],
 ['first\n','```','>   ```','first'],
 ['first\n','```','first\n','first\n'],
 ['first\n','```','first','first'],
 ['first\n','','first\n','first'],
 ['first\n','```','``` extra\n','first\n'],
])('preserves literal code blanks while distinguishing the mapped delimiter: %j',(content,markup,last,expected)=>expect(parsedCodeBody(content,markup,last)).toBe(expected));
it.each([
 ['```text\nfirst\nsecond\n```','first\nsecond'],
 ['```text\nfirst\n\n```','first\n'],
 ['> ```text\n> first\n> \n> ```','first\n'],
 ['- ```text\n  first\n  \n  ```','first\n'],
 ['```text\nfirst\n','first\n'],
 ['```text\nfirst','first'],
 ['> ```text\n> first\n\nEnd','first'],
 ['    first\n    second\n','first\nsecond'],
 ['    first\n\n    second\n','first\n\nsecond'],
 ['<pre><code>first\n\n</code></pre>','first\n\n'],
])('renders the same literal field used for copying without trimming author content: %j',async(source,expected)=>{const root=document.body.appendChild(document.createElement('div'));await renderMarkdown(source,root);expect(root.querySelector('.md-render-code code')?.textContent).toBe(expected+(!source.startsWith('<pre')&&expected.endsWith('\n')?'\n':''));let copied:string|undefined;root.addEventListener('tegg-copy-text',event=>{copied=(event as CustomEvent<string>).detail;event.preventDefault();(event as CustomEvent<string>&{completion?:Promise<void>}).completion=Promise.resolve();});root.querySelector<HTMLButtonElement>('.md-code-copy')!.click();await Promise.resolve();expect(copied).toBe(expected);});
