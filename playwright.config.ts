import {defineConfig} from "@playwright/test";
export default defineConfig({testDir: "tests/browser", testMatch: "**/*.spec.ts", timeout: 30000, fullyParallel: false, workers: 2,
  reporter: [["list"],["json",{outputFile:".validation/browser-results.json"}]],
  use:{baseURL:"http://127.0.0.1:18914",trace:"retain-on-failure"},
  projects:[{name:"chromium",testIgnore:"**/reader-task-candidate.spec.ts",use:{browserName:"chromium"}},{name:"firefox",testIgnore:["**/heap.spec.ts","**/reader-task-candidate.spec.ts"],use:{browserName:"firefox"}},{name:"webkit",testIgnore:["**/heap.spec.ts","**/reader-task-candidate.spec.ts"],use:{browserName:"webkit"}},
    {name:"chromium-task",testMatch:"**/reader-task-candidate.spec.ts",use:{browserName:"chromium",baseURL:"http://127.0.0.1:18917"}},
    {name:"firefox-task",testMatch:"**/reader-task-candidate.spec.ts",use:{browserName:"firefox",baseURL:"http://127.0.0.1:18917"}},
    {name:"webkit-task",testMatch:"**/reader-task-candidate.spec.ts",use:{browserName:"webkit",baseURL:"http://127.0.0.1:18917"}}],
  webServer:[{command:"node scripts/serve-consumer.mjs vanilla 18914",url:"http://127.0.0.1:18914",reuseExistingServer:false},
    {command:"node scripts/serve-consumer.mjs 18 18915",url:"http://127.0.0.1:18915",reuseExistingServer:false},
    {command:"node scripts/serve-consumer.mjs full 18919",url:"http://127.0.0.1:18919",reuseExistingServer:false},
    {command:"node scripts/serve-reliable-consumer.mjs",url:"http://127.0.0.1:18930",reuseExistingServer:false},
    {command:"node scripts/serve-consumer.mjs 19 18916",url:"http://127.0.0.1:18916",reuseExistingServer:false},
    {command:"node scripts/serve-consumer.mjs task 18917",url:"http://127.0.0.1:18917/task.html",reuseExistingServer:false}]
});
