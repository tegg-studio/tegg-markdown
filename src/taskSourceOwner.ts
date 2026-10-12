import type {EditorState} from '@codemirror/state';
import {parsedTaskMarkers,planTaskToggle,type TaskMarker} from './taskMarker';
import {detectNewlinePolicy} from './newlinePolicy';
import {SourcePatchError,type SourcePatch,type SourceRange} from './sourcePatch';

/** Parser-resolved own body only; descendant lists and other objects are excluded. */
export type TaskSourceOwner=Readonly<{marker:TaskMarker;itemRange:Readonly<SourceRange>;textRanges:readonly Readonly<SourceRange>[];selection:Readonly<SourceRange>}>;
const captures=new WeakMap<TaskSourceOwner,string>();
function validRange(source:string,range:SourceRange) {return Number.isSafeInteger(range.from)&&Number.isSafeInteger(range.to)&&range.from>=0&&range.to>range.from&&range.to<=source.length;}
/** Pure, side-effect free. This query is ownership evidence, not a writable permission grant. */
export function queryTaskSourceSelection(source:string,selection:SourceRange):TaskSourceOwner|null {
  if(!validRange(source,selection)||detectNewlinePolicy(source).readOnly)return null;
  const parsed=parsedTaskMarkers(source);
  for(const {marker,node} of parsed.markers){
    const task=node.parent,item=task?.parent;
    if(task?.name!=='Task'||item?.name!=='ListItem')continue;
    const itemRange=Object.freeze({from:parsed.position(item.from),to:parsed.position(item.to)});
    if(selection.from<itemRange.from||selection.to>itemRange.to)continue;
    const textRanges:Readonly<SourceRange>[]=[],blocked:SourceRange[]=[];
    for(let child=item.firstChild;child;child=child.nextSibling){
      if(child.name==='ListMark')continue;
      if(child===task||child.name==='Task'&&child.from===task.from||child.name==='Paragraph'){
        let from=parsed.position(child.name==='Task'?node.to:child.from),to=parsed.position(child.to);
        if(child.name==='Task')while(from<to&&/[ \t]/.test(source[from]))from++;
        if(to>from)textRanges.push(Object.freeze({from,to}));
      }else blocked.push({from:parsed.position(child.from),to:parsed.position(child.to)});
    }
    if(!textRanges.some(range=>selection.from>=range.from&&selection.from<range.to)||!textRanges.some(range=>selection.to>range.from&&selection.to<=range.to))continue;
    if(blocked.some(range=>selection.from<range.to&&selection.to>range.from))continue;
    const owner=Object.freeze({marker,itemRange,textRanges:Object.freeze(textRanges),selection:Object.freeze({...selection})});
    captures.set(owner,source);return owner;
  }
  return null;
}
/** The exact query capture is required; serialized/copied owners and any source drift fail closed. */
export function planTaskOwnerToggle(source:string,owner:TaskSourceOwner):SourcePatch {
  if(captures.get(owner)!==source)throw new SourcePatchError('Task owner no longer matches its captured source');
  return planTaskToggle(source,owner.marker);
}
function editorMapping(state:EditorState,source:string) {
  if(state.readOnly||state.selection.ranges.length!==1||detectNewlinePolicy(source).readOnly)return null;
  const positions=[0];let normalized='';
  for(let at=0;at<source.length;at++){if(source[at]==='\r'&&source[at+1]==='\n'){normalized+='\n';at++;}else normalized+=source[at];positions.push(at+1);}
  if(state.doc.toString()!==normalized)return null;
  return positions;
}
/** Raw-source coordinates from the current CM document/selection. No DOM, focus or scroll access. */
export function queryEditorTaskSelection(state:EditorState,source:string):TaskSourceOwner|null {
  const positions=editorMapping(state,source);if(!positions)return null;
  return queryTaskSourceSelection(source,{from:positions[state.selection.main.from],to:positions[state.selection.main.to]});
}
/** CM-coordinate patch, suitable for one dispatchSourcePatches(...,{isolateHistory:true}). */
export function planEditorTaskOwnerToggle(state:EditorState,source:string,owner:TaskSourceOwner):SourcePatch {
  const positions=editorMapping(state,source);
  if(!positions||positions[state.selection.main.from]!==owner.selection.from||positions[state.selection.main.to]!==owner.selection.to)throw new SourcePatchError('Task owner no longer matches the current editor selection');
  const patch=planTaskOwnerToggle(source,owner);
  const from=positions.indexOf(patch.from),to=positions.indexOf(patch.to);
  if(from<0||to<0)throw new SourcePatchError('Task marker cannot be mapped to the editor');
  return {...patch,from,to};
}
