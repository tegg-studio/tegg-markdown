/** Full, composited decoded frames. The Host owns source authorization, bytes and budgets. */
export type DecodedImageAnimation={status:"ready";width:number;height:number;frames:readonly {dataURL:string;durationMs:number}[];/** 0/omitted is infinite; a positive value is the total number of plays. */loopCount?:number};
export type ImageAnimationResult=DecodedImageAnimation|{status:"static";width?:number;height?:number;dataURL?:string}|{status:"unavailable";reason:"unsupported"|"budget"|"access"|"invalid"|"unknown"};
export type ImageMetadataResult={status:"static";width:number;height:number}|{status:"unavailable";reason:"unsupported"|"budget"|"access"|"invalid"|"unknown"};
export type ObjectViewerHost={resolveImageMetadata?(request:{source:string;signal:AbortSignal}):Promise<ImageMetadataResult>;decodeAnimatedImage?(request:{source:string;signal:AbortSignal}):Promise<ImageAnimationResult>};
type Binding={host:ObjectViewerHost;active:boolean;previous?:Binding};
const hosts=new WeakMap<HTMLElement,Binding>();
export function bindObjectViewerHost(root:HTMLElement,host:ObjectViewerHost):()=>void {const binding:Binding={host,active:true,previous:hosts.get(root)};hosts.set(root,binding);return ()=>{binding.active=false;if(hosts.get(root)!==binding)return;let previous=binding.previous;while(previous&&!previous.active)previous=previous.previous;if(previous)hosts.set(root,previous);else hosts.delete(root);};}
export function objectViewerHost(root:HTMLElement):ObjectViewerHost|undefined {for(let current:HTMLElement|null=root;current;current=current.parentElement){const binding=hosts.get(current);if(binding?.active)return binding.host;}}
export function validImageAnimation(result:DecodedImageAnimation):boolean {return Number.isSafeInteger(result.width)&&result.width>0&&Number.isSafeInteger(result.height)&&result.height>0&&result.frames.length>1&&result.frames.every(frame=>/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(frame.dataURL)&&Number.isFinite(frame.durationMs)&&frame.durationMs>0)&&(result.loopCount===undefined||Number.isSafeInteger(result.loopCount)&&result.loopCount>=0);}
/** A paused timeline retains the real frame; replay resets only this decoded viewer session. */
export class ImageAnimationTimeline {
 private elapsed=0;private last:number|undefined;playing=false;
 constructor(readonly durations:readonly number[],readonly loops=0){if(!durations.length||durations.some(value=>!Number.isFinite(value)||value<=0)||!Number.isSafeInteger(loops)||loops<0)throw new Error("Invalid animation timeline");}
 get frame(){const duration=this.durations.reduce((sum,value)=>sum+value,0);if(this.loops&&this.elapsed>=duration*this.loops)return this.durations.length-1;let offset=this.elapsed%duration;for(let i=0;i<this.durations.length;i++){if(offset<this.durations[i])return i;offset-=this.durations[i];}return 0;}
 play(now:number){const duration=this.durations.reduce((sum,value)=>sum+value,0);if(this.loops&&this.elapsed>=duration*this.loops)this.elapsed=0;this.playing=true;this.last=now;}
 pause(now:number){this.advance(now);this.playing=false;this.last=undefined;}
 replay(now:number){this.elapsed=0;this.play(now);}
 advance(now:number){if(this.playing&&this.last!==undefined){this.elapsed+=Math.max(0,now-this.last);this.last=now;const duration=this.durations.reduce((sum,value)=>sum+value,0);if(this.loops&&this.elapsed>=duration*this.loops){this.elapsed=duration*this.loops;this.playing=false;this.last=undefined;}}return this.frame;}
}
