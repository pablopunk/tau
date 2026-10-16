import { execFile } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Core } from "@pi-everywhere/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createCoreWith, defaultCoreDependencies } from "./create-core";
import { createGithubService } from "./github/github-service";
import type { GhResult, RunGh } from "./github/run-gh";
import type { FakeGhConfig, FakeGhRepo } from "./test-support/fake-gh";
import {
  ghFailure,
  ghOk,
  type RecordingRunGh,
  recordingRunGh,
  runGhFromConfig,
} from "./test-support/fake-run-gh";
import { GH_REPOS_ARGV, GH_STATUS_ARGV } from "./test-support/gh-argv";
import { makeLocalRepo } from "./test-support/local-repo";
import { homeIn, useTempDir } from "./test-support/temp-dir";

process.env.PI_EVERYWHERE_ALLOW_FILE_CLONES = "1";

const tempDir = useTempDir();
const run = promisify(execFile);
const open: Core[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((core) => core.close()));
});

const repo = (name: string, pushed: string, overrides: Partial<FakeGhRepo> = {}): FakeGhRepo => ({
  full_name: name,
  private: false,
  pushed_at: pushed,
  clone_url: `https://github.com/${name}.git`,
  ssh_url: `git@github.com:${name}.git`,
  description: null,
  ...overrides,
});

const connected = (gitProtocol: "https" | "ssh" = "https"): FakeGhConfig["status"] => ({
  state: "connected",
  login: "demo",
  gitProtocol,
  tokenSource: "keyring",
});

interface World {
  core: Core;
  code: string;
  gh: RecordingRunGh;
  config: FakeGhConfig;
  clock: { now: number };
}

const CONNECTED_JSON = JSON.stringify({
  hosts: { "github.com": [{ state: "success", login: "d", gitProtocol: "https", tokenSource: "t" }] },
});

async function openWithRunGh(runGh: RunGh): Promise<Core> {
  const root = await tempDir();
  const core = await createCoreWith(
    { home: homeIn(root), faux: true },
    { ...defaultCoreDependencies(), runGh },
  );
  open.push(core);
  return core;
}

async function openWorld(config: FakeGhConfig): Promise<World> {
  const root = await tempDir();
  const code = join(root, "code");
  await mkdir(code, { recursive: true });
  const clock = { now: 1_000_000 };
  const gh = runGhFromConfig(() => config);
  const deps = { ...defaultCoreDependencies(), runGh: gh.run, ghPath: "/usr/bin/gh", now: () => clock.now };
  const core = await createCoreWith({ home: homeIn(root), faux: true }, deps);
  open.push(core);
  await core.settings.setProjectsFolder(code);
  return { core, code, gh, config, clock };
}

const apiCalls = (gh: RecordingRunGh) => gh.calls.filter((call) => call[0] === "api");
const statusCalls = (gh: RecordingRunGh) => gh.calls.filter((call) => call[0] === "auth");

async function addRemote(path: string, url: string) {
  await run("git", ["-C", path, "remote", "add", "origin", url]);
}

describe("github.status", () => {
  it("asks gh once per minute", async () => {
    const world = await openWorld({ status: connected("ssh"), repos: [] });
    expect(await world.core.github.status()).toMatchObject({ state: "connected", gitProtocol: "ssh" });
    await world.core.github.status();
    expect(statusCalls(world.gh)).toEqual([[...GH_STATUS_ARGV]]);
    world.clock.now += 61_000;
    await world.core.github.status();
    expect(statusCalls(world.gh)).toHaveLength(2);
  });
});

