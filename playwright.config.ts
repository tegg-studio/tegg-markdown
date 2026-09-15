import {defineConfig} from "@playwright/test";
export default defineConfig({testDir: "tests/browser", testMatch: "**/*.spec.ts", timeout: 30000, fullyParallel: false, workers: 2,
  reporter: [["list"],["json",{outputFile:".validation/browser-results.json"}]],
  use:{baseURL:"http://127.0.0.1:18914",trace:"retain-on-failure"},
  projects:[{name:"chromium",use:{browserName:"chromium"}},{name:"firefox",testIgnore:"**/heap.spec.ts",use:{browserName:"firefox"}},{name:"webkit",testIgnore:"**/heap.spec.ts",use:{browserName:"webkit"}}],
  webServer:[{command:"node scripts/serve-consumer.mjs vanilla 18914",url:"http://127.0.0.1:18914",reuseExistingServer:false},
    {command:"node scripts/serve-consumer.mjs 18 18915",url:"http://127.0.0.1:18915",reuseExistingServer:false},
    {command:"node scripts/serve-consumer.mjs full 18919",url:"http://127.0.0.1:18919",reuseExistingServer:false},
    {command:"node scripts/serve-reliable-consumer.mjs",url:"http://127.0.0.1:18930",reuseExistingServer:false},
    {command:"node scripts/serve-consumer.mjs 19 18916",url:"http://127.0.0.1:18916",reuseExistingServer:false}]
});
