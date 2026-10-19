import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { startDemoEnvironment } from "./environment";
import { scenes } from "./scenes";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const { values: options } = parseArgs({
  options: {
    out: { type: "string", default: join(REPO, "assets/screenshots") },
    only: { type: "string", multiple: true },
    "skip-build": { type: "boolean", default: false },
  },
});

if (!options["skip-build"]) {
  const build = spawnSync("mise", ["exec", "--", "pnpm", "build"], { cwd: REPO, stdio: "inherit" });
  if (build.status !== 0) throw new Error("build failed");
}

const out = resolve(options.out as string);
mkdirSync(out, { recursive: true });
const selected = scenes.filter((scene) => !options.only?.length || options.only.includes(scene.name));
const environment = await startDemoEnvironment();
const browser = await chromium.launch();
try {
  for (const scene of selected) {
    await scene.capture({ browser, environment, out });
    console.log(`captured ${scene.name}`);
  }
} finally {
  await browser.close();
  await environment.stop();
}
process.exit(0);
