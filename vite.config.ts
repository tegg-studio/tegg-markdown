import {defineConfig} from "vite";
import {readFileSync} from "node:fs";
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
export default defineConfig({
  build: {
    target: "es2022", outDir: "dist", sourcemap: true,
    lib: {entry: "src/sdk.ts", formats: ["es"], fileName: () => "index.js", cssFileName: "style"},
    rollupOptions: {external: (id: string) =>
      Object.keys(pkg.dependencies).some(name => (id === name || id.startsWith(name + "/")) && !id.endsWith(".css"))}
  }
});
