// Git dependencies need dist before npm packs them. Keep npm --json stdout clean.
import {execFileSync} from "node:child_process";
try {
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {stdio:["ignore", "pipe", "pipe"]});
} catch (error) {
  process.stderr.write(error.stdout ?? "");
  process.stderr.write(error.stderr ?? "");
  process.exit(error.status || 1);
}
