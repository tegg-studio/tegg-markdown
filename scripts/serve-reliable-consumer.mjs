import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
const consumerRoot=(await readFile('.validation/consumer-root.txt','utf8')).trim();
const root=resolve(consumerRoot,'consumer-reliable','dist'),uploads=resolve(consumerRoot,'reliable-upload-fixtures');await mkdir(uploads,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'};
createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1:18930');
    if(url.pathname==='/api/attachments'&&req.method==='POST'){
      const buffers=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2_097_152){res.writeHead(413);res.end('Test upload budget exceeded');return;}buffers.push(chunk);}
      if(url.searchParams.get('fail')==='1'){res.writeHead(503);res.end('Injected storage failure');return;}
      const bytes=Buffer.concat(buffers),digest=createHash('sha256').update(bytes).digest('hex');
      const filename=decodeURIComponent(String(req.headers['x-file-name']??'attachment')).replace(/[^a-zA-Z0-9._-]/g,'_').slice(-100)||'attachment';
      const name=digest.slice(0,16)+'-'+filename;await writeFile(resolve(uploads,name),bytes);
      const delay=Math.max(0,Math.min(2000,Number(url.searchParams.get('delay'))||0));if(delay)await new Promise(done=>setTimeout(done,delay));
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({reference:'attachments/'+name}));return;
    }
    if(url.pathname==='/api/resources'){
      const files=await Promise.all((await readdir(uploads)).map(async name=>{const bytes=await readFile(resolve(uploads,name));return {name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(files));return;
    }
    const attachment=url.pathname.startsWith('/attachments/'),base=attachment?uploads:root;
    const pathname=decodeURIComponent(attachment?url.pathname.slice('/attachments'.length):url.pathname==='/'?'/reliable.html':url.pathname);
    const file=resolve(base,'.'+pathname);if(!file.startsWith(base+sep)){res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');res.end(await readFile(file));
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(18930,'127.0.0.1');
