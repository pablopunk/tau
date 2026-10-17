import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Core } from "@pi-everywhere/protocol";
import { type ContractTarget, runCoreContract } from "@pi-everywhere/testkit/contract";
import { describe } from "vitest";
import { type CoreDependencies, createCoreWith, defaultCoreDependencies } from "./create-core";
import type { FakeGhConfig } from "./test-support/fake-gh";
import { runGhFromConfig } from "./test-support/fake-run-gh";
import { makeLocalRepo } from "./test-support/local-repo";

const REAL_CORE_IMPLEMENTED = true;

const PENDING_TAGS: string[] = ["[subagents-task]"];

process.env.PI_EVERYWHERE_ALLOW_FILE_CLONES = "1";

const GITHUB_REPOS = { withCopy: "me/with-copy", withoutCopy: "me/without-copy" };
const WITH_COPY_URL = "https://github.com/me/with-copy.git";

async function makeBareRepository(path: string): Promise<string> {
  await promisify(execFile)("git", ["init", "--bare", path]);
  return path;
}

async function makeCopyOfRepoWithCopy(codeFolder: string): Promise<void> {
  const copy = await makeLocalRepo(codeFolder, "with-copy");
  await promisify(execFile)("git", ["-C", copy, "remote", "add", "origin", WITH_COPY_URL]);
}

async function fakeGithubConfig(root: string): Promise<FakeGhConfig> {
  const bare = await makeBareRepository(join(root, "without-copy.git"));
  return {
    status: { state: "connected", login: "demo", gitProtocol: "https", tokenSource: "keyring" },
    repos: [
      {
        full_name: GITHUB_REPOS.withoutCopy,
        private: false,
        pushed_at: "2026-03-01T00:00:00Z",
        clone_url: bare,
        ssh_url: bare,
        description: null,
      },
      {
        full_name: GITHUB_REPOS.withCopy,
        private: true,
        pushed_at: "2026-01-01T00:00:00Z",
        clone_url: WITH_COPY_URL,
        ssh_url: "git@github.com:me/with-copy.git",
        description: "Has a copy",
      },
    ],
  };
}

async function setUpGithub(root: string): Promise<{ deps: CoreDependencies; codeFolder: string }> {
  const codeFolder = join(root, "code");
  await makeCopyOfRepoWithCopy(codeFolder);
  const config = await fakeGithubConfig(root);
  const runGh = runGhFromConfig(() => config).run;
  return { deps: { ...defaultCoreDependencies(), runGh, ghPath: "/usr/bin/gh" }, codeFolder };
}

async function makeRealTarget(): Promise<ContractTarget> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pie-contract-")));
  const home = join(root, "home");
  const { deps, codeFolder } = await setUpGithub(root);
  let core: Core = await createCoreWith({ home, faux: true }, deps);
  await core.settings.setProjectsFolder(codeFolder);
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
      gitDirectory: async (name) => {
        const repo = await makeLocalRepo(join(root, "projects"), name);
        const origin = await makeBareRepository(join(root, "origins", `${name}.git`));
        const url = `https://github.com/me/${name}.git`;
        const run = promisify(execFile);
        await run("git", ["-C", repo, "remote", "add", "origin", url]);
        await run("git", ["-C", repo, "config", `url.${origin}.pushInsteadOf`, url]);
        return repo;
      },
      missing: () => join(root, "does-not-exist"),
      cloneUrl: () => makeBareRepository(join(root, "remote.git")),
      failingCloneUrl: () => "https://127.0.0.1:1/fail.git",
    },
    github: { repoWithLocalCopy: GITHUB_REPOS.withCopy, repoWithoutLocalCopy: GITHUB_REPOS.withoutCopy },
    readProjectFile: (directory, name) => readFile(join(directory, name), "utf8").catch(() => undefined),
    writeProjectFile: async (directory, name, content) => {
      await mkdir(dirname(join(directory, name)), { recursive: true });
      await writeFile(join(directory, name), content);
    },
    addProjectSkill: async (directory, name, description) => {
      const folder = join(directory, ".agents", "skills", name);
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n`);
    },
    reopen: async () => {
      await core.close();
      core = await createCoreWith({ home, faux: true }, deps);
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
  runCoreContract("real core (faux mode)", makeRealTarget, { pending: PENDING_TAGS });
});
