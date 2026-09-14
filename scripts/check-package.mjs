import {readFileSync, existsSync} from "node:fs";
import {execFileSync} from "node:child_process";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (pkg.license !== "SEE LICENSE IN LICENSE") throw new Error("Incorrect license metadata");
for (const file of ["LICENSE","COMMERCIAL-LICENSE.md","ATTRIBUTION.md","THIRD_PARTY_NOTICES.md","dist/index.js","dist/core.js","dist/style.css","dist/interaction.css","dist/types/sdk.d.ts","dist/types/core.d.ts"]) {
  if (!existsSync(file)) throw new Error("Missing distribution file: " + file);
}
for (const [entry,value] of Object.entries(pkg.exports)) {
  for(const file of typeof value === "string" ? [value] : Object.values(value)) if(!existsSync(file)) throw new Error(`Missing export ${entry}: ${file}`);
}
const pack = JSON.parse(execFileSync("npm", ["pack","--dry-run","--json","--ignore-scripts"], {encoding:"utf8"}))[0];
const names = pack.files.map(file => file.path);
for (const required of ["LICENSE","ATTRIBUTION.md","THIRD_PARTY_NOTICES.md","COMMERCIAL-LICENSE.md","licenses/lucide.txt","licenses/graphviz-COPYING.txt","licenses/graphviz-colorbrewer.txt","licenses/graphviz-rbtree.txt","licenses/expat-COPYING.txt","licenses/emscripten.txt"])
  if (!names.includes(required)) throw new Error("Missing legal material: " + required);
for (const name of names)
  if (/(^|\/)(App|QuickLook|node_modules|\.git|\.env)(\/|$)|\/Users\//.test(name)) throw new Error("Private or local path in package: " + name);
const allowedRoot = new Set(["package.json", "README.md", "LICENSE", "COMMERCIAL-LICENSE.md", "ATTRIBUTION.md", "THIRD_PARTY_NOTICES.md", "SUPPORT.md", "SECURITY.md", "CHANGELOG.md"]);
for (const name of names) {
  const allowed = allowedRoot.has(name) || /^(dist|licenses)\//.test(name)
    || /^examples\/reliable-editor\/(?:README\.md|[A-Za-z]+\.tsx?)$/.test(name)
    || /^docs\/[^/]+\.(md|json)$/.test(name)
    || ["scripts/prepare.mjs", "examples/http-cas/README.md", "examples/http-cas/server.mjs", "examples/react-toolbar/Toolbar.ts"].includes(name);
  if (!allowed || /\.(?:test|spec|node-test)\.[cm]?[jt]sx?$/.test(name))
    throw new Error("Non-distribution file in package: " + name);
}
for (const value of Object.values(pkg.exports))
  for (const file of typeof value === "string" ? [value] : Object.values(value))
    if (!names.includes(file.replace(/^\.\//, ""))) throw new Error("Export absent from tarball: " + file);
const tracked = execFileSync("git", ["ls-files", "-z"], {encoding:"utf8"}).split("\0").filter(Boolean);
for (const name of tracked)
  if (/^(App|QuickLook|Tests|Web)\/|(?:^|\/)\.env(?:\.|$)|\.(?:swift|entitlements|p8|p12|pem|key|mobileprovision)$/.test(name))
    throw new Error("Private application or credential file in public repository: " + name);
console.log("Package inventory verified:", names.length, "files;", pack.unpackedSize, "bytes");
