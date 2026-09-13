import {describe,it,expect} from "vitest";
import {readCode,writeCode,mapCodePosition} from "./codeEditing";
describe("code source preservation",()=>{
 it("preserves blank lines, tabs, unknown languages and fence metadata",()=>{
  const raw="~~~~unknown option\n\tfirst\n\nlast\n~~~~";
  expect(readCode(raw).body).toBe("\tfirst\n\nlast");
  expect(writeCode(raw,readCode(raw).body)).toBe(raw);
 });
 it("grows fences to contain fence-like code safely",()=>{
  const next=writeCode("```text\na\n```","```\nvalue");
  expect(next).toBe("````text\n```\nvalue\n````");
  expect(readCode(next).body).toBe("```\nvalue");
 });
 it("does not truncate an unclosed code block",()=>{
  expect(readCode("```python\none\ntwo").body).toBe("one\ntwo");
  expect(writeCode("```python\none\ntwo","three")).toBe("```python\nthree");
 });
 it("preserves info suffix when changing language",()=>{
  expect(writeCode("```js title=demo\nfoo\n```","foo","python")).toBe("```python title=demo\nfoo\n```");
 });
 it("preserves indented code and can convert it to a named fence",()=>{
  expect(writeCode("    a\n        b","a\n    b")).toBe("    a\n        b");
  expect(writeCode("    a","a","swift")).toBe("```swift\na\n```");
 });
});

describe("code caret mapping",()=>{
 it("maps a caret through undo and redo of insertion",()=>{
  expect(mapCodePosition("NoteX {","Note {",5)).toBe(4);
  expect(mapCodePosition("Note {","NoteX {",4)).toBe(5);
 });
 it("keeps positions before edits and shifts positions after edits",()=>{
  expect(mapCodePosition("abcXYZdef","abcdef",2)).toBe(2);
  expect(mapCodePosition("abcXYZdef","abcdef",8)).toBe(5);
 });
});
