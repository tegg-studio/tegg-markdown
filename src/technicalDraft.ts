import {readCode,writeCode} from "./codeEditing";
import type {ObjectKind} from "./editingController";

export type TechnicalDraft = {body:string; label:string; serialize:(body:string)=>string};
/** A conservative projection: unsupported or incomplete wrappers stay editable as source. */
export function technicalDraft(kind:ObjectKind,source:string):TechnicalDraft|null {
  if(kind==="math"){
    const delimiter=source.startsWith("$$")?"$$":source.startsWith("$")?"$":null;
    if(!delimiter||!source.endsWith(delimiter)||source.length<delimiter.length*2)return null;
    const inner=source.slice(delimiter.length,-delimiter.length);
    const block=delimiter==="$$"&&inner.startsWith("\n")&&inner.endsWith("\n");
    const body=block?inner.slice(1,-1):inner;
    return {body,label:"Formula source",serialize:next=>next===body?source:delimiter+(block?"\n":"")+next+(block?"\n":"")+delimiter};
  }
  if(!["code","mermaid","graphviz"].includes(kind))return null;
  const code=readCode(source);
  if(!code.opening||!code.closed)return null;
  return {body:code.body,label:kind==="code"?"Code content":"Diagram source",serialize:body=>body===code.body?source:writeCode(source,body)};
}
