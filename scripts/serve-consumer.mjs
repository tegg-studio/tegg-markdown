import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve, extname, sep} from "node:path";
const [version="vanilla", port="18914"] = process.argv.slice(2);
const consumerRoot=(await readFile(".validation/consumer-root.txt","utf8")).trim();
const root=resolve(consumerRoot,`consumer-${version}`,"dist");
createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,"http://localhost"), pathname=decodeURIComponent(url.pathname === "/" ? "/minimal.html" : url.pathname);
    const file=resolve(root,"."+pathname); if(!file.startsWith(root+sep)) {res.writeHead(403);res.end();return;}
    if(url.searchParams.get("csp") === "engines") res.setHeader("Content-Security-Policy","default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'");
    else if(url.searchParams.has("csp")) res.setHeader("Content-Security-Policy","default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'");
    const type={".html":"text/html",".js":"text/javascript",".css":"text/css",".woff2":"font/woff2",".wasm":"application/wasm"}[extname(file)] ?? "application/octet-stream";
    res.setHeader("Content-Type",type); res.end(await readFile(file));
  } catch {res.writeHead(404);res.end("Not found");}
}).listen(Number(port),"127.0.0.1");
