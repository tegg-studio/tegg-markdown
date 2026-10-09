import {inlineBoundaryFormatting} from "./inlineSplit";
import {enterEmptyCalloutBody} from "./calloutInput";
import {ensureSyntaxTree,syntaxTree} from '@codemirror/language';
import {isolateHistory} from '@codemirror/commands';
import type {EditorView} from '@codemirror/view';
import type {SyntaxNode} from '@lezer/common';
import {resourceContext,displaySessionFor} from './editorHost';
import {calloutRanges} from './calloutEditing';

function tree(view:EditorView){return ensureSyntaxTree(view.state,view.state.doc.length,100)??syntaxTree(view.state);}
function ancestor(node:SyntaxNode|null,names:readonly string[]):SyntaxNode|null{for(;node;node=node.parent)if(names.includes(node.name))return node;return null;}
/** Put the caret in the nearest adjacent ordinary paragraph in this object's parent. */
export function exitSemanticObject(view:EditorView,range:{from:number;to:number},after:boolean):boolean {
  if(view.state.readOnly||view.composing)return false;
  let node=tree(view).resolve(range.from,1);
  while(node.parent&&!((node.to===range.to||node.to>range.to&&/^[ \t]*\n?$/.test(view.state.sliceDoc(range.to,node.to)))&&node.from>=range.from&&/^[ \t>]*$/.test(view.state.sliceDoc(range.from,node.from))))node=node.parent;
  const sibling=after?node.nextSibling:node.prevSibling;
  const callout=calloutRanges(view.state).some(item=>sibling&&item.headerFrom>=sibling.from&&item.headerFrom<=sibling.to);
  if(sibling?.name==='Paragraph'&&!callout){view.dispatch({selection:{anchor:after?sibling.from:sibling.to},scrollIntoView:true});view.focus();return true;}
  const doc=view.state.doc,first=doc.lineAt(range.from),prefix=doc.sliceString(first.from,range.from);
  const container=/^(?:[ \t]*>[ \t]?)*[ \t]*$/.test(prefix)?prefix:'';
  const insert=after?'\n'+container.trimEnd()+'\n'+container:container+'\n'+container.trimEnd()+'\n';
  const at=after?range.to:first.from;
  view.dispatch({changes:{from:at,insert},selection:{anchor:after?at+insert.length:at+container.length},annotations:isolateHistory.of('full'),userEvent:'input'});view.focus();return true;
}
/** Return creates a paragraph; a further explicit Return retains an empty paragraph. */
export function insertSemanticParagraph(view:EditorView):boolean {
  if(view.state.readOnly||view.composing||view.state.selection.ranges.length!==1)return false;
  const {from,to}=view.state.selection.main,line=view.state.doc.lineAt(from);
  const node=tree(view).resolveInner(from===line.from?Math.min(line.to,from+(line.text.match(/^[ \t]*/)?.[0].length??0)):from,from===line.from?1:-1);
  if(ancestor(node,['FencedCode','CodeBlock','Table','ListItem','Blockquote','HTMLBlock']))return false;
  if(!ancestor(node,['Paragraph','ATXHeading1','ATXHeading2','ATXHeading3','ATXHeading4','ATXHeading5','ATXHeading6'])&&line.text)return false;
  const formatting=inlineBoundaryFormatting(view,from);
  const insert=line.text===''?'<p><br></p>\n\n':from===line.from?'<p><br></p>\n\n':formatting.close+'\n\n'+formatting.open;
  view.dispatch({changes:{from,to,insert},selection:{anchor:from+insert.length},annotations:isolateHistory.of('full'),userEvent:'input'});return true;
}
/** Semantic quote paragraph routing, including complete paragraph outdent. */
export function editSemanticQuote(view:EditorView,enter:boolean):boolean {
  if(view.state.readOnly||view.composing||view.state.selection.ranges.length!==1||!view.state.selection.main.empty)return false;
  const head=view.state.selection.main.head,doc=view.state.doc,line=doc.lineAt(head),prefix=/^(?: {0,3}>[ \t]?)+/.exec(line.text)?.[0];
  if(!prefix)return false;
  const node=tree(view).resolveInner(head,head===line.from+prefix.length?1:-1);
  if(ancestor(node,['FencedCode','CodeBlock','ListItem','Table']))return false;
  const quote=ancestor(node,['Blockquote'])??ancestor(tree(view).resolveInner(line.from+1,1),['Blockquote']);if(!quote)return false;
  const paragraph=ancestor(node,['Paragraph']);
  const callout=calloutRanges(view.state).filter(item=>item.from<=head&&item.to>=head).at(-1);
  const marker=callout?doc.sliceString(callout.headerFrom,callout.headerTo).match(/^\[![\w-]+\][+-]?[ \t]*/)?.[0]??'':'';
  const titleFrom=callout?callout.headerFrom+marker.length:0;
  const bodyStart=callout&&callout.headerTo<doc.length?doc.lineAt(callout.headerTo+1):null;
  if(callout&&head>=titleFrom&&head<=callout.headerTo){
    if(!enter)return false;
    displaySessionFor(view).setExpanded('callout',callout.from,callout.to,true);
    const suffix=doc.sliceString(head,callout.headerTo),body=bodyStart&&bodyStart.number<=doc.lineAt(callout.to).number?bodyStart:null;
    if(!suffix&&body){const bodyPrefix=/^(?: {0,3}>[ \t]?)+/.exec(body.text)?.[0]??prefix;view.dispatch({selection:{anchor:body.from+bodyPrefix.length},scrollIntoView:true});return true;}
    if(!suffix&&!body){view.dispatch({effects:enterEmptyCalloutBody.of(callout.from)});return true;}
    const formatting=inlineBoundaryFormatting(view,head);
    const insert=formatting.close+'\n'+prefix+formatting.open+suffix+(suffix&&body?'\n'+prefix.trimEnd():'');
    view.dispatch({changes:{from:head,to:callout.headerTo,insert},selection:{anchor:head+formatting.close.length+1+prefix.length+formatting.open.length},annotations:isolateHistory.of('full'),userEvent:'input'});return true;
  }
  if(!enter&&callout&&bodyStart&&head===bodyStart.from+(/^(?: {0,3}>[ \t]?)+/.exec(bodyStart.text)?.[0].length??0)){
    view.dispatch({selection:{anchor:callout.headerTo},scrollIntoView:true});return true;
  }
  const contentFrom=line.from+prefix.length;
  if(!enter){
    if(!paragraph||head!==paragraph.from)return false;
    const first=doc.lineAt(paragraph.from),last=doc.lineAt(paragraph.to),changes=[];
    for(let n=first.number;n<=last.number;n++){const row=doc.line(n),marks=/^(?: {0,3}>[ \t]?)+/.exec(row.text)?.[0];if(!marks)return false;const at=marks.lastIndexOf('>');changes.push({from:row.from+at,to:row.from+marks.length,insert:''});}
    // Keep the moved paragraph separate from preceding/following quote paragraphs.
    const firstChange=changes[0];if(first.number>1&&doc.line(first.number-1).text.trim())firstChange.insert='\n';
    if(last.number<doc.lines&&/^[ \t]*>/.test(doc.line(last.number+1).text))changes.push({from:last.to,to:last.to,insert:'\n'});
    view.dispatch({changes,selection:{anchor:firstChange.from+firstChange.insert.length},annotations:isolateHistory.of('full'),userEvent:'delete'});return true;
  }
  const empty=line.text.slice(prefix.length)==='';
  if(empty&&line.to>=quote.to){const mark=prefix.lastIndexOf('>');view.dispatch({changes:{from:line.from+mark,to:contentFrom,insert:''},selection:{anchor:line.from+mark},annotations:isolateHistory.of('full'),userEvent:'input'});return true;}
  const formatting=inlineBoundaryFormatting(view,head);
  const insert=empty?'<p><br></p>\n'+prefix.trimEnd()+'\n'+prefix:formatting.close+'\n'+prefix.trimEnd()+'\n'+prefix+formatting.open;
  view.dispatch({changes:{from:head,insert},selection:{anchor:head+insert.length},annotations:isolateHistory.of('full'),userEvent:'input'});return true;
}
