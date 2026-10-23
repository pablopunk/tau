import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConversationSummary, Core } from "@tau/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CoreDependencies, createCoreWith, defaultCoreDependencies } from "./create-core";
import * as harnessOpen from "./harness/open";
import { RUNTIME_FORMAT_FILE } from "./harness/runtime-format";
import type { NativeQueryFn } from "./runtimes/native/controller";
import { homeIn, useTempDir } from "./test-support/temp-dir";
import { NO_UPDATE_OPTIONS } from "./test-support/update-options";

const tempDir = useTempDir();
const cores: Core[] = [];
const CLAUDE_INSTALLED: Partial<CoreDependencies> = { claudeCodeInstalled: async () => true };
const CLAUDE_MISSING: Partial<CoreDependencies> = { claudeCodeInstalled: async () => false };

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cores.splice(0).map((core) => core.close()));
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(read: () => Promise<T | undefined>, what: string): Promise<T> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

function countedAnswer() {
  let runs = 0;
  const query: NativeQueryFn = () => {
    runs += 1;
    const uuid = `run-${runs}`;
    return (async function* () {
      yield { type: "system", subtype: "init", session_id: "core-session", uuid: `${uuid}-init` };
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "ok",
        session_id: "core-session",
        uuid: `${uuid}-result`,
      };
    })();
  };
  return { query, runs: () => runs };
}

const startNativeOf = (core: Core) =>
  (core.conversations as { startNative?: (input: unknown) => Promise<ConversationSummary> }).startNative;

const manifestPath = (root: string) => join(homeIn(root), RUNTIME_FORMAT_FILE);

async function openCore(
  root: string,
  env: Record<string, string>,
  nativeQuery?: NativeQueryFn,
  installed: Partial<CoreDependencies> = {},
) {
  const core = await createCoreWith(
    { home: homeIn(root), faux: true, ...NO_UPDATE_OPTIONS },
    { ...defaultCoreDependencies(), env, ...installed, ...(nativeQuery && { nativeQuery }) },
  );
  cores.push(core);
  return core;
}

const manifest = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ formatVersion: 1, requiredCapabilities: [], writtenAt: 1, ...overrides });

async function seedManifest(root: string, text: string): Promise<void> {
  await mkdir(homeIn(root), { recursive: true });
  await writeFile(manifestPath(root), text);
}

describe("createCore refuses a runtime store it cannot read", () => {
  const unreadable: [string, string, string][] = [
    ["a newer format", manifest({ formatVersion: 2 }), "newer-format"],
    ["a missing capability", manifest({ requiredCapabilities: ["future-ledger"] }), "missing-capability"],
    ["a corrupt manifest", "{half a manifest", "corrupt"],
  ];

  it.each(unreadable)(
    "refuses %s before the harness opens, with Claude Code installed or not",
    async (_what, text, reason) => {
      for (const installed of [CLAUDE_MISSING, CLAUDE_INSTALLED]) {
        const root = await tempDir();
        await seedManifest(root, text);
        const opened = vi.spyOn(harnessOpen, "openAgentHarness");

        await expect(openCore(root, {}, countedAnswer().query, installed)).rejects.toMatchObject({
          code: "forbidden",
          message: expect.stringContaining(reason),
        });

        expect(opened).not.toHaveBeenCalled();
        expect(existsSync(join(homeIn(root), "agent.sqlite"))).toBe(false);
        expect(await readFile(manifestPath(root), "utf8")).toBe(text);
        opened.mockRestore();

        await rm(manifestPath(root));
        await expect(openCore(root, {}, countedAnswer().query, installed)).resolves.toBeDefined();
      }
    },
  );
});

describe("createCore and the format manifest", () => {
  it("starts with an absent manifest and, without Claude Code, never creates the file or a native thread", async () => {
    const root = await tempDir();
    const core = await openCore(root, {}, countedAnswer().query);
    await core.providers.setApiKey("openrouter", "sk-test");
    await core.settings.setDefaultModel({ provider: "faux", modelId: "faux-1" });
    const project = await core.projects.add({ path: root });
    await core.conversations.start({ projectId: project.id, text: "pi thread", requestId: "pi-1" });
    await core.close();
    cores.splice(cores.indexOf(core), 1);

    expect(existsSync(manifestPath(root))).toBe(false);
    expect((await readdir(homeIn(root))).filter((name) => name.includes("runtime-format"))).toEqual([]);
  });

  it("creates nothing with Claude Code installed until a native thread is started, and not for a Pi thread", async () => {
    const root = await tempDir();
    const core = await openCore(root, {}, countedAnswer().query, CLAUDE_INSTALLED);
    await core.providers.setApiKey("openrouter", "sk-test");
    await core.settings.setDefaultModel({ provider: "faux", modelId: "faux-1" });
    const project = await core.projects.add({ path: root });

    await core.conversations.start({ projectId: project.id, text: "pi thread", requestId: "pi-1" });

    expect(existsSync(manifestPath(root))).toBe(false);
  });

  it("writes the manifest before the first native conversation record, once", async () => {
    const root = await tempDir();
    const counted = countedAnswer();
    const core = await openCore(root, {}, counted.query, CLAUDE_INSTALLED);
    const project = await core.projects.add({ path: root });
    expect(existsSync(manifestPath(root))).toBe(false);

    const native = await startNativeOf(core)?.({ projectId: project.id, text: "one", requestId: "n-1" });
    const written = await readFile(manifestPath(root), "utf8");
    await startNativeOf(core)?.({ projectId: project.id, text: "two", requestId: "n-2" });

    expect(native?.executor).toBe("claude-code");
    expect(JSON.parse(written)).toEqual({
      formatVersion: 1,
      requiredCapabilities: [],
      writtenAt: expect.any(Number),
    });
    expect(await readFile(manifestPath(root), "utf8")).toBe(written);
  });

  it("starts again over the manifest a native thread wrote", async () => {
    const root = await tempDir();
    const core = await openCore(root, {}, countedAnswer().query, CLAUDE_INSTALLED);
    const project = await core.projects.add({ path: root });
    await startNativeOf(core)?.({ projectId: project.id, text: "one", requestId: "n-1" });
    await core.close();
    cores.splice(cores.indexOf(core), 1);

    const installedCore = await openCore(root, {}, countedAnswer().query, CLAUDE_INSTALLED);
    await installedCore.close();
    cores.splice(cores.indexOf(installedCore), 1);
    await expect(openCore(root, {}, countedAnswer().query)).resolves.toBeDefined();
  });
});

