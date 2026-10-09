export type DiagramDefaults={fontFamily:string;fontSize:number;text:string;canvas:string;node:string;border:string;scale:number;dark:boolean;formal:boolean};
function rgb(value:string):number[]|undefined{if(/^#[a-f\d]{6}$/i.test(value))return value.slice(1).match(/.{2}/g)!.map(x=>parseInt(x,16));if(/^#[a-f\d]{3}$/i.test(value))return value.slice(1).split('').map(x=>parseInt(x+x,16));if(/^rgba?\(/.test(value))return value.match(/[\d.]+/g)?.slice(0,3).map(Number);return undefined;}
function hex(value:number[]){return '#'+value.map(x=>Math.round(Math.min(255,Math.max(0,x))).toString(16).padStart(2,'0')).join('');}
/** Read the already resolved Host body role before the engine measures labels. */
export function diagramDefaults(target:HTMLElement):DiagramDefaults {
  const style=getComputedStyle(target),surface=target.closest<HTMLElement>('.tegg-surface')??target,surfaceStyle=getComputedStyle(surface);
  const canvas=rgb(surfaceStyle.getPropertyValue('--background').trim())??rgb(surfaceStyle.backgroundColor)??[255,255,255],dark=surface.dataset.theme?surface.dataset.theme==='dark':canvas.reduce((a,b)=>a+b,0)<384;
  const text=rgb(style.color)??(dark?[226,226,232]:[34,35,39]);const scaleValue=style.getPropertyValue('--md-decoration-scale').trim()||style.getPropertyValue('--md-user-scale').trim(),formal=!!scaleValue,scale=parseFloat(scaleValue)||1;
  return {fontFamily:style.fontFamily||'-apple-system, BlinkMacSystemFont, sans-serif',fontSize:parseFloat(style.fontSize)||16,text:hex(text),canvas:hex(canvas),node:hex(canvas.map((value,index)=>value*(dark?.92:.96)+text[index]*(dark?.08:.04))),border:dark?'#7A7E85':'#8B8E94',scale,dark,formal};
}
export function graphvizDisplaySource(source:string,value:DiagramDefaults):string {
  if(!/^\s*(?:strict\s+)?(?:di)?graph\b/.test(source))return source;
  let quoted=false,lineComment=false,blockComment=false,at=-1;
  for(let i=0;i<source.length;i++){const c=source[i],next=source[i+1];if(lineComment){if(c==='\n')lineComment=false;continue;}if(blockComment){if(c==='*'&&next==='/'){blockComment=false;i++;}continue;}if(quoted){if(c==='\\')i++;else if(c==='"')quoted=false;continue;}if(c==='"'){quoted=true;continue;}if(c==='/'&&next==='/'){lineComment=true;i++;continue;}if(c==='/'&&next==='*'){blockComment=true;i++;continue;}if(c==='#'){lineComment=true;continue;}if(c==='{'){at=i+1;break;}}
  if(at<0)return source;
  const quote=(text:string)=>JSON.stringify(text),size=value.fontSize*.75;
  const defaults=`\ngraph [bgcolor=${quote(value.canvas)},fontname=${quote(value.fontFamily)},fontsize=${size},fontcolor=${quote(value.text)}];\nnode [fontname=${quote(value.fontFamily)},fontsize=${size},fontcolor=${quote(value.text)},color=${quote(value.border)},fillcolor=${quote(value.node)},style=filled,penwidth=${value.scale*.75}];\nedge [fontname=${quote(value.fontFamily)},fontsize=${size},fontcolor=${quote(value.text)},color=${quote(value.text)},penwidth=${value.scale*1.125}];\n`;
  return source.slice(0,at)+defaults+source.slice(at);
}
export function mermaidDisplaySource(source:string,value:DiagramDefaults):string {
  const body=source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'').replace(/^%%[^\n]*\n/g,'');
  if(!/^(?:flowchart|graph)\s+(?:TB|TD|BT|LR|RL)\b/m.test(body))return source;
  return source+(!/\bclassDef\s+default\b/.test(body)?`\nclassDef default stroke-width:${value.scale}px;`:``)+(!/\blinkStyle\s+default\b/.test(body)?`\nlinkStyle default stroke-width:${1.5*value.scale}px;`:``);
}
