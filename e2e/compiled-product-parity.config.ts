import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "product-parity.spec.ts",
  outputDir: "../test-artifacts/product-recovery/compiled-parity",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
