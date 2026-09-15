// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {createMarkdownParser} from './markdownParser';

describe('literal image alternative text',()=>{
  it.each(['gfm','github','tegg'] as const)('preserves escaped punctuation and entities in the %s parser',profile=>{
    const parser=createMarkdownParser(profile),node=document.createElement('template');
    node.innerHTML=parser.render(String.raw`![\*literal\* &amp;copy; \[label\] \<tag\>](assets/a.png)`);
    expect(node.content.querySelector('img')?.getAttribute('alt')).toBe('*literal* &copy; [label] <tag>');
  });
});
