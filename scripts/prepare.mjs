import {existsSync} from "node:fs";
// Git dependencies need dist before npm packs them. Keep npm --json stdout clean.
import {execFileSync} from "node:child_process";
// Registry distributions already contain the build; Git checkouts contain source.
if (!existsSync("src/sdk.ts")) {
  if (!existsSync("dist/index.js") || !existsSync("dist/types/sdk.d.ts")) throw new Error("Missing prebuilt SDK distribution");
  process.exit(0);
}
try {
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {stdio:["ignore", "pipe", "pipe"]});
} catch (error) {
  process.stderr.write(error.stdout ?? "");
  process.stderr.write(error.stderr ?? "");
  process.exit(error.status || 1);
}
