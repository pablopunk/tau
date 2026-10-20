// Runs vitest on the tests related to files changed since origin/main, one package at a time.
// Usage: pnpm test:changed            (changed vs origin/main)
//        pnpm test:changed <ref>      (changed vs another ref)
import { execFileSync, spawnSync } from "node:child_process";

const ref = process.argv[2] ?? "origin/main";
const changed = execFileSync("git", ["diff", "--name-only", `${ref}...HEAD`], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const uncommitted = execFileSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf8" }).split("\n").filter(Boolean);
const files = [...new Set([...changed, ...uncommitted])];

const byPackage = new Map();
for (const file of files) {
  const match = /^packages\/([^/]+)\/(.+)$/.exec(file);
  if (!match) continue;
  const [, dir, rest] = match;
  const list = byPackage.get(dir) ?? [];
  list.push(rest);
  byPackage.set(dir, list);
}

if (byPackage.size === 0) {
  console.log("No changed files under packages/. Nothing to run.");
  process.exit(0);
}

let failed = false;
for (const [dir, rel] of byPackage) {
  const packageDir = `packages/${dir}`;
  const sources = rel.filter((path) => path.startsWith("src/"));
  if (sources.length === 0) continue;
  console.log(`\n== ${packageDir}: ${sources.length} changed source file(s)`);
  const result = spawnSync("mise", ["exec", "--", "pnpm", "--dir", packageDir, "exec", "vitest", "related", "--run", ...sources], {
    stdio: "inherit",
  });
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
