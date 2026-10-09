import {ensureSyntaxTree, syntaxTree} from '@codemirror/language';
import {countColumn, type EditorState} from '@codemirror/state';
import type {EditorView} from '@codemirror/view';
import type {SyntaxNode} from '@lezer/common';
import {dispatchSourcePatches} from './editorPatches';

type Target = {from: number; to: number; prefix: string; item: SyntaxNode | null; indentWidth: number; quotePrefix: string};

function targets(state: EditorState, complete = false): Target[] {
  const {from,to} = state.selection.main;
  const first = state.doc.lineAt(from).number, last = state.doc.lineAt(Math.max(from,to-1)).number;
  const tree = ensureSyntaxTree(state,complete ? state.doc.length : to,50) ?? syntaxTree(state);
  const result = new Map<number,Target>();
  for (let number=first;number<=last;number++) {
    const line=state.doc.line(number);
    if (!line.text.trim() && first!==last) continue;
    let item: SyntaxNode|null=null, protectedBlock=false;
    for(let node: SyntaxNode|null=tree.resolveInner(line.to,-1);node;node=node.parent){
      if(['FencedCode','CodeBlock','HTMLBlock','Table'].includes(node.name)) protectedBlock=true;
      if(node.name==='ListItem'&&!item) item=node;
    }
    if(protectedBlock) continue;
    const mark=item?.getChild('ListMark');
    const row=mark?state.doc.lineAt(mark.from):line;
    const start=mark?.from ?? row.from+(row.text.match(/^[ \t]*(?:>[ \t]*)*/)?.[0].length??0);
    let end=mark?.to??start;
    while(/[ \t]/.test(state.sliceDoc(end,end+1))&&end<row.to)end++;
    const indentWidth=countColumn(state.sliceDoc(row.from,end),4)-countColumn(state.sliceDoc(row.from,start),4);
    const task=item?.getChild('Task')?.getChild('TaskMarker');
    if(task){end=task.to;while(/[ \t]/.test(state.sliceDoc(end,end+1))&&end<row.to)end++;}
    const before=state.sliceDoc(row.from,start);
    // Only quote containers outside this list belong in the continuation prefix.
    const quotePrefix=before.slice(0,before.lastIndexOf('>')+1);
    result.set(start,{from:start,to:end,prefix:state.sliceDoc(start,end),item,indentWidth,quotePrefix});
  }
  return [...result.values()];
}

export function selectedTasks(state: EditorState): boolean {
  const selected=targets(state);
  return selected.length>0 && selected.every(t=>/\[[ xX]\]/.test(t.prefix));
}

/** Change only structural prefixes; preserve blank lines, inline source, code,
 * and the nesting of descendants when a marker changes width. */
export function changeListType(view: EditorView, command: string) {
  if(view.composing||view.state.readOnly)return;
  const selected=targets(view.state,true);
  const removing=command==='task' && selected.length>0 && selected.every(t=>/\[[ xX]\]/.test(t.prefix));
  const changes: {from:number;to:number;insert:string}[]=[];
  const indents=new Map<number,{to:number;delta:number;raw:string}>();
  for(const target of selected){
    const insert=removing?'':command==='orderedList'?`${target.prefix.match(/^\d+[.)]/)?.[0]??'1.'} `:command==='task'?`- [${target.prefix.match(/\[([xX])\]/)?.[1]??' '}] `:'- ';
    changes.push({from:target.from,to:target.to,insert});
    if(!target.item)continue;
    const delta=(insert.match(/^(?:\d+[.)]|[-*+]) +/)?.[0].length??0)-target.indentWidth;
    if(!delta)continue;
    const first=view.state.doc.lineAt(target.from).number;
    const last=view.state.doc.lineAt(target.item.to).number;
    for(let n=first+1;n<=last;n++){
      const line=view.state.doc.line(n);
      if(!line.text.trim()||!line.text.startsWith(target.quotePrefix))continue;
      const from=line.from+target.quotePrefix.length;
      const raw=view.state.sliceDoc(from,line.to).match(/^[ \t]*/)?.[0]??'';
      const existing=indents.get(from);
      indents.set(from,{to:from+raw.length,raw,delta:(existing?.delta??0)+delta});
    }
  }
  for(const [from,{to,delta,raw}] of indents){
    if(delta)changes.push({from,to,insert:' '.repeat(Math.max(0,countColumn(raw,4)+delta))});
  }
  if(!changes.length)return;
  const patches=changes.filter(c=>view.state.sliceDoc(c.from,c.to)!==c.insert).map(c=>({...c,expected:view.state.sliceDoc(c.from,c.to)}));
  if(patches.length)dispatchSourcePatches(view,patches,{isolateHistory:true,scrollIntoView:true});
  view.focus();
}

/** Tab moves selected item subtrees by one semantic level, not a fixed number
 * of spaces (which fails below wide ordered markers). */
