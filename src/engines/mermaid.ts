import type {RenderEngines} from "../renderEngines";
import {mermaidValidationFailure,technicalValidationUnavailable} from "../technicalSyntax";
import {diagramDefaults,mermaidDisplaySource} from '../diagramDefaults';
let mermaidPromise:Promise<typeof import('mermaid').default>|null=null;
let rendering:Promise<unknown>=Promise.resolve();
/** Mermaid site configuration is global, so configure and render in one serialized job. */
export const mermaidEngine: NonNullable<RenderEngines["mermaid"]> = (source,target,current) => {
  const run=rendering.then(async()=>{mermaidPromise??=import('mermaid').then(module=>module.default);const engine=await mermaidPromise;if(!current())return '';const value=diagramDefaults(target);
    if(!value.formal){engine.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,theme:value.dark?'dark':'neutral',maxEdges:500,maxTextSize:64*1024,fontFamily:'-apple-system, BlinkMacSystemFont, sans-serif'});const result=await engine.render('mermaid-'+crypto.randomUUID(),source);return current()?result.svg:'';}
    engine.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,theme:'base',maxEdges:500,maxTextSize:64*1024,fontFamily:value.fontFamily,fontSize:value.fontSize,
      themeVariables:{darkMode:value.dark,fontFamily:value.fontFamily,fontSize:value.fontSize+'px',fontWeight:400,background:value.canvas,primaryColor:value.node,secondaryColor:value.node,tertiaryColor:value.node,mainBkg:value.node,nodeBkg:value.node,clusterBkg:value.node,primaryTextColor:value.text,secondaryTextColor:value.text,tertiaryTextColor:value.text,textColor:value.text,lineColor:value.text,primaryBorderColor:value.border,secondaryBorderColor:value.border,tertiaryBorderColor:value.border,nodeBorder:value.border,clusterBorder:value.border},
      sequence:{actorFontSize:value.fontSize,noteFontSize:value.fontSize,messageFontSize:value.fontSize},gantt:{fontSize:value.fontSize},journey:{boxTextMargin:5},er:{fontSize:value.fontSize},mindmap:{useMaxWidth:false},flowchart:{useMaxWidth:false},class:{useMaxWidth:false},state:{useMaxWidth:false}});
    if(!current())return '';const result=await engine.render('mermaid-'+crypto.randomUUID(),mermaidDisplaySource(source,value));return current()?result.svg:'';
  });rendering=run.catch(()=>{});return run;
};

mermaidEngine.validate = (source, _target, current) => {
  if (!current()) return {status: "stale"};
  if (new TextEncoder().encode(source).byteLength > 64 * 1024) return technicalValidationUnavailable("Diagram source exceeds the preview budget.", "budget");
  const run = rendering.then(async () => {
    if (!current()) return {status: "stale"} as const;
    let engine: typeof import("mermaid").default;
    try {
      mermaidPromise ??= import("mermaid").then(module => module.default);
      engine = await mermaidPromise;
    } catch (error) {return current() ? technicalValidationUnavailable(error) : {status: "stale"} as const;}
    if (!current()) return {status: "stale"} as const;
    try {
      engine.initialize({startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, maxEdges: 500, maxTextSize: 64 * 1024});
      await engine.parse(source, {suppressErrors: false});
      return current() ? {status: "valid"} as const : {status: "stale"} as const;
    } catch (error) {return current() ? mermaidValidationFailure(error) : {status: "stale"} as const;}
  });
  rendering = run.catch(() => {});
  return run;
};