describe("github.repos", () => {
  it("runs the frozen gh api call once and caches for five minutes", async () => {
    const world = await openWorld({ status: connected(), repos: [repo("me/a", "2026-01-01T00:00:00Z")] });
    await world.core.github.repos();
    await world.core.github.repos();
    expect(apiCalls(world.gh)).toEqual([[...GH_REPOS_ARGV]]);
    world.clock.now += 5 * 60_000 + 1;
    await world.core.github.repos();
    expect(apiCalls(world.gh)).toHaveLength(2);
  });

  it("lists newest first and picks the clone url the protocol asks for", async () => {
    const world = await openWorld({
      status: connected("ssh"),
      repos: [repo("me/old", "2025-01-01T00:00:00Z"), repo("me/new", "2026-01-01T00:00:00Z")],
    });
    const repos = await world.core.github.repos();
    expect(repos.map((item) => item.nameWithOwner)).toEqual(["me/new", "me/old"]);
  });

  it("shares one fetch between concurrent refreshes", async () => {
    const world = await openWorld({ status: connected(), repos: [repo("me/a", "2026-01-01T00:00:00Z")] });
    await Promise.all([
      world.core.github.refreshRepos(),
      world.core.github.refreshRepos(),
      world.core.github.repos(),
    ]);
    expect(apiCalls(world.gh)).toHaveLength(1);
    await world.core.github.refreshRepos();
    expect(apiCalls(world.gh)).toHaveLength(2);
  });

  it("is unavailable when gh is not connected", async () => {
    const world = await openWorld({ status: { state: "not_logged_in" }, repos: [] });
    await expect(world.core.github.repos()).rejects.toMatchObject({ code: "github_unavailable" });
  });

  it("is unavailable when gh answers garbage or fails", async () => {
    const answering = (reposReply: GhResult) =>
      recordingRunGh((args) => (args[0] === "auth" ? ghOk(CONNECTED_JSON) : reposReply)).run;
    const garbage = await openWithRunGh(answering(ghOk("{}")));
    await expect(garbage.github.repos()).rejects.toMatchObject({ code: "github_unavailable" });
    const failing = await openWithRunGh(answering(ghFailure("HTTP 502")));
    await expect(failing.github.repos()).rejects.toMatchObject({
      code: "github_unavailable",
      message: "HTTP 502",
    });
  });
});

describe("settings.setProjectsFolder", () => {
  it("drops the cached scan and announces a projects change", async () => {
    const world = await openWorld({ status: connected(), repos: [repo("me/moved", "2026-01-01T00:00:00Z")] });
    expect((await world.core.github.repos())[0]?.localPath).toBeNull();
    const other = join(await tempDir(), "src");
    const copy = await makeLocalRepo(other, "moved");
    await addRemote(copy, "git@github.com:me/moved.git");
    const changes: unknown[] = [];
    world.core.onChange((change) => changes.push(change));
    await world.core.settings.setProjectsFolder(other);
    expect(changes).toContainEqual({ resource: "projects" });
    expect((await world.core.github.repos())[0]?.localPath).toBe(copy);
    expect(apiCalls(world.gh)).toHaveLength(2);
  });
});

