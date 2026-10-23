import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "native-injected-browser.spec.ts",
  outputDir: "../test-artifacts/native-injected-browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { serviceWorkers: "block", trace: "retain-on-failure" },
});
