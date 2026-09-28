/** @vitest-environment jsdom */
import {expect,it} from "vitest";
import {bindUI} from "./core";

it("exposes a lifecycle-bound locale for custom Host editor roots",async()=>{
 const root=document.body.appendChild(document.createElement("div"));
 const binding=bindUI(root,{locale:"zh-CN"});
 const button=root.appendChild(document.createElement("button"));
 button.dataset.teggUiText="Copy";
 await Promise.resolve();
 expect(button.textContent).toBe("复制");
 binding.update({locale:"en-US"});
 expect(button.textContent).toBe("Copy");
 binding.destroy();root.remove();
});