export function indentList(view: EditorView, outdent = false): boolean {
  if(view.composing||view.state.readOnly||view.state.selection.ranges.length!==1)return false;
  const selected=targets(view.state,true);
  if(!selected.length||selected.some(t=>!t.item))return false;
  const roots=selected.filter(t=>!selected.some(parent=>parent!==t && parent.item!.from<t.item!.from && parent.item!.to>=t.item!.to));
  const groups=new Map<number,number>();
  const changes:{from:number;to:number;insert:string}[]=[];
  for(const target of roots){
    const item=target.item!, list=item.parent!;
    const line=view.state.doc.lineAt(target.from);
    const column=countColumn(view.state.sliceDoc(line.from,target.from),4);
    let delta=groups.get(list.from);
    if(delta===undefined){
      let parent=outdent?list.parent:item.prevSibling;
      if(!outdent)while(parent?.name==='QuoteMark')parent=parent.prevSibling;
      const mark=parent?.name==='ListItem'?parent.getChild('ListMark'):null;
      if(!mark){groups.set(list.from,0);continue;}
      const row=view.state.doc.lineAt(mark.from);
      let to=mark.to;
      if(!outdent)while(/[ \t]/.test(view.state.sliceDoc(to,to+1))&&to<row.to)to++;
      delta=countColumn(view.state.sliceDoc(row.from,outdent?mark.from:to),4)-column;
      groups.set(list.from,delta);
    }
    if(!delta)continue;
    for(let n=line.number;n<=view.state.doc.lineAt(item.to).number;n++){
      const row=view.state.doc.line(n);
      if(!row.text.trim()||!row.text.startsWith(target.quotePrefix))continue;
      const from=row.from+target.quotePrefix.length;
      const raw=view.state.sliceDoc(from,row.to).match(/^[ \t]*/)?.[0]??'';
      changes.push({from,to:from+raw.length,insert:' '.repeat(Math.max(0,countColumn(raw,4)+delta))});
    }
  }
  if(changes.length)dispatchSourcePatches(view,changes.map(c=>({...c,expected:view.state.sliceDoc(c.from,c.to)})),{isolateHistory:true,scrollIntoView:true});
  return true;
}

/** Resolve a visible item boundary without treating code or HTML as list text. */
function boundary(state: EditorState, pos: number): Target | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  const line = state.doc.lineAt(pos);
  let item: SyntaxNode | null = null;
  for (let node: SyntaxNode | null = tree.resolveInner(line.to, -1); node; node = node.parent) {
    if (['FencedCode', 'CodeBlock', 'HTMLBlock', 'Table'].includes(node.name)) return null;
    if (node.name === 'ListItem') { item = node; break; }
  }
  const mark = item?.getChild('ListMark');
  if (!mark) return null;
  const row = state.doc.lineAt(mark.from);
  let to = item?.getChild('Task')?.getChild('TaskMarker')?.to ?? mark.to;
  while (to < row.to && /[ \t]/.test(state.sliceDoc(to, to + 1))) to++;
  let content = mark.to;
  while (content < row.to && /[ \t]/.test(state.sliceDoc(content, content + 1))) content++;
  const before = state.sliceDoc(row.from, mark.from);
  return {from: mark.from, to, prefix: state.sliceDoc(mark.from, to), item,
    quotePrefix: before.slice(0, before.lastIndexOf('>') + 1),
    indentWidth: countColumn(state.sliceDoc(row.from, content), 4) - countColumn(before, 4)};
}

function nested(target: Target) { return target.item?.parent?.parent?.name === 'ListItem'; }

function removeRootPrefix(view: EditorView, target: Target) {
  const {state} = view;
  const row = state.doc.lineAt(target.from);
  const changes: {from: number; to: number; insert: string; expected: string}[] = [];
  // A nonempty paragraph needs a blank separator to avoid lazy continuation of
  // the preceding list. Empty exits already supply that separator themselves.
  const before = state.sliceDoc(row.from, target.from);
  const separate = row.number > 1 && !!state.doc.line(row.number - 1).text.trim() && !!state.sliceDoc(target.to, row.to).trim();
  const insert = separate ? '\n' + before : '';
  changes.push({from: target.from, to: target.to, insert, expected: target.prefix});
  const width = countColumn(state.sliceDoc(row.from, target.to), 4) - countColumn(before, 4);
  const structuralWidth = /\[[ xX]\]/.test(target.prefix) ? target.indentWidth : width;
  for (let n = row.number + 1; n <= state.doc.lineAt(target.item!.to).number; n++) {
    const line = state.doc.line(n);
    if (!line.text.trim() || !line.text.startsWith(target.quotePrefix)) continue;
    const from = line.from + target.quotePrefix.length;
    const raw = state.sliceDoc(from, line.to).match(/^[ \t]*/)?.[0] ?? '';
    changes.push({from, to: from + raw.length, insert: ' '.repeat(Math.max(0, countColumn(raw, 4) - structuralWidth)), expected: raw});
  }
  dispatchSourcePatches(view, changes, {selection: {anchor: target.from + insert.length}, isolateHistory: true, scrollIntoView: true});
}

