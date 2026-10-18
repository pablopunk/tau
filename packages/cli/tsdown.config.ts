import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { bin: "src/bin.ts", watchdog: "../core/src/watchdog/worker.ts" },
  format: "esm",
  platform: "node",
  target: "node22",
  clean: true,
  dts: false,
  fixedExtension: false,
  deps: {
    alwaysBundle: [/^@tau\//],
    neverBundle: ["@anthropic-ai/claude-agent-sdk", "@earendil-works/pi-env", "@opentunnel/client", "effect"],
  },
  copy: [
    { from: "../web/dist", to: "dist/web" },
    { from: "../core/src/skills/builtin", to: "dist/skills" },
  ],
});
