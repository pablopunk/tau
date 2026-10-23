import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./product-tests",
  testMatch: "product-recovery-artifact.spec.ts",
  outputDir: "../test-artifacts/product-recovery/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
