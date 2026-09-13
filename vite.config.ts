import {defineConfig} from "vite";
import {readFileSync} from "node:fs";
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
export default defineConfig({
  plugins: [{name: "shared-interaction-style", generateBundle() {
    this.emitFile({type: "asset", fileName: "interaction.css", source: readFileSync(new URL("./src/interaction.css", import.meta.url), "utf8")});
  }}],
  build: {
    target: "es2022", outDir: "dist", sourcemap: true,
    lib: {entry: {index:"src/sdk.ts",core:"src/core.ts"}, formats: ["es"], fileName: (_format, name) => `${name}.js`, cssFileName: "style"},
    rollupOptions: {external: (id: string) =>
      Object.keys(pkg.dependencies).some(name => (id === name || id.startsWith(name + "/")) && !id.endsWith(".css"))}
  }
});