function initRepository(path: string): void {
  const git = (...args: string[]) => execFileSync("git", ["-C", path, ...args], { stdio: "ignore" });
  git("init", "--quiet");
  git(
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "first",
  );
}

const refsOf = (path: string, id: string): string[] =>
  execFileSync("git", ["-C", path, "for-each-ref", "--format=%(refname)", `refs/tau/${id}/`], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

async function openGitProject(installed: Partial<CoreDependencies>, query: NativeQueryFn) {
  const root = await tempDir();
  const repository = join(root, "repo");
  await mkdir(repository);
  initRepository(repository);
  const core = await openCore(root, {}, query, installed);
  const project = await core.projects.add({ path: repository });
  return { root, repository, core, project };
}

const lastRunEnded = (core: Core, projectId: string, id: string) =>
  waitFor(async () => {
    const found = (await core.conversations.list(projectId)).find((thread) => thread.id === id);
    return found === undefined || found.lastRunEndedAt === null ? undefined : found;
  }, "the native run to end");

describe("createCore native checkpoints", () => {
  it("snapshots before and after a native run in a git folder", async () => {
    const counted = countedAnswer();
    const { repository, core, project } = await openGitProject(CLAUDE_INSTALLED, counted.query);

    const native = await startNativeOf(core)?.({
      projectId: project.id,
      text: "work",
      requestId: "n-1",
      workspace: "checkout",
    });
    const id = native?.id ?? "";
    await lastRunEnded(core, project.id, id);
    await waitFor(async () => (refsOf(repository, id).length === 2 ? true : undefined), "before and after");

    expect(counted.runs()).toBe(1);
    expect(refsOf(repository, id)).toHaveLength(2);
  });

  it("blocks the run when the snapshot fails, spawns nothing, keeps the message and recovers on the next send", async () => {
    const counted = countedAnswer();
    const { root, repository, core, project } = await openGitProject(CLAUDE_INSTALLED, counted.query);
    const checkpointsFolder = join(homeIn(root), "checkpoints");
    await writeFile(checkpointsFolder, "in the way");

    const native = await startNativeOf(core)?.({
      projectId: project.id,
      text: "work",
      requestId: "n-1",
      workspace: "checkout",
    });
    const id = native?.id ?? "";
    await waitFor(
      async () =>
        (await core.conversations.list(project.id)).find((thread) => thread.id === id)?.status === "error"
          ? true
          : undefined,
      "the blocked thread",
    );
    await sleep(150);

    expect(counted.runs()).toBe(0);
    expect(refsOf(repository, id)).toEqual([]);

    await rm(checkpointsFolder);
    await core.conversations.send(id, { text: "retry", requestId: "n-2" });
    await waitFor(async () => (counted.runs() === 2 ? true : undefined), "both messages to run");
    await lastRunEnded(core, project.id, id);

    expect(refsOf(repository, id).length).toBeGreaterThanOrEqual(2);
  });
});

describe("createCore keeps Pi-only run-end consumers away from native threads", () => {
  it("never starts a goal or a loop on a native thread and records no goal for it", async () => {
    const root = await tempDir();
    const counted = countedAnswer();
    const core = await openCore(root, {}, counted.query, CLAUDE_INSTALLED);
    const project = await core.projects.add({ path: root });
    const native = await startNativeOf(core)?.({ projectId: project.id, text: "work", requestId: "n-1" });
    const id = native?.id ?? "";
    await lastRunEnded(core, project.id, id);

    await expect(core.goals.set(id, "ship it")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(core.timers.loop(id, { prompt: "poll" })).rejects.toMatchObject({ code: "invalid_request" });
    await sleep(100);

    expect(await core.goals.get(id)).toBeNull();
    expect(counted.runs()).toBe(1);
    expect((await core.conversations.list(project.id)).find((thread) => thread.id === id)).toMatchObject({
      status: "idle",
    });
  });
});
