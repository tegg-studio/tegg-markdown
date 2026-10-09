export type FootnoteReference={label:string;from:number;to:number;occurrence:number;number?:number};
export type FootnoteDefinition={key:string;label:string;value:string;from:number;to:number;number?:number;duplicate?:boolean;references:readonly FootnoteReference[]};
export type FootnoteDocument={definitions:FootnoteDefinition[];references:FootnoteReference[];missing:{label:string;references:FootnoteReference[]}[]};
type Range={from:number;to:number};
const within=(from:number,to:number,ranges:readonly Range[])=>ranges.some(range=>from>=range.from&&to<=range.to);
/** Derived display information never reorders or rewrites the Markdown source. */
export function footnoteDocument(source:string,excluded:readonly Range[]=[]):FootnoteDocument {
  const definitions:FootnoteDefinition[]=[],counts=new Map<string,number>();
  for(const match of source.matchAll(/^\[\^([^\]\n]+)\]:[ \t]*(.*)$/gm)){const from=match.index!;let to=from+match[0].length;if(within(from,to,excluded)&&!excluded.some(range=>range.from===from))continue;let value=match[2];const continuation=source.slice(to).match(/^(?:\n(?:[ \t]*\n)*(?: {4}|\t)[^\n]*)*/)?.[0]??'';to+=continuation.length;value+=continuation.replace(/^(?: {4}|\t)/gm,'');const occurrence=counts.get(match[1])??0;counts.set(match[1],occurrence+1);definitions.push({key:match[1]+':'+occurrence,label:match[1],value,from,to,references:[]});}
  const literal=[...excluded,...definitions];for(const match of source.matchAll(/(`+)(?!`)([\s\S]*?)\1(?!`)/g))literal.push({from:match.index!,to:match.index!+match[0].length});
  const references:FootnoteReference[]=[],numbers=new Map<string,number>(),occurrences=new Map<string,number>();
  for(const match of source.matchAll(/\[\^([^\]\n]+)\]/g)){const from=match.index!,to=from+match[0].length;if(within(from,to,literal))continue;let slashes=0;for(let at=from-1;at>=0&&source[at]==='\\';at--)slashes++;if(slashes%2)continue;const label=match[1],occurrence=(occurrences.get(label)??0)+1;occurrences.set(label,occurrence);if(definitions.some(note=>note.label===label)&&!numbers.has(label))numbers.set(label,numbers.size+1);references.push({label,from,to,occurrence,number:numbers.get(label)});}
  for(const note of definitions){note.number=numbers.get(note.label);note.duplicate=(counts.get(note.label)??0)>1;note.references=references.filter(ref=>ref.label===note.label);}
  const missing=[...new Set(references.filter(ref=>ref.number===undefined).map(ref=>ref.label))].map(label=>({label,references:references.filter(ref=>ref.label===label)}));
  return {definitions,references,missing};
}

/** Map a projected footnote body position back through its original header and indent bytes. */
export function footnoteBodyPosition(raw:string,position:number):number {const lines=raw.split('\n'),header=lines[0].match(/^\[\^[^\]\n]+\]:[ \t]*/)?.[0].length??0;let offset=0;for(let index=0;index<lines.length;index++){const prefix=index?lines[index].match(/^(?: {4}|\t)/)?.[0].length??0:header,length=lines[index].length-prefix;if(position<=length||index===lines.length-1)return offset+prefix+Math.min(position,length);position-=length+1;offset+=lines[index].length+1;}return raw.length;}
