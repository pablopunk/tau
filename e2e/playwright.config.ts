import { defineConfig } from "@playwright/test";

const PORT = 4399;

export default defineConfig({
  testDir: "tests",
  outputDir: "../test-artifacts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: `node ../packages/cli/dist/bin.js --faux --no-open --port ${PORT} --home ../test-artifacts/home`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