describe("github.use", () => {
  async function worldWithCopy() {
    const world = await openWorld({
      status: connected(),
      repos: [repo("me/with-copy", "2026-01-01T00:00:00Z")],
    });
    const copy = await makeLocalRepo(world.code, "with-copy");
    await addRemote(copy, "git@github.com:Me/With-Copy.git");
    return { ...world, copy };
  }

  it("adds a local copy as a folder project, once, even concurrently", async () => {
    const { core, copy } = await worldWithCopy();
    const input = { nameWithOwner: "me/with-copy", mode: "local" } as const;
    const [first, second] = await Promise.all([core.github.use(input), core.github.use(input)]);
    expect(first.id).toBe(second.id);
    expect(first).toMatchObject({
      kind: "folder",
      path: copy,
      gitUrl: "https://github.com/me/with-copy.git",
    });
    expect((await core.github.use(input)).id).toBe(first.id);
    expect((await core.projects.list()).filter((project) => project.gitUrl)).toHaveLength(1);
  });

  it("shows the project on the repo right after use, without another gh call", async () => {
    const { core, gh } = await worldWithCopy();
    const before = (await core.github.repos())[0];
    expect(before).toMatchObject({ localPath: expect.any(String), projectId: null });
    const project = await core.github.use({ nameWithOwner: "me/with-copy", mode: "local" });
    expect((await core.github.repos())[0]?.projectId).toBe(project.id);
    expect(apiCalls(gh)).toHaveLength(1);
    await core.projects.remove(project.id);
    expect((await core.github.repos())[0]?.projectId).toBeNull();
  });

  it("names the project after the repository, not the folder", async () => {
    const world = await openWorld({
      status: connected(),
      repos: [repo("me/with-copy", "2026-01-01T00:00:00Z")],
    });
    const copy = await makeLocalRepo(join(world.code, "nested"), "short");
    await addRemote(copy, "git@github.com:me/with-copy.git");
    const project = await world.core.github.use({ nameWithOwner: "me/with-copy", mode: "local" });
    expect(project.name).toBe("with-copy");
  });

  it("never clones a repository that has a local copy made after the scan", async () => {
    const world = await openWorld({ status: connected(), repos: [repo("me/late", "2026-01-01T00:00:00Z")] });
    expect((await world.core.github.repos())[0]?.localPath).toBeNull();
    const copy = await makeLocalRepo(world.code, "late");
    await addRemote(copy, "git@github.com:me/late.git");
    const project = await world.core.github.use({ nameWithOwner: "me/late", mode: "clone" });
    expect(project).toMatchObject({ kind: "folder", path: copy, name: "late" });
    expect(await readdir(world.code)).toEqual(["late"]);
  });

  it("answers needs_folder without a local copy and not_found for an unknown repo", async () => {
    const world = await openWorld({ status: connected(), repos: [repo("me/none", "2026-01-01T00:00:00Z")] });
    await expect(world.core.github.use({ nameWithOwner: "me/none", mode: "local" })).rejects.toMatchObject({
      code: "needs_folder",
    });
    await expect(world.core.github.use({ nameWithOwner: "me/other", mode: "clone" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("uses a folder whose remote matches, or has none, and rejects another repository", async () => {
    const world = await openWorld({
      status: connected(),
      repos: [repo("me/target", "2026-01-01T00:00:00Z")],
    });
    const other = await makeLocalRepo(await tempDir(), "other");
    await addRemote(other, "https://github.com/someone/else.git");
    await expect(
      world.core.github.use({ nameWithOwner: "me/target", mode: "folder", path: other }),
    ).rejects.toMatchObject({ code: "remote_mismatch" });
    const matching = await makeLocalRepo(await tempDir(), "elsewhere");
    await addRemote(matching, "ssh://git@ssh.github.com:443/ME/Target");
    const project = await world.core.github.use({
      nameWithOwner: "me/target",
      mode: "folder",
      path: matching,
    });
    expect(project).toMatchObject({ kind: "folder", path: matching });
  });

  it("requires a path in folder mode", async () => {
    const world = await openWorld({
      status: connected(),
      repos: [repo("me/target", "2026-01-01T00:00:00Z")],
    });
    await expect(world.core.github.use({ nameWithOwner: "me/target", mode: "folder" })).rejects.toMatchObject(
      {
        code: "invalid_request",
      },
    );
  });

  it("clones into the code folder as a git project", async () => {
    const root = await tempDir();
    const bare = join(root, "remote.git");
    await run("git", ["init", "--bare", bare]);
    const world = await openWorld({
      status: connected(),
      repos: [repo("me/cloned", "2026-01-01T00:00:00Z", { clone_url: bare })],
    });
    const project = await world.core.github.use({ nameWithOwner: "me/cloned", mode: "clone" });
    expect(project).toMatchObject({ kind: "git", gitUrl: bare });
    expect(project.path.startsWith(world.code)).toBe(true);
  });
});

describe("local clone urls from gh", () => {
  it("are rejected by a real (non-faux) core even with the env var set", async () => {
    const root = await tempDir();
    const bare = join(root, "remote.git");
    await run("git", ["init", "--bare", bare]);
    const gh = runGhFromConfig(() => ({
      status: connected(),
      repos: [repo("me/local", "2026-01-01T00:00:00Z", { clone_url: bare })],
    }));
    const deps = { ...defaultCoreDependencies(), runGh: gh.run, ghPath: "/usr/bin/gh" };
    const core = await createCoreWith({ home: homeIn(root), faux: false }, deps);
    open.push(core);
    expect(await core.github.repos()).toEqual([]);
  });
});

describe("extraGitConfig", () => {
  const stubs = {} as never;
  const serviceFor = (status: FakeGhConfig["status"], ghPath: string | undefined) =>
    createGithubService({
      runGh: runGhFromConfig(() => ({ status, repos: [] })).run,
      ghPath,
      projects: stubs,
      clones: stubs,
      settings: stubs,
      changes: stubs,
      now: Date.now,
      allowFileClones: false,
      presentProject: stubs,
    });

  it("adds gh's credential helper for https github.com once connected", async () => {
    const service = serviceFor(connected(), "/usr/bin/gh");
    await service.status();
    expect(service.extraGitConfig("https://github.com/me/private.git")).toHaveLength(4);
    expect(service.extraGitConfig("git@github.com:me/private.git")).toEqual([]);
    expect(service.extraGitConfig("https://gitlab.com/me/x.git")).toEqual([]);
  });

  it("adds nothing when gh is not connected", async () => {
    const service = serviceFor({ state: "not_logged_in" }, "/usr/bin/gh");
    await service.status();
    expect(service.extraGitConfig("https://github.com/me/private.git")).toEqual([]);
  });
});
