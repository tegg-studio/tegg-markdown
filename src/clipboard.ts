import {htmlToMarkdown, imageMarkdown, markdownDestination, markdownLabel, type PasteIssue} from './htmlToMarkdown';
import {parseDelimitedData, tableEditingLimits} from './tableEditing';
import {serializeMarkdownTable} from './table';

export type ClipboardFile = Readonly<{id: string; name: string; type: string; size: number; blob?: Blob; handle?: unknown}>;
export type ClipboardInput = Readonly<{
  text?: string; markdown?: string; html?: string; files?: readonly ClipboardFile[];
  cells?: readonly (readonly string[])[]; delimiter?: '\t' | ',';
}>;
export type PasteResource = ClipboardFile & {token: string; kind: 'image' | 'attachment'; alt: string; title?: string; source?: string};
export type PasteContext = {target?: 'document' | 'code' | 'table-cell'; plainText?: boolean; acceptSimplification?: boolean};
export type PastePreparation = {
  status: 'ready' | 'needs-review' | 'rejected'; original: ClipboardInput; markdown: string; plainText: string;
  cells?: string[][]; resources: PasteResource[]; issues: PasteIssue[];
};
export type ClipboardDataLike = {getData(type: string): string; readonly types?: readonly string[]; readonly files?: ArrayLike<File>; readonly items?: ArrayLike<{kind:string;getAsFile():File|null}>};
/** Capture synchronously in the paste/drop event, before awaiting a picker or storage. */
export function captureClipboard(data: ClipboardDataLike): ClipboardInput {
  const get=(type:string)=>{try{return data.getData(type);}catch{return '';}};
  const nativeFiles=Array.from(data.files??[]);
  if(!nativeFiles.length)for(const item of Array.from(data.items??[])){if(item.kind==='file'){const file=item.getAsFile();if(file)nativeFiles.push(file);}}
  const seen=new Set<File>();
  const files=nativeFiles.filter(file=>!seen.has(file)&&!!seen.add(file)).map((file,index)=>Object.freeze({id:'file-'+index,name:file.name,type:file.type,size:file.size,blob:file}));
  const types=Array.from(data.types??[]);
  const markdown=get('text/markdown')||get('text/x-markdown');
  const delimiter=types.includes('text/tab-separated-values')?'\t' as const:types.includes('text/csv')?',' as const:undefined;
  const text=delimiter==='\t'?get('text/tab-separated-values'):delimiter===','?get('text/csv'):get('text/plain');
  const html=get('text/html');
  return Object.freeze({...(text||types.includes('text/plain')||delimiter?{text}:{}),...(markdown?{markdown}:{}),...(html?{html}:{}),files:Object.freeze(files),...(delimiter?{delimiter}:{})});
}
function snapshotInput(input: ClipboardInput): ClipboardInput {
  return Object.freeze({...input,files:input.files?Object.freeze(input.files.map(file=>Object.freeze({...file}))):undefined,cells:input.cells?Object.freeze(input.cells.map(row=>Object.freeze([...row]))):undefined});
}
function resource(file: ClipboardFile, alt=file.name, title?:string, source?:string): PasteResource {
  return {...file,token:'tegg-paste-resource-'+crypto.randomUUID(),kind:file.type.startsWith('image/')?'image':'attachment',alt,title,source};
}
function safeCells(cells: readonly (readonly string[])[]) {
  if(!cells.length || !cells.some(row=>row.length))throw new Error('There are no cells to paste.');
  if(cells.length>tableEditingLimits.rows)throw new Error('The pasted table exceeds the table budget.');
  const width=cells.reduce((max,row)=>Math.max(max,row.length),0);
  if(cells.length>tableEditingLimits.rows||width>tableEditingLimits.columns||cells.length*width>tableEditingLimits.cells)throw new Error('The pasted table exceeds the table budget.');
  if(cells.some(row=>row.some(value=>typeof value!=='string')))throw new Error('Every pasted cell must be text.');
  if(cells.reduce((sum,row)=>sum+row.reduce((length,value)=>length+value.length,0),0)>tableEditingLimits.inputLength)throw new Error('The pasted table text exceeds the input budget.');
  return cells.map(row=>Array.from({length:width},(_,index)=>row[index]??''));
}
function plainFallback(input: ClipboardInput, htmlText?:string) {return input.text??input.markdown??htmlText??input.files?.map(file=>file.name).join('\n')??'';}
/** No network or file I/O. Resource preparation and target validation belong to the controller/Host. */
export function preparePaste(input: ClipboardInput, context: PasteContext = {}): PastePreparation {
  const original=snapshotInput(input),issues:PasteIssue[]=[],resources:PasteResource[]=[];
  let markdown='',plainText=plainFallback(original),cells:string[][]|undefined;
  const result=(status:PastePreparation['status']):PastePreparation=>({status,original,markdown,plainText,cells,resources,issues});
  const total=(input.text?.length??0)+(input.markdown?.length??0)+(input.html?.length??0);
  if(total>4*tableEditingLimits.inputLength){issues.push({code:'input-budget',message:'The paste exceeds the conversion budget. The original input is retained.',requiresReview:true});return result('rejected');}
  const ids=new Set<string>();
  for(const file of original.files??[]){
    if(!file.id||ids.has(file.id)||!Number.isFinite(file.size)||file.size<0){issues.push({code:'invalid-files',message:'The resource identities are invalid. Select the files again.',requiresReview:true});return result('rejected');}ids.add(file.id);
  }
  if(context.plainText||context.target==='code'){
    if(original.text===undefined&&original.markdown===undefined&&original.html)plainText=htmlToMarkdown(original.html).plainText;
    markdown=plainText;return result('ready');
  }
  const used=new Set<string>();
  if(original.markdown!==undefined)markdown=original.markdown;
  else if(original.cells||original.delimiter||(original.text?.includes('\t')&&!original.html)) {
    try{cells=safeCells(original.cells??parseDelimitedData(original.text??'',original.delimiter??'\t'));}
    catch(error){issues.push({code:'invalid-table-input',message:(error as Error).message,requiresReview:true});return result('rejected');}
  } else if(original.html){
    const converted=htmlToMarkdown(original.html);markdown=converted.markdown;plainText=plainFallback(original,converted.plainText);issues.push(...converted.issues.filter(issue=>context.target!=='table-cell'||issue.code!=='table-header'));
    if(converted.cells)try{cells=safeCells(converted.cells);}catch(error){issues.push({code:'table-budget',message:(error as Error).message,requiresReview:true});}
    const replaceImage=(token:string,value:string)=>{markdown=markdown.replaceAll(token,value);if(cells)cells=cells.map(row=>row.map(cell=>cell.replaceAll(token,value)));};
    for(const image of converted.images){
      let filename='';try{filename=decodeURIComponent(image.source.split(/[?#]/)[0].split('/').at(-1)??'');}catch{ /* retain raw source */ }
      const matches=(original.files??[]).filter(file=>file.name===filename);
      if(matches.length===1){
        const file=matches[0];
        const existing=resources.find(entry=>entry.id===file.id);
        if(existing && existing.alt===image.alt && existing.title===image.title){replaceImage(image.token,existing.token);continue;}
        const entry=resource({...file,id:existing?file.id+'-use-'+crypto.randomUUID():file.id},image.alt,image.title,image.source);entry.token=image.token;entry.kind='image';resources.push(entry);used.add(file.id);continue;
      }
      if(/^(?:https?:|\/\/)/i.test(image.source)||(!/^[\w+.-]+:/.test(image.source)&&!image.source.startsWith('#'))){
        try{replaceImage(image.token,imageMarkdown(image.source,image.alt,image.title));}
        catch{replaceImage(image.token,markdownLabel(image.alt));issues.push({code:'unsafe-image',message:'An unsupported image reference was retained as text.',requiresReview:true});}
        continue;
      }
      if(/^(?:javascript|vbscript):/i.test(image.source)){replaceImage(image.token,markdownLabel(image.alt));issues.push({code:'unsafe-image',message:'An unsupported image reference was retained as text.',requiresReview:true});continue;}
      const data=/^data:(image\/(?:png|jpeg|gif|webp|avif));base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(image.source);
      if(data){
        try{
          const binary=atob(data[2].replace(/[\r\n]/g,'')),blob=new Blob([Uint8Array.from(binary,char=>char.charCodeAt(0))],{type:data[1]});
          const entry=resource({id:image.id,name:'pasted-image.'+data[1].split('/')[1],type:data[1],size:blob.size,blob},image.alt,image.title);entry.token=image.token;resources.push(entry);
          if(original.files?.length)issues.push({code:'ambiguous-image-files',message:'HTML images and clipboard files could not be matched. Review both before inserting.',requiresReview:true});
        }catch{replaceImage(image.token,markdownLabel(image.alt));issues.push({code:'invalid-image-data',message:'Invalid inline image data was retained as alternative text.',requiresReview:true});}
      }else{
        const entry=resource({id:image.id,name:filename||'pasted-image',type:'image/unknown',size:0,handle:{source:image.source}},image.alt,image.title,image.source);entry.token=image.token;resources.push(entry);
        issues.push({code:'image-needs-host',message:'A local or temporary image needs the Host to provide a persistent attachment.',requiresReview:true});
      }
    }
  }else markdown=original.text??'';
  if(cells){
    if(cells.some(row=>row.some(value=>/[\r\n]/.test(value))))issues.push({code:'multiline-cells',message:'Multiple lines in table cells are simplified to spaces.',requiresReview:true});
    const simple=cells.map(row=>row.map(value=>value.replace(/[\r\n]+/g,' ')));
    if(context.acceptSimplification)cells=simple;
    if(context.target==='table-cell')markdown='';
    else markdown=serializeMarkdownTable({headers:simple[0],rows:simple.slice(1),alignments:simple[0].map(()=>null)});
  }
  for(const file of original.files??[]){if(used.has(file.id))continue;const entry=resource(file);resources.push(entry);markdown+=(markdown?'\n\n':'')+entry.token;}
  return result(issues.some(issue=>issue.requiresReview)&&!context.acceptSimplification?'needs-review':'ready');
}
/** Resolve every resource before producing text suitable for a source patch. Missing refs fail atomically. */
export function renderPreparedPaste(prepared: PastePreparation, references: Readonly<Record<string,string>> = {}): string {
  if(prepared.status!=='ready')throw new Error('Review this paste before applying it.');
  let markdown=prepared.markdown;
  for(const entry of prepared.resources){
    const reference=references[entry.id];
    if(!reference||/^(?:blob|data):/i.test(reference))throw new Error('Every pasted resource needs a persistent reference.');
    const value=entry.kind==='image'?imageMarkdown(reference,entry.alt,entry.title):'['+markdownLabel(entry.alt)+']('+markdownDestination(reference)+')';
    markdown=markdown.replaceAll(entry.token,value);
  }
  return markdown;
}

/** The table controller consumes resolved cells instead of inserting a second Markdown table. */
export function renderPreparedPasteCells(prepared: PastePreparation, references: Readonly<Record<string,string>> = {}): string[][] | undefined {
  if(!prepared.cells)return undefined;
  return prepared.cells.map(row=>row.map(value=>renderPreparedPaste({...prepared,markdown:value},references)));
}
