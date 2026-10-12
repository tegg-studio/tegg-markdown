/** @vitest-environment jsdom */
import {afterEach,beforeAll,it,expect,vi} from 'vitest';
import {openObjectViewer,disposeInteractions} from './renderInteraction';
import {bindUI,type Locale} from './uiContext';
beforeAll(()=>{vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});vi.stubGlobal('requestAnimationFrame',()=>1);vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage(){}} as unknown as CanvasRenderingContext2D);});
afterEach(()=>{disposeInteractions(document.body);document.body.replaceChildren();});
it.each<Locale>(['en-US','zh-CN'])('describes an image viewport as image in %s and preserves diagram/formula labels',async locale=>{
 const root=document.body.appendChild(document.createElement('article')),ui=bindUI(root,{locale}),trigger=document.createElement('button'),image=document.createElement('img');image.alt='Authored image';root.append(trigger,image);
 Object.defineProperties(image,{naturalWidth:{value:400},naturalHeight:{value:200},complete:{value:true}});
 openObjectViewer(trigger,image,'![Authored image](own.png)','Image');
 await vi.waitFor(()=>expect(root.querySelector('.md-object-stage')?.getAttribute('aria-label')).toBe(locale==='en-US'?'Image. Scroll to pan; use zoom controls to enlarge.':'图片。滚动平移，使用缩放控件放大。'));
 disposeInteractions(root);const formula=document.createElement('span');formula.textContent='x';root.append(formula);openObjectViewer(trigger,formula,'x','Formula');
 await vi.waitFor(()=>expect(root.querySelector('.md-object-stage')?.getAttribute('aria-label')).toBe(locale==='en-US'?'Diagram or formula. Scroll to pan; use zoom controls to enlarge.':'图表或公式。滚动平移，使用缩放控件放大。'));ui.destroy();
});
