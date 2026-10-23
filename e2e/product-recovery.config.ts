import { basename, dirname, join } from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./product-tests",
  testMatch: "product-recovery-artifact.spec.ts",
  outputDir: process.env.TAU_ARTIFACT_DESCRIPTOR
    ? join(
        dirname(process.env.TAU_ARTIFACT_DESCRIPTOR),
        `playwright-${basename(process.env.TAU_ARTIFACT_DESCRIPTOR)}`,
      )
    : "../test-artifacts/product-recovery/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
