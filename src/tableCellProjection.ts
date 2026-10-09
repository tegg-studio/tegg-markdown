import {Prec,type Range} from '@codemirror/state';
import {ensureSyntaxTree,syntaxTree} from '@codemirror/language';
import {deleteCharBackward,isolateHistory,selectAll} from '@codemirror/commands';
import {Decoration,EditorView,ViewPlugin,keymap,type DecorationSet,type ViewUpdate} from '@codemirror/view';
import {resourceContext} from './editorHost';
import {analyzeSource} from './sourceAnalysis';
import {inlineHtmlFormatting} from './inlineHtml';
import {scriptFormatting} from './scriptFormatting';
import {LiteralWidget,decodeEntity} from './literalEditing';

type Pair={from:number;contentFrom:number;contentTo:number;to:number};
const inlineClass:Record<string,string>={strong:'cm-live-strong',em:'cm-live-emphasis',del:'cm-live-strike',mark:'cm-live-highlight',u:'cm-live-u',sub:'cm-live-sub',sup:'cm-live-sup'};

/** A small projection whose hidden syntax is atomic for cursor motion. */
function project(view:EditorView):{decorations:DecorationSet;atomic:DecorationSet;pairs:Pair[]} {
  const ranges:Range<Decoration>[]=[],hidden:Range<Decoration>[]=[],pairs:Pair[]=[];
  const source=view.state.doc.toString(),profile=view.state.facet(resourceContext).profile??'tegg';
  const mark=(from:number,to:number,className:string)=>{if(from<to)ranges.push(Decoration.mark({class:className}).range(from,to));};
  const hide=(from:number,to:number)=>{if(from<to){const range=Decoration.replace({}).range(from,to);ranges.push(range);hidden.push(range);}};
  const pair=(range:Pair,className:string)=>{mark(range.contentFrom,range.contentTo,className);hide(range.from,range.contentFrom);hide(range.contentTo,range.to);pairs.push(range);};
  const excluded:{from:number;to:number}[]=[];
  const overlaps=(range:{from:number;to:number})=>excluded.some(item=>range.from<item.to&&range.to>item.from);
  const tree=ensureSyntaxTree(view.state,view.state.doc.length,40)??syntaxTree(view.state);
  tree.iterate({enter(node){
    const name=node.name;
    if(['InlineCode','FencedCode','CodeBlock','URL','LinkTitle','Escape'].includes(name))excluded.push({from:node.from,to:node.to});
    if(name==='StrongEmphasis'||name==='Emphasis'||name==='Strikethrough'||name==='InlineCode') {
      const className=name==='StrongEmphasis'?'cm-live-strong':name==='Emphasis'?'cm-live-emphasis':name==='Strikethrough'?'cm-live-strike':'cm-live-inline-code';
      mark(node.from,node.to,className);
      const first=node.node.firstChild,last=node.node.lastChild;
      if(first&&last&&first!==last)pairs.push({from:node.from,contentFrom:first.to,contentTo:last.from,to:node.to});
    } else if(name==='Entity'||name==='Escape') {
      const raw=source.slice(node.from,node.to);
      const range=Decoration.replace({widget:new LiteralWidget(name==='Entity'?decodeEntity(raw):raw.slice(1),name==='Escape')}).range(node.from,node.to);
      ranges.push(range);hidden.push(range);return false;
    } else if(name==='Link'||name==='Autolink') {
      mark(node.from,node.to,'cm-live-link');
      const raw=source.slice(node.from,node.to);
      if(name==='Link') {
        let closingMark=node.node.firstChild;
        while(closingMark&&!(closingMark.name==='LinkMark'&&source[closingMark.from]===']'))closingMark=closingMark.nextSibling;
        if(raw.startsWith('[')&&closingMark&&closingMark.from>node.from+1){
          hide(node.from,node.from+1);hide(closingMark.from,node.to);
          pairs.push({from:node.from,contentFrom:node.from+1,contentTo:closingMark.from,to:node.to});
        }
      } else if(raw.startsWith('<')&&raw.endsWith('>')){
        hide(node.from,node.from+1);hide(node.to-1,node.to);pairs.push({from:node.from,contentFrom:node.from+1,contentTo:node.to-1,to:node.to});
      }
    } else if(['EmphasisMark','StrikethroughMark','CodeMark'].includes(name))hide(node.from,node.to);
  }});
  if(profile==='tegg')for(const highlight of analyzeSource(view.state.doc,profile).highlights){
    if(!overlaps(highlight))pair(highlight,'cm-live-highlight');
  }
  for(const html of inlineHtmlFormatting(view.state).pairs){
    const className=inlineClass[html.tag];if(className&&!overlaps(html))pair(html,className);
  }
  if(profile==='tegg')for(const script of scriptFormatting(view.state)){
    if(!overlaps(script))pair(script,inlineClass[script.tag]);
  }
  return {decorations:Decoration.set(ranges,true),atomic:Decoration.set(hidden,true),pairs};
}

function backspaceBoundary(view:EditorView):boolean {
  if(view.state.readOnly||view.composing||!view.state.selection.main.empty)return false;
  const position=view.state.selection.main.head;
  const pairs=view.plugin(projection)?.pairs??[];
  const boundary=pairs.filter(item=>position===item.contentFrom||position===item.to)
    .sort((a,b)=>(a.to-a.from)-(b.to-b.from))[0];
  if(!boundary)return false;
  if(position===boundary.contentFrom||boundary.contentFrom===boundary.contentTo){
    const insert=view.state.sliceDoc(boundary.contentFrom,boundary.contentTo);
    view.dispatch({changes:{from:boundary.from,to:boundary.to,insert},selection:{anchor:boundary.from},
      userEvent:'delete.backward',annotations:isolateHistory.of('full')});
    return true;
  }
  view.dispatch({selection:{anchor:boundary.contentTo}});
  return deleteCharBackward(view);
}

function homeInVisibleCell(view:EditorView):boolean {
  const head=view.state.selection.main.head,line=view.state.doc.lineAt(head);
  const pairs=view.plugin(projection)?.pairs??[];
  let position=line.from,previous=-1;
  while(position!==previous){
    previous=position;
    for(const pair of pairs)if(pair.from===position&&pair.contentFrom>position)position=pair.contentFrom;
  }
  view.dispatch({selection:{anchor:position},scrollIntoView:true});
  return true;
}

const projection=ViewPlugin.fromClass(class {
  decorations:DecorationSet;atomic:DecorationSet;pairs:Pair[];
  constructor(view:EditorView){({decorations:this.decorations,atomic:this.atomic,pairs:this.pairs}=project(view));}
  update(update:ViewUpdate){if(update.docChanged||update.viewportChanged)({decorations:this.decorations,atomic:this.atomic,pairs:this.pairs}=project(update.view));}
},{decorations:plugin=>plugin.decorations,provide:plugin=>EditorView.atomicRanges.of(view=>view.plugin(plugin)?.atomic??Decoration.none)});

export const tableCellProjection=[projection,Prec.high(keymap.of([
  {key:'Mod-a',run:selectAll},
  {key:'Home',run:homeInVisibleCell},
  {key:'Backspace',run:backspaceBoundary},
]))];
