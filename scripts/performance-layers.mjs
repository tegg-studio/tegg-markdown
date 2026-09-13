import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {build} from 'vite';
import {chromium} from '@playwright/test';
const dir=resolve('.validation/layers');mkdirSync(dir,{recursive:true});
writeFileSync(resolve(dir,'index.html'),'<main style="height:700px"></main><script type="module" src="./main.js"></script>');
writeFileSync(resolve(dir,'main.js'),`import {TeggMarkdownReader,TeggMarkdownEditor as After} from '../../dist/index.js';
import {TeggMarkdownEditor as Before} from '../baseline-dist/index.js';
import {parserFor} from '../../src/markdownParser';import '../../dist/style.css';
let editor;const root=document.querySelector('main');
window.parse=source=>{const start=performance.now();parserFor('tegg').parse(source,{});return performance.now()-start;};
window.ready=async source=>{const reader=new TeggMarkdownReader(root);const start=performance.now();await reader.render({source,contentState:'settled'});const elapsed=performance.now()-start;const states={};for(const node of root.querySelectorAll('[data-render-state]')){const state=node.dataset.renderState;states[state]=(states[state]||0)+1;}const fallback=!!root.querySelector('.tegg-source-fallback');reader.destroy();return {elapsed,states,fallback};};
window.startEditor=(source,version)=>{editor?.destroy();editor=new (version==='before'?Before:After)(root,{documentId:'input',revision:'1',source},{},'source');root.querySelector('.cm-content').focus();};
window.input=async()=>{const before=editor.source;const start=performance.now();document.execCommand('insertText',false,'x');await new Promise(resolve=>requestAnimationFrame(resolve));const nextFrame=performance.now()-start;if(editor.source.length!==before.length+1)throw new Error('Input was not applied exactly once');return nextFrame;};
window.stopEditor=()=>{editor.destroy();editor=null;};`);
await build({configFile:false,root:dir,logLevel:'warn',build:{target:'es2022',outDir:'dist',emptyOutDir:true}});
const server=createServer(async(req,res)=>{try{const path=resolve(dir,'dist','.'+(req.url==='/'?'/index.html':req.url));res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}}).listen(18918,'127.0.0.1');
const browser=await chromium.launch();const chunks={text:'Readable source text with punctuation and a predictable paragraph.\n\n',mixed:'# Heading\n\n**Strong** and [link](https://example.com).\n\n- one\n- two\n\n```js\nconst value = 1;\n```\n\n',heavy:'$$ x^2 + y^2 = z^2 $$\n\n```mermaid\ngraph LR; A-->B\n```\n\n',table:'| Name | Value |\n| --- | --- |\n'+Array.from({length:30},(_,i)=>`| row ${i} | cell |\n`).join('')+'\n',adversarial:'['.repeat(80)+']'.repeat(80)+'\n\n> > > > > > > > nested\n\n'};
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
const summary=values=>({median:percentile(values,.5),p95:percentile(values,.95)});
const inputOnly=process.argv.includes('--input-only');
const previous=inputOnly?JSON.parse(readFileSync('.validation/performance-layers.json','utf8')):null;
const results=[];
const artifactHash=dir=>createHash('sha256').update(readdirSync(dir).filter(n=>/\.(js|css)$/.test(n)).sort().map(n=>n+':'+createHash('sha256').update(readFileSync(resolve(dir,n))).digest('hex')).join('\n')).digest('hex');
try{
 for(const size of [20480,204800,1048576])for(const [group,chunk] of Object.entries(chunks)){
  const source=chunk.repeat(Math.ceil(size/chunk.length)).slice(0,size);const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();await page.goto('http://127.0.0.1:18918/');await page.waitForFunction(()=>window.parse);
  const parse=[],ready=[],input={before:[],after:[]};let readyStates;
  if(!inputOnly) for(let i=0;i<35;i++){const value=await page.evaluate(source=>window.parse(source),source);if(i>=5)parse.push(value);}
  if(!inputOnly) for(let i=0;i<35;i++){const value=await page.evaluate(source=>window.ready(source),source);if(i>=5)ready.push(value.elapsed);readyStates=value;}
  for(const version of ['before','after']){await page.evaluate(({source,version})=>window.startEditor(source,version),{source,version});for(let i=0;i<35;i++){const value=await page.evaluate(()=>window.input());if(i>=5)input[version].push(value);}await page.evaluate(()=>window.stopEditor());}
  const inputSummary={before:summary(input.before),after:summary(input.after)};const regression=['median','p95'].some(k=>inputSummary.after[k]>inputSummary.before[k]*1.15&&inputSummary.after[k]-inputSummary.before[k]>5);
  const result={bytes:size,group,parse:inputOnly?previous.results.find(r=>r.bytes===size&&r.group===group).parse:{...summary(parse),samples:parse},ready:inputOnly?previous.results.find(r=>r.bytes===size&&r.group===group).ready:{...summary(ready),samples:ready,finalStates:readyStates.states,sourceFallback:readyStates.fallback},input:{summary:inputSummary,samples:input,regression}};results.push(result);console.log(JSON.stringify({bytes:size,group,parse:inputOnly?undefined:summary(parse),ready:inputOnly?undefined:summary(ready),input:inputSummary,regression}));await context.close();
  writeFileSync(inputOnly?'.validation/performance-input.json':'.validation/performance-layers.json',JSON.stringify({retainedRenderingEvidence:inputOnly?previous.artifacts:null,artifacts:{before:artifactHash('.validation/baseline-dist'),after:artifactHash('dist')},environment:{os:os.type(),release:os.release(),cpu:os.cpus()[0]?.model,browser:browser.version()},method:'5 warmups + 30 samples per group; current production parser; current settled Reader including bounded fallback; source-mode insertion to next animation frame, baseline/current SDK; not real OS IME or pixel presentation time; no CPU throttling',results},null,2));
 }
}finally{await browser.close();server.close();}
if(results.some(r=>r.input.regression))process.exitCode=1;
