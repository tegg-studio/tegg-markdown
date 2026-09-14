import {defineConfig} from "@playwright/test";

// Isolated real-storage checks. Packed public-consumer verification runs separately.
export default defineConfig({
  testDir: "tests/recovery-browser", testMatch: "**/*.pw.ts", timeout: 30000,
  fullyParallel: false, workers: 1,
  reporter: [["list"], ["json", {outputFile: ".validation/recovery-browser-results.json"}]],
  use: {baseURL: "http://127.0.0.1:18928", trace: "retain-on-failure"},
  outputDir: ".validation/recovery-browser-artifacts",
  projects: [
    {name: "chromium", use: {browserName: "chromium"}},
    {name: "firefox", use: {browserName: "firefox"}},
    {name: "webkit", use: {browserName: "webkit"}},
  ],
  webServer: {command: "npx vite --host 127.0.0.1 --port 18928 --strictPort", url: "http://127.0.0.1:18928", reuseExistingServer: false},
});
