/** Markdown-it adds a terminal LF to literal code tokens. A closed fence's
 * separator and an indented block's parser terminator are outside the field;
 * unclosed code retains an actual terminal LF at the end of its document. */
export function parsedCodeBody(content:string,markup:string,lastSourceLine:string,atSourceEnd=true):string {
  if(!content.endsWith('\n'))return content;
  if(!markup)return content.slice(0,-1);
  if(!/^(?:`{3,}|~{3,})$/.test(markup))return content;
  const close=new RegExp('^(?:[ \\t]*>[ \\t]?)*[ \\t]*'+markup[0]+'{'+markup.length+',}[ \\t]*$');
  if(close.test(lastSourceLine.replace(/[\r\n]+$/,''))||!atSourceEnd||!lastSourceLine.endsWith('\n'))return content.slice(0,-1);
  return content;
}
