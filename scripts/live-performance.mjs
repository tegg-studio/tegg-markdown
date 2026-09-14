import {mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {build} from 'vite';
import {chromium} from '@playwright/test';
const dir=resolve('.validation/live-perf');mkdirSync(dir,{recursive:true});
if(!existsSync('.validation/baseline-dist/index.js'))throw new Error('Restore the recorded baseline distribution before benchmarking');
const hash=dir=>createHash('sha256').update(readdirSync(dir).filter(n=>/\.(js|css)$/.test(n)).sort().map(n=>n+':'+createHash('sha256').update(readFileSync(resolve(dir,n))).digest('hex')).join('\n')).digest('hex');
writeFileSync(resolve(dir,'index.html'),'<html><head><title>Live editing performance</title></head><body><main style="height:700px"></main><script type="module" src="./main.js"></script></body></html>');
writeFileSync(resolve(dir,'main.js'),`import {TeggMarkdownEditor as Before} from '../baseline-dist/index.js';import {TeggMarkdownEditor as After} from '../../dist/index.js';import '../../dist/style.css';
const frame=()=>new Promise(r=>requestAnimationFrame(r));window.create=async(source,version,subscribed)=>{window.editor?.destroy();window.events={change:0,state:0,outline:0};const host=subscribed?{onChange:()=>events.change++,onStateChange:()=>events.state++,onOutlineChange:()=>events.outline++}:{};window.editor=new (version==='before'?Before:After)(document.querySelector('main'),{documentId:'perf',revision:'1',source},host,'live');await frame();await frame();editor.view.dispatch({selection:{anchor:editor.view.state.doc.length}});editor.view.focus();await new Promise(r=>setTimeout(r,200));};
window.sample=async()=>{const start=performance.now();const from=editor.view.state.doc.length;editor.view.dispatch({changes:{from,insert:'a'},selection:{anchor:from+1}});const dispatch=performance.now()-start;await Promise.resolve();const notified=performance.now()-start;await frame();const painted=performance.now()-start;return {dispatch,notified,painted};};window.finish=()=>{editor.destroy();window.editor=null;};`);
await build({configFile:false,root:dir,logLevel:'warn',build:{target:'es2022',outDir:'dist',emptyOutDir:true}});
const server=createServer(async(req,res)=>{try{const path=resolve(dir,'dist','.'+(req.url==='/'?'/index.html':req.url));res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}}).listen(18931,'127.0.0.1');
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto('http://127.0.0.1:18931');await page.waitForFunction(()=>window.create);
const chunks={text:'Readable source text with punctuation and a predictable paragraph.\n\n',mixed:'# Heading\n\n**Strong** and [link](https://example.com).\n\n- one\n- two\n\n```js\nconst value = 1;\n```\n\n',heavy:'$$\nx^2 + y^2 = z^2\n$$\n\n```mermaid\ngraph LR; A-->B\n```\n\n',table:'| Name | Value |\n| --- | --- |\n'+Array.from({length:30},(_,i)=>'| row '+i+' | cell |\n').join('')+'\n',adversarial:'['.repeat(80)+']'.repeat(80)+'\n\n> > > > > > > > nested\n\n'};
const artifacts={before:hash('.validation/baseline-dist'),after:hash('dist')};
const results=[];const percentile=(samples,key,p)=>samples.map(s=>s[key]).sort((a,b)=>a-b)[Math.ceil(samples.length*p)-1];
const environment={os:os.type(),release:os.release(),cpu:os.cpus()[0]?.model,browser:browser.version(),viewport:{width:1280,height:900}};
const persist=()=>writeFileSync('.validation/live-performance-results.json',JSON.stringify({artifacts,environment,method:'Settled Live Edit; real production bundles; 5 warmups + 30 input measurements, callbacks enabled and disabled. 1MiB uses explicit source preview fallback in candidate. A sentence with punctuation is edited; conservative syntax rechecks remain enabled. Dispatch, callback microtask and next animation-frame timings recorded. No physical device claim.',results},null,2));
try{for(const size of (process.env.TEGG_PERF_SIZES?process.env.TEGG_PERF_SIZES.split(',').map(Number):[20480,204800,1048576]))for(const [group,chunk]of Object.entries(chunks).filter(([group])=>!process.env.TEGG_PERF_GROUPS||process.env.TEGG_PERF_GROUPS.split(',').includes(group)))for(const subscribed of [false,true]){
 const source=chunk.repeat(Math.ceil(size/chunk.length)).slice(0,size)+'\n\nInput sentence. ',samples={before:[],after:[]},cold={};
 for(const version of ['before','after']){const start=performance.now();await page.evaluate(({source,version,subscribed})=>window.create(source,version,subscribed),{source,version,subscribed});cold[version]=performance.now()-start;for(let i=0;i<35;i++){const sample=await page.evaluate(()=>window.sample());if(i>=5)samples[version].push(sample);}await page.evaluate(()=>window.finish());}
 const summary=Object.fromEntries(['before','after'].map(v=>[v,Object.fromEntries(['dispatch','notified','painted'].flatMap(key=>[[key+'Median',percentile(samples[v],key,.5)],[key+'P95',percentile(samples[v],key,.95)]]))]));
 const regression=['dispatchMedian','dispatchP95','notifiedMedian','notifiedP95','paintedMedian','paintedP95'].some(key=>summary.after[key]>summary.before[key]*1.15&&summary.after[key]-summary.before[key]>5);
 const target=size>=1048576||group==='heavy'?100:50,absolutePass=summary.after.paintedP95<=target;
 results.push({size,group,subscribed,cold,summary,regression,target,absolutePass,samples});console.log(JSON.stringify({size,group,subscribed,summary,regression,absolutePass}));persist();
}}finally{await browser.close();server.close();}
if(results.some(r=>r.regression||!r.absolutePass))process.exitCode=1;
