/** All required representations form one acknowledged clipboard transaction. */
export type SemanticClipboardData={text:string;html:string;structured:string};
export type SemanticClipboardRead={text:string;html?:string;structured?:string};
export type SemanticClipboardKind='content'|'table';
export const contentClipboardType='application/x-tegg-content+json';
export const tableClipboardType='application/x-tegg-table+json';
export function clipboardMime(kind:SemanticClipboardKind){return kind==='table'?tableClipboardType:contentClipboardType;}
export async function writeSemanticClipboard(trigger:HTMLElement,data:SemanticClipboardData,kind:SemanticClipboardKind='content',eventData?:Pick<DataTransfer,'setData'>){
 let complete!:(success:boolean,error?:string)=>void;const acknowledged=new Promise<void>((resolve,reject)=>{complete=(success,error)=>success?resolve():reject(new Error(error??'Copy failed. The original content is retained.'));});
 const mime=clipboardMime(kind),request=new CustomEvent('tegg-copy-'+kind,{bubbles:true,cancelable:true,detail:{...data,mime,complete}});
 if(!trigger.dispatchEvent(request)){await acknowledged;return;}
 if(eventData){eventData.setData('text/plain',data.text);eventData.setData('text/html',data.html);eventData.setData(mime,data.structured);return;}
 const custom='web '+mime;
 if(typeof ClipboardItem==='undefined'||!ClipboardItem.supports?.(custom)||!navigator.clipboard?.write)throw new Error('This clipboard cannot preserve all content representations. The original content is retained.');
 await navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob([data.text],{type:'text/plain'}),'text/html':new Blob([data.html],{type:'text/html'}),[custom]:new Blob([data.structured],{type:mime})})]);
}
/** A native request is asynchronous; the event fallback remains synchronous when no Host claims it. */
export function requestSemanticClipboardRead(trigger:HTMLElement,kind:SemanticClipboardKind='content',fallback?:SemanticClipboardRead):SemanticClipboardRead|Promise<SemanticClipboardRead>{
 let complete!:(data?:SemanticClipboardRead,error?:string)=>void;const acknowledged=new Promise<SemanticClipboardRead>((resolve,reject)=>{complete=(data,error)=>data?resolve(data):reject(new Error(error??'Paste unavailable. The original input is retained.'));});
 const request=new CustomEvent('tegg-read-'+kind,{bubbles:true,cancelable:true,detail:{mime:clipboardMime(kind),complete}});if(!trigger.dispatchEvent(request))return acknowledged;
 if(fallback)return fallback;
 return readBrowserClipboard(kind);
}
async function readBrowserClipboard(kind:SemanticClipboardKind):Promise<SemanticClipboardRead>{
 if(!navigator.clipboard?.read)throw new Error('Paste unavailable. The original input is retained.');
 const items=await navigator.clipboard.read(),data:SemanticClipboardRead={text:''},mime=clipboardMime(kind);
 for(const item of items)for(const type of item.types){if(type==='text/plain')data.text=await(await item.getType(type)).text();else if(type==='text/html')data.html=await(await item.getType(type)).text();else if(type===mime||type==='web '+mime)data.structured=await(await item.getType(type)).text();}
 return data;
}
export function readSemanticClipboard(trigger:HTMLElement,kind:SemanticClipboardKind='content',fallback?:SemanticClipboardRead):Promise<SemanticClipboardRead>{return Promise.resolve(requestSemanticClipboardRead(trigger,kind,fallback));}
