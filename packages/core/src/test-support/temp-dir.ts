import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

/** A fresh real temp directory per test, removed afterwards. */
export function useTempDir(): () => Promise<string> {
  const created: string[] = [];
  afterEach(async () => {
    await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });
  return async () => {
    const path = await realpath(await mkdtemp(join(tmpdir(), "tau-core-")));
    created.push(path);
    return path;
  };
}

export const homeIn = (root: string) => join(root, "home");
