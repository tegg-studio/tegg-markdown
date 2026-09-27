import {describe,it,expect} from "vitest";
import {technicalDraft} from "./technicalDraft";
describe("technical object body drafts",()=>{
  it("preserves inline and block delimiters and unchanged source",()=>{
    for(const [raw,body,next] of [["$x^2$","x^2","$x^3$"],["$$\nx^2\n$$","x^2","$$\nx^3\n$$"]]){
      const draft=technicalDraft("math",raw)!;expect(draft.body).toBe(body);expect(draft.serialize(body)).toBe(raw);expect(draft.serialize("x^3")).toBe(next);
    }
  });
  it("keeps info strings and lengthens colliding fences",()=>{
    const draft=technicalDraft("mermaid","```mermaid title\na --> b\n```")!;
    expect(draft.serialize("a --> b")).toBe("```mermaid title\na --> b\n```");
    expect(draft.serialize("```\na --> c")).toBe("````mermaid title\n```\na --> c\n````");
  });
  it("does not invent structure for unsupported wrappers",()=>{
    expect(technicalDraft("math","$unclosed")).toBeNull();
    expect(technicalDraft("mermaid","> ```mermaid\n> a --> b\n> ```")).toBeNull();
    expect(technicalDraft("code","```js\nunclosed")).toBeNull();
    expect(technicalDraft("metadata","---\ntitle: x\n---")).toBeNull();
  });
});
