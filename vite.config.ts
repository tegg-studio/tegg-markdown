import {defineConfig} from "vite";
import postcss from "postcss";
import {readFileSync} from "node:fs";
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
// Keep vendor source references reproducible without publishing build-machine paths.
const publicSourcePath = (path: string) => {
  const normalized = path.replace(/\\/g, "/");
  const vendor = normalized.lastIndexOf("/node_modules/");
  return vendor >= 0 ? normalized.slice(vendor + 1) : normalized;
};
export default defineConfig({
  worker: {rollupOptions: {output: {sourcemapPathTransform: publicSourcePath}}},
  plugins: [{name: "shared-interaction-style", generateBundle() {
    const base = ["styles.css", "sdk.css", "interaction.css", "editingUI.css", "conflictUI.css", "tableEditing.css", "listPresentation.css", "commandSurface.css"].map(name => readFileSync(new URL(`./src/${name}`, import.meta.url), "utf8")).join("\n");
    this.emitFile({type:"asset",fileName:"editor.css",source:base+"\n"+readFileSync(new URL("./src/htmlTableWidget.css",import.meta.url),"utf8")});
    this.emitFile({type:"asset",fileName:"ui.css",source:["editingUI.css","conflictUI.css","tableEditing.css","htmlTableWidget.css","commandSurface.css"].map(name=>readFileSync(new URL(`./src/${name}`,import.meta.url),"utf8")).join("\n")});
    const reader = postcss.parse(base);
    reader.walkRules(rule => {if(!rule.selectors) return; const selectors = rule.selectors.filter(selector => !/\.tegg-sdk-editor|\.cm-|\[data-layout=.?host.?\].*cm-/.test(selector)); if(selectors.length) rule.selectors=selectors; else rule.remove();});
    this.emitFile({type:"asset",fileName:"reader.css",source:reader.toString()});
    this.emitFile({type: "asset", fileName: "interaction.css", source: ["interaction.css", "listPresentation.css"].map(name => readFileSync(new URL(`./src/${name}`, import.meta.url), "utf8")).join("\n")});
  }}],
  build: {
    target: "es2022", outDir: "dist", sourcemap: true,
    lib: {entry: {ui:"src/uiEntry.ts",index:"src/sdk.ts",core:"src/core.ts",reader:"src/readerEntry.ts",react:"src/react.ts",editor:"src/editorEntry.ts",katex:"src/engines/katex.ts",highlight:"src/engines/highlight.ts",geometry:"src/engines/geometry.ts",mermaid:"src/engines/mermaid.ts",graphvizEngine:"src/engines/graphviz.ts"}, formats: ["es"], fileName: (_format, name) => `${name}.js`, cssFileName: "style"},
    rollupOptions: {output: {sourcemapPathTransform: publicSourcePath}, external: (id: string) =>
      Object.keys({...pkg.dependencies, ...pkg.peerDependencies}).some(name => (id === name || id.startsWith(name + "/")) && !id.endsWith(".css"))}
  }
});