/** Enter and Backspace share the same empty/start boundary contract. */
export function editListBoundary(view: EditorView, enter: boolean): boolean {
  const {state} = view;
  if (view.composing || state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;
  const head = state.selection.main.head;
  const target = boundary(state, head);
  if (!target) return false;
  const row = state.doc.lineAt(target.from);
  const current = state.doc.lineAt(head);
  if (!enter && current.number !== row.number) return false;
  if (!enter && head > target.to) return false;
  if (!enter || (current.number === row.number && !state.sliceDoc(target.to, row.to).trim())) {
    if (nested(target)) return indentList(view, true);
    removeRootPrefix(view, target);
    return true;
  }
  const at = Math.max(head, current.number === row.number ? target.to : current.from);
  const before = state.sliceDoc(row.from, target.from);
  const mark = target.item!.getChild('ListMark')!;
  const rawMark = state.sliceDoc(mark.from, mark.to);
  const number = Number.parseInt(rawMark, 10);
  // Markdown source markers allow at most nine digits. Display numbering is independent.
  const next = Number.isFinite(number) && number < 999999999 ? String(number + 1) + rawMark.slice(-1) : rawMark;
  const prefix = before + next + (/\[[ xX]\]/.test(target.prefix) ? ' [ ] ' : ' ');
  const insert = '\n' + prefix;
  const changes = [{from: at, to: at, insert, expected: ''}];
  // Crossing 9/99/999 grows the container column; children follow the tail.
  const delta = next.length - rawMark.length;
  if (delta) for (let n = current.number + 1; n <= state.doc.lineAt(target.item!.to).number; n++) {
    const line = state.doc.line(n);
    if (!line.text.trim()) continue;
    const from = line.from + target.quotePrefix.length;
    const raw = state.sliceDoc(from, line.to).match(/^[ \t]*/)?.[0] ?? '';
    changes.push({from, to: from + raw.length, insert: ' '.repeat(countColumn(raw, 4) + delta), expected: raw});
  }
  dispatchSourcePatches(view, changes,
    {selection: {anchor: at + insert.length}, isolateHistory: true, scrollIntoView: true});
  return true;
}

/** Cross-item deletion retains the starting item's container and shifts the
 * surviving end item's descendants with it. Hidden prefixes are indivisible. */
export function deleteListSelection(view: EditorView): boolean {
  const {state} = view;
  if (view.composing || state.readOnly || state.selection.ranges.length !== 1 || state.selection.main.empty) return false;
  const {from, to} = state.selection.main;
  if (from === 0 && to === state.doc.length) return false;
  const start = boundary(state, from), end = boundary(state, to);
  if (!start || !end || start.from === end.from || state.doc.lineAt(from).number !== state.doc.lineAt(start.from).number || state.doc.lineAt(to).number !== state.doc.lineAt(end.from).number) return false;
  const a = Math.max(from, start.to), b = Math.max(to, end.to);
  const changes = [{from: a, to: b, insert: '', expected: state.sliceDoc(a, b)}];
  const endLine = state.doc.lineAt(end.from);
  const column = (target: Target) => {
    const line = state.doc.lineAt(target.from), mark = target.item!.getChild('ListMark')!;
    let content = mark.to;
    while (content < line.to && /[ \t]/.test(state.sliceDoc(content, content + 1))) content++;
    return countColumn(state.sliceDoc(line.from, content), 4);
  };
  const delta = column(start) - column(end);
  if (delta && start.quotePrefix === end.quotePrefix) {
    for (let n = endLine.number + 1; n <= state.doc.lineAt(end.item!.to).number; n++) {
      const line = state.doc.line(n);
      if (!line.text.trim()) continue;
      const pos = line.from + end.quotePrefix.length;
      const raw = state.sliceDoc(pos, line.to).match(/^[ \t]*/)?.[0] ?? '';
      changes.push({from: pos, to: pos + raw.length, insert: ' '.repeat(Math.max(0, countColumn(raw, 4) + delta)), expected: raw});
    }
  }
  dispatchSourcePatches(view, changes, {selection: {anchor: a}, isolateHistory: true, scrollIntoView: true, userEvent: "delete", preserveSelection: true});
  return true;
}


/** A soft continuation's indentation is structural too. Hard breaks are handled
 * first by deleteLiveBreak so their visible newline and source disappear together. */
export function deleteListContinuation(view: EditorView): boolean {
  const {state} = view;
  if (view.composing || state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;
  const head = state.selection.main.head, target = boundary(state, head);
  if (!target) return false;
  const line = state.doc.lineAt(head);
  if (line.number === state.doc.lineAt(target.from).number) return false;
  const before = state.sliceDoc(line.from, head);
  if (!before.startsWith(target.quotePrefix) || before.slice(target.quotePrefix.length).trim()) return false;
  const previous = state.doc.line(line.number - 1);
  if (!previous.text.trim() || /^\s*>\s*$/.test(previous.text)) return false;
  dispatchSourcePatches(view, [{from: previous.to, to: head, insert: '', expected: state.sliceDoc(previous.to, head)}],
    {selection: {anchor: previous.to}, isolateHistory: true, scrollIntoView: true, userEvent: "delete"});
  return true;
}
