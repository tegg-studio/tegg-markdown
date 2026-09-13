// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {LocalFiles, relativePath} from "./localFiles";
afterEach(() => vi.unstubAllGlobals());
function file(path: string, source = "") { const file = new File([source], path.split("/").pop()!); Object.defineProperty(file,"webkitRelativePath",{value:"notes/"+path}); return file; }
it("resolves nested, encoded and root-relative paths without escaping the selected root", () => {
  expect(relativePath("../图%20片.svg#node","docs/a.md")).toEqual({path:"图 片.svg",fragment:"node"});
  expect(relativePath("/a.md#标题","docs/b.md")?.path).toBe("a.md");
  expect(relativePath("#标题","docs/b.md")?.path).toBe("docs/b.md");
  for (const value of ["../../outside.md", "https://example.com/a", "//example.com/a", "%ZZ", "..%5coutside"]) expect(relativePath(value,"docs/a.md")).toBeUndefined();
});
it("finds only selected Markdown files and reuses then releases image URLs", () => {
  const create=vi.fn(() => "blob:test"), revoke=vi.fn();
  vi.stubGlobal("URL",{createObjectURL:create,revokeObjectURL:revoke});
  const files=new LocalFiles([file("docs/a.md"),file("target.md"),file("image.svg")]);
  expect(files.document("../target#heading","docs/a.md")?.path).toBe("target.md");
  expect(files.document("../image.svg","docs/a.md")).toBeUndefined();
  expect(files.image("../image.svg","docs/a.md")).toBe("blob:test");
  expect(files.image("../image.svg","docs/a.md")).toBe("blob:test");
  expect(create).toHaveBeenCalledTimes(1);
  expect(files.image("missing.png","docs/a.md")).toBe("data:image/png;base64,");
  expect(files.image("https://example.com/a.png", "docs/a.md")).toBe("https://example.com/a.png");
  files.destroy(); files.destroy(); expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:test");
});
