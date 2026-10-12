import type {SyntaxNode} from "@lezer/common";
import {parser, GFM} from "@lezer/markdown";
import {extractFrontmatter} from "./profile";
import {detectNewlinePolicy} from "./newlinePolicy";
import {applySourcePatches, SourcePatchError, type SourcePatch} from "./sourcePatch";

/** Raw-source UTF-16 ranges, including CRLF; never DOM/authored attributes. */
export type TaskMarker = Readonly<{from:number;to:number;expected:string;checked:boolean;bodyLine:number}>;
const taskParser=parser.configure(GFM);
export function parsedTaskMarkers(source:string):{markers:{marker:TaskMarker;node:SyntaxNode}[];position:(offset:number)=>number} {
  const {body}=extractFrontmatter(source),base=source.length-body.length;
  let normalized="",positions:number[]=[],lineStarts=[0];
  for(let at=0;at<body.length;at++) {positions.push(base+at);if(body[at]==="\r"&&body[at+1]==="\n"){normalized+="\n";at++;}else normalized+=body[at];if(normalized.at(-1)==="\n")lineStarts.push(normalized.length);}
  positions.push(source.length);
  const lineAt=(offset:number)=>{let low=0,high=lineStarts.length;while(low<high){const mid=(low+high)>>>1;if(lineStarts[mid]<=offset)low=mid+1;else high=mid;}return low-1;};
  const result:{marker:TaskMarker;node:SyntaxNode}[]=[];
  taskParser.parse(normalized).iterate({enter(node){
    if(node.name!=="TaskMarker"||node.node.parent?.name!=="Task")return;
    const from=positions[node.from],to=positions[node.to],expected=source.slice(from,to);
    if(!/^\[[ xX]\]$/.test(expected))return;
    result.push({marker:Object.freeze({from,to,expected,checked:expected!=="[ ]",bodyLine:lineAt(node.from)}),node:node.node});
  }});
  return {markers:result,position:offset=>positions[offset]};
}
export function resolveTaskMarkers(source:string):TaskMarker[] {return parsedTaskMarkers(source).markers.map(item=>item.marker);}
/** One ASCII character only. Host applies this through its single undo/save transaction. */
export function planTaskToggle(source:string,target:Pick<TaskMarker,"from"|"to"|"expected">):SourcePatch {
  if(detectNewlinePolicy(source).readOnly)throw new SourcePatchError("Task toggling is unavailable for this newline policy");
  const marker=resolveTaskMarkers(source).find(item=>item.from===target.from&&item.to===target.to&&item.expected===target.expected);
  if(!marker)throw new SourcePatchError("Task marker no longer matches its parsed source");
  return {from:marker.from+1,to:marker.from+2,expected:marker.expected[1],insert:marker.checked?" ":"x"};
}
export function toggleTaskSource(source:string,target:Pick<TaskMarker,"from"|"to"|"expected">):string {
  return applySourcePatches(source,[planTaskToggle(source,target)]);
}
