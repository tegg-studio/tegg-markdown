import {mkdirSync,writeFileSync,readFileSync,cpSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer as httpServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from 'vite';
import {chromium} from '@playwright/test';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {readdirSync} from 'node:fs';
const artifactHash=dir=>createHash('sha256').update(readdirSync(dir).filter(name=>/\.(js|css)$/.test(name)).sort().map(name=>name+':'+createHash('sha256').update(readFileSync(resolve(dir,name))).digest('hex')).join('\n')).digest('hex');
const root=process.cwd(),dir=resolve('.validation/perf');mkdirSync(dir,{recursive:true});
if(!existsSync('.validation/baseline-dist/index.js'))throw new Error('Restore the recorded baseline distribution before benchmarking');
writeFileSync(resolve(dir,'index.html'),'<html><head><title>Performance comparison</title></head><body><main style="height:700px"></main><script type="module" src="./main.js"></script></body></html>');
writeFileSync(resolve(dir,'main.js'),`import {TeggMarkdownReader as Before} from '../baseline-dist/index.js';
import {TeggMarkdownReader as After} from '../../dist/index.js';
import '../../dist/style.css';
window.benchmark=async(source,version)=>{const root=document.querySelector('main');const reader=new (version==='before'?Before:After)(root);const start=performance.now();const pending=reader.render({documentId:'benchmark',source,contentState:'streaming'});const readable=performance.now()-start;await pending;const ready=performance.now()-start;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const firstPaint=performance.now()-start;reader.destroy();return {readable,ready,firstPaint};};`);
await build({configFile:false,root:dir,logLevel:'warn',build:{target:'es2022',outDir:'dist',emptyOutDir:true}});
const server=httpServer(async(req,res)=>{try{const path=resolve(dir,'dist','.'+(req.url==='/'?'/index.html':req.url));res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}}).listen(18917,'127.0.0.1');
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto('http://127.0.0.1:18917/');await page.waitForFunction(()=>window.benchmark);
const chunks={text:'Readable source text with punctuation and a predictable paragraph.\n\n',mixed:'# Heading\n\n**Strong** and [link](https://example.com).\n\n- one\n- two\n\n```js\nconst value = 1;\n```\n\n',heavy:'$$ x^2 + y^2 = z^2 $$\n\n```mermaid\ngraph LR; A-->B\n```\n\n',table:'| Name | Value |\n| --- | --- |\n'+Array.from({length:30},(_,i)=>`| row ${i} | cell |\n`).join('')+'\n',adversarial:'['.repeat(80)+']'.repeat(80)+'\n\n> > > > > > > > nested\n\n'};
const results=[];
try{
 for(const size of [20480,204800,1048576])for(const [group,chunk] of Object.entries(chunks)){
  const source=chunk.repeat(Math.ceil(size/chunk.length)).slice(0,size);const samples={before:[],after:[]};const cold={};
  for(const version of ['before','after']){const context=await browser.newContext({viewport:{width:1280,height:900}});const fresh=await context.newPage();await fresh.goto('http://127.0.0.1:18917/');await fresh.waitForFunction(()=>window.benchmark);cold[version]=await fresh.evaluate(({source,version})=>window.benchmark(source,version),{source,version});await context.close();}
  for(let iteration=0;iteration<35;iteration++)for(const version of iteration%2?['after','before']:['before','after']){const sample=await page.evaluate(({source,version})=>window.benchmark(source,version),{source,version});if(iteration>=5)samples[version].push(sample);}
  const percentile=(list,key,p)=>list.map(s=>s[key]).sort((a,b)=>a-b)[Math.ceil(list.length*p)-1];
  const summary=Object.fromEntries(['before','after'].map(version=>[version,{median:percentile(samples[version],'ready',.5),p95:percentile(samples[version],'ready',.95),paintMedian:percentile(samples[version],'firstPaint',.5),paintP95:percentile(samples[version],'firstPaint',.95)}]));
  const regression=['median','p95','paintMedian','paintP95'].some(key=>summary.after[key]>summary.before[key]*1.15 && summary.after[key]-summary.before[key]>5);
  results.push({bytes:Buffer.byteLength(source),group,summary,regression,samples,cold});console.log(JSON.stringify({size,group,summary,regression}));
  writeFileSync('.validation/performance-results.json',JSON.stringify({artifacts:{before:artifactHash('.validation/baseline-dist'),after:artifactHash('dist')},environment:{os:os.type(),release:os.release(),cpu:os.cpus()[0]?.model,browser:browser.version(),viewport:{width:1280,height:900}},method:'5 warmups + 30 measurements; alternating order; streaming initial content (heavy engines deferred); production builds',results},null,2));
 }
}finally{await browser.close();server.close();}
if(results.some(result=>result.regression))process.exitCode=1;
