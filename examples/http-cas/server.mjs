import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
/** In-memory demonstration only. The comparison and write form one synchronous critical section. */
export function createDocumentServer() {
 let document={revision:'0',source:'# Shared document\n'};
 return createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url!=='/documents/example'){res.writeHead(404);res.end('{}');return;}
  if(req.method==='GET'){res.end(JSON.stringify(document));return;}
  if(req.method!=='PUT'){res.writeHead(405);res.end('{}');return;}
  try{
   const chunks=[];let bytes=0;
   for await(const chunk of req){bytes+=chunk.length;if(bytes>2*1024*1024){res.writeHead(413);res.end('{}');return;}chunks.push(chunk);}
   const update=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(typeof update.source!=='string'||typeof update.baseRevision!=='string'){res.writeHead(400);res.end('{}');return;}
   if(update.baseRevision!==document.revision){res.writeHead(409);res.end(JSON.stringify({error:'revision_conflict',revision:document.revision}));return;}
   document={revision:String(Number(document.revision)+1),source:update.source};
   res.end(JSON.stringify(document));
  }catch{res.writeHead(400);res.end('{}');}
 });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) createDocumentServer().listen(18918,'127.0.0.1',()=>console.log('CAS example: http://127.0.0.1:18918/documents/example'));
