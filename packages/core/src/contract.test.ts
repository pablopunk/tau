import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Core } from "@pi-everywhere/protocol";
import { type ContractTarget, runCoreContract } from "@pi-everywhere/testkit/contract";
import { describe } from "vitest";
import { createCore } from "./index";

const REAL_CORE_IMPLEMENTED = true;

process.env.PI_EVERYWHERE_ALLOW_FILE_CLONES = "1";

const PENDING_A1_TAGS = [
  "[start]",
  "[images]",
  "[titles]",
  "[status]",
  "[archive]",
  "[delete]",
  "[retry]",
  "[listAll]",
];
const PENDING_A2_TAGS = ["[clone]", "[settings]"];

async function makeBareRepository(path: string): Promise<string> {
  await promisify(execFile)("git", ["init", "--bare", path]);
  return path;
}

async function makeRealTarget(): Promise<ContractTarget> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pie-contract-")));
  const home = join(root, "home");
  let core: Core = await createCore({ home, faux: true });
  const target: ContractTarget = {
    get core() {
      return core;
    },
    paths: {
      directory: async (name) => {
        const path = join(root, "projects", name);
        await mkdir(path, { recursive: true });
        return path;
      },
      file: async (name) => {
        const path = join(root, name);
        await writeFile(path, "not a folder");
        return path;
      },
      missing: () => join(root, "does-not-exist"),
      cloneUrl: () => makeBareRepository(join(root, "remote.git")),
      failingCloneUrl: () => "https://127.0.0.1:1/fail.git",
    },
    readProjectFile: (directory, name) => readFile(join(directory, name), "utf8").catch(() => undefined),
    reopen: async () => {
      await core.close();
      core = await createCore({ home, faux: true });
      return core;
    },
    dispose: async () => {
      await core.close();
      await rm(root, { recursive: true, force: true });
    },
  };
  return target;
}

describe.skipIf(!REAL_CORE_IMPLEMENTED)("real core", () => {
  runCoreContract("real core (faux mode)", makeRealTarget, {
    pending: [...PENDING_A1_TAGS, ...PENDING_A2_TAGS],
  });
});
