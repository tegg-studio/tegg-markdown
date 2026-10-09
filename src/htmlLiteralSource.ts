// A pre subtree owns literal blank lines even when Lezer splits its outer HTML
// block there. Extend only an explicitly balanced container, never adjacent prose.
export function htmlLiteralContainerEnd(source:string,from:number) {
  const opening=/^\s*<([a-z][\w:-]*)(?:\s|>)/i.exec(source.slice(from));if(!opening)return null;
  const voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']),stack:string[]=[];
  let literal=false;
  for(const match of source.slice(from).matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][\w:-]*(?:[^<>"']|"[^"]*"|'[^']*')*>/gi)) {
    const tag=match[0];if(tag.startsWith('<!'))continue;const name=/^<\/?([\w:-]+)/.exec(tag)![1].toLowerCase();
    if(tag.startsWith('</')) {if(stack.pop()!==name)return null;if(!stack.length)return literal?from+match.index!+tag.length:null;}
    else {literal ||= name==='pre';if(!voids.has(name)&&!tag.endsWith('/>'))stack.push(name);else if(!stack.length)return null;}
  }
  return null;
}

