import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { bin: "src/bin.ts" },
  format: "esm",
  platform: "node",
  target: "node22",
  clean: true,
  dts: false,
  noExternal: [/^@pi-everywhere\//],
  copy: [{ from: "../web/dist", to: "dist/web" }],
});
