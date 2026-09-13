import {readFileSync,existsSync,writeFileSync,copyFileSync} from 'node:fs';
import {resolve,relative,dirname,join} from 'node:path';
const root=process.cwd(), pkg=JSON.parse(readFileSync('package.json','utf8')), lock=JSON.parse(readFileSync('package-lock.json','utf8'));
const seen=new Map();
function locate(name,parent){for(let dir=parent;;dir=dirname(dir)){const file=join(dir,'node_modules',name,'package.json');if(existsSync(file))return file;if(dir===dirname(dir))break;}throw new Error(`Missing ${name}`);}
function visit(name,parent,group){const file=locate(name,parent),dir=dirname(file),key=relative(root,dir);if(seen.has(key)){seen.get(key).groups.add(group);return;}
 const info=JSON.parse(readFileSync(file,'utf8'));const record={name:info.name,version:info.version,license:info.license??'SEE UPSTREAM LICENSE',purl:`pkg:npm/${encodeURIComponent(info.name)}@${info.version}`,integrity:lock.packages[key]?.integrity,repository:info.repository,groups:new Set([group])};seen.set(key,record);
 for(const dep of Object.keys({...info.dependencies,...info.optionalDependencies})){try{visit(dep,dir,group);}catch(error){if(!info.optionalDependencies?.[dep])throw error;}}
}
for(const name of Object.keys(pkg.dependencies))visit(name,root,'required');
for(const name of Object.keys(pkg.peerDependencies))visit(name,root,'optional:'+name);
writeFileSync('docs/dependency-inventory.json',JSON.stringify({scope:'Installed required dependencies and optional engine/React peer closures; embedded assets have separate complete notices.',dependencies:[...seen.values()].map(item=>({...item,groups:[...item.groups]})).sort((a,b)=>a.name.localeCompare(b.name))},null,2)+'\n');
for(const name of ['topojson-client','katex','highlight.js','mermaid','react','react-dom']){
 const dir=dirname(locate(name,root));const license=['LICENSE','LICENSE.md','LICENSE.txt'].map(file=>join(dir,file)).find(existsSync);if(license)copyFileSync(license,`licenses/${name.replace('/','-')}.txt`);
}
console.log(`Recorded ${seen.size} installed dependency/peer components`);
