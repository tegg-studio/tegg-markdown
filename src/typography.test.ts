/** @vitest-environment jsdom */
import {describe,expect,it,vi} from "vitest";
import {appearanceScale,appearanceWidth,observeTypography} from "./typography";
import {TechnicalMarkdownReader} from "./reader";

describe("typography host contract",()=>{
  it("preserves accessibility scaling without a second multiplier or ceiling",()=>{
    for(const scale of [1,2,3.12]) expect(appearanceScale(scale)).toBe(scale);
    for(const invalid of [NaN,Infinity,0,-1]) expect(appearanceScale(invalid)).toBe(1);
    expect(appearanceWidth(920)).toBe(920);
    expect(appearanceWidth(NaN)).toBe(672);
  });
  it("responds independently to allocated canvas widths, including breakpoint edges",()=>{
    let callback: ResizeObserverCallback | undefined;
    const disconnect=vi.fn();
    vi.stubGlobal("ResizeObserver",class {constructor(cb:ResizeObserverCallback){callback=cb;} observe(){} disconnect=disconnect;});
    const a=document.createElement("div"),b=document.createElement("div");
    let width=479;Object.defineProperty(a,"clientWidth",{get:()=>width});
    Object.defineProperty(b,"clientWidth",{get:()=>1024});
    const stop=observeTypography(a); const first=callback!;observeTypography(b);
    expect(a.dataset.layout).toBe("compact");expect(b.dataset.layout).toBe("wide");
    for(const [w,layout] of [[480,"regular"],[959,"regular"],[960,"wide"]] as const){width=w;first([{target:a} as unknown as ResizeObserverEntry],{} as ResizeObserver);expect(a.dataset.layout).toBe(layout);expect(b.dataset.layout).toBe("wide");}
    stop();expect(disconnect).toHaveBeenCalledOnce();vi.unstubAllGlobals();
  });
  it("keeps source, code bytes and table alignment while adding a keyboard scroll region",async()=>{
    vi.stubGlobal("matchMedia",()=>({matches:false}));
    const root=document.createElement("div"),other=document.createElement("div");
    const reader=new TechnicalMarkdownReader(root),second=new TechnicalMarkdownReader(other);
    const source='中文 **正文**\n\n```text\n  原文  \n```\n\n| A | B |\n| :--- | ---: |\n| 中文 | 100 |';
    await reader.render({source,fontScale:2,contentWidth:920});await second.render({source,fontScale:1});
    expect(root.style.getPropertyValue("--reader-font-scale")).toBe("2");expect(other.style.getPropertyValue("--reader-font-scale")).toBe("1");
    expect(root.querySelector("pre code")?.textContent).toBe('  原文  \n');
    const region=root.querySelector<HTMLElement>('.md-table-scroll')!;
    expect(region.tabIndex).toBe(0);expect(region.getAttribute('role')).toBe('region');
    expect(root.querySelector('td.align-right')?.textContent).toBe('100');
    reader.destroy();second.destroy();vi.unstubAllGlobals();
  });
});
