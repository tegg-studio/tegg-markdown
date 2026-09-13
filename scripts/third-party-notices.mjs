import {readFileSync,writeFileSync,readdirSync,existsSync} from "node:fs";
import {join} from "node:path";
const lock=JSON.parse(readFileSync("package-lock.json","utf8"));
const entries=[];
for(const [path,meta] of Object.entries(lock.packages)) {
  if(!path || meta.dev || !existsSync(path)) continue;
  const pkg=JSON.parse(readFileSync(join(path,"package.json"),"utf8"));
  const sections=[];
  for(const file of readdirSync(path).filter(n=>/^(licen[cs]e|copying|notice)([.-]|$)/i.test(n))) {
    try {sections.push("### "+file+"\n\n"+readFileSync(join(path,file),"utf8"));} catch {}
  }
  if(!sections.length && ["fastdom","strictdom"].includes(pkg.name)) {
    const readme=readFileSync(join(path,"README.md"),"utf8");
    const start=readme.search(/^#+ License/im); if(start<0) throw new Error("Missing license: "+pkg.name);
    sections.push(readme.slice(start));
  }
  if(pkg.name==="@viz-js/viz") sections.push(readFileSync("licenses/viz-js.txt","utf8"));
  if(!sections.length) throw new Error("Missing license text: "+pkg.name);
  const license=pkg.license ?? meta.license ?? (pkg.name==="khroma" ? "MIT" : null);
  if(!license) throw new Error("Unknown license: "+pkg.name);
  entries.push({name:pkg.name,version:pkg.version,license,purl:"pkg:npm/"+pkg.name.replace("@","%40")+"@"+pkg.version,
    integrity:meta.integrity,repository:pkg.repository,sections});
}
entries.sort((a,b)=>a.name.localeCompare(b.name));
const intro="# Third-party notices\n\nThese components are excluded from the Tegg Markdown Attribution License.\nTheir original licenses govern their respective code and assets. The npm\ninstallation resolves the listed dependencies; the built Graphviz worker\nincludes Viz.js/Graphviz/Expat and the CSS includes KaTeX font assets.\nRetain this file and the complete licenses/ directory when redistributing.\n\n## Embedded components and source availability\n\nThis product includes color specifications and designs developed by Cynthia Brewer (http://colorbrewer.org/). Graphviz supplemental terms are retained in licenses/graphviz-colorbrewer.txt and licenses/graphviz-rbtree.txt.\n\n- Lucide/Feather callout SVGs: licenses/lucide.txt (ISC/MIT).\n- Viz.js 3.29.0: MIT, licenses/viz-js.txt. Published source commit:\n  https://github.com/mdaines/viz-js/tree/96be4ed32789125f00cffa3ae390bd8809fc9c03\n- Graphviz 15.1.1: EPL-2.0. Its unmodified corresponding source is available\n  under EPL-2.0 at https://gitlab.com/api/v4/projects/4207231/packages/generic/graphviz-releases/15.1.1/graphviz-15.1.1.tar.gz\n  See licenses/graphviz-COPYING.txt and licenses/graphviz-AUTHORS.txt.\n- Expat 2.8.1: MIT-family license, licenses/expat-COPYING.txt. Source:\n  https://github.com/libexpat/libexpat/releases/download/R_2_8_1/expat-2.8.1.tar.gz\n- Emscripten 5.0.5 runtime: MIT/NCSA terms, licenses/emscripten.txt.\n  https://github.com/emscripten-core/emscripten/tree/5.0.5\n\nThe exact upstream Dockerfile at the Viz.js commit above records the build\ninputs. Tegg has not modified the embedded Graphviz or Expat code. These\ncomponents are provided AS IS, without warranties or liability from their\ncontributors, to the extent their licenses and applicable law permit.\nSubsequent distribution must preserve the rights, notices, source availability\nand other conditions required by their respective licenses.\n\nKaTeX fonts retain the KaTeX license below. System font names in CSS do not\nmean Apple or Microsoft font binaries are distributed.\n\n";
writeFileSync("THIRD_PARTY_NOTICES.md",(intro+entries.map(e=>"## "+e.name+" "+e.version+" — "+e.license+"\n\n"+e.sections.join("\n\n")).join("\n\n---\n\n")).split("\n").map(line=>line.trimEnd()).join("\n").trimEnd()+"\n");
writeFileSync("docs/dependency-inventory.json",JSON.stringify({
  scope:"Installed production npm dependencies; embedded non-npm assets are listed in THIRD_PARTY_NOTICES.md",
  dependencies:entries.map(({sections,...entry})=>entry)
},null,2)+"\n");
console.log("Recorded full notices for",entries.length,"production dependencies");
