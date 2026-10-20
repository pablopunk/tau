import { defineConfig } from "@playwright/test";
import { PORT, serverEnvironment, stateDir } from "./support";

/** CI writes a blob and a JSON report per shard (`E2E_SHARD`) under `e2e-reports/`; the report jobs read the JSON. */
function ciReporters() {
  const shard = process.env.E2E_SHARD ?? "local";
  return [
    ["blob", { outputDir: `../e2e-reports/blob-${shard}` }],
    ["json", { outputFile: `../e2e-reports/json/${shard}.json` }],
    ["github"],
    ["list"],
  ];
}

export default defineConfig({
  testDir: "tests",
  outputDir: "../test-artifacts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? ciReporters() : [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: `node ../packages/cli/dist/bin.js serve --faux --no-open --port ${PORT} --home ${stateDir()}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 30_000,
    env: serverEnvironment(),
  },
});
