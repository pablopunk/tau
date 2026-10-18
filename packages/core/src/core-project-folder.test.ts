import { execFileSync } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Project } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type FauxWorld,
  isRunning,
  openFauxWorld,
  trackView,
  waitForAnswer,
  waitUntil,
} from "./test-support/faux-core";
import { useTempDir } from "./test-support/temp-dir";

const tempDir = useTempDir();
let world: FauxWorld;

beforeEach(async () => {
  world = await openFauxWorld(await tempDir());
});

afterEach(() => world.core.close());

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", cwd, ...args], {
    encoding: "utf8",
  }).trim();

async function makeRepoFolder(name: string, seed = "one") {
  const path = await world.makeFolder(name);
  git(path, "init", "--quiet", "-b", "main");
  await writeFile(join(path, "file.txt"), seed);
  git(path, "add", ".");
  git(path, "commit", "--quiet", "-m", seed);
  return path;
}

async function setUpProject() {
  const { core } = world;
  await core.providers.setApiKey("openrouter", "sk-test");
  const [model] = await core.models.list();
  await core.settings.setDefaultModel({ provider: model?.provider ?? "", modelId: model?.modelId ?? "" });
  const path = await makeRepoFolder("old");
  const project = await core.projects.add({ path });
  return { project, path };
}

async function startThread(project: Project, workspace: "checkout" | "worktree", requestId: string) {
  const thread = await world.core.conversations.start({
    projectId: project.id,
    text: "hello",
    requestId,
    workspace,
  });
  const tracker = await trackView(world.core, thread.id);
  await waitForAnswer(tracker);
  await tracker.stop();
  return thread;
}

async function moveFolder(from: string, name: string) {
  const to = join(world.root, "projects", name);
  await rename(from, to);
  return to;
}

const threadsOf = async (project: Project) => world.core.conversations.list(project.id);

describe("projects.setFolder", () => {
  it("follows a folder that was moved first: checkout and worktree threads keep working", async () => {
    const { project, path } = await setUpProject();
    await startThread(project, "checkout", "r1");
    const worktreeThread = await startThread(project, "worktree", "r2");
    const moved = await moveFolder(path, "new");

    const updated = await world.core.projects.setFolder(project.id, moved);

    expect(updated.path).toBe(moved);
    const threads = await threadsOf(project);
    const checkout = threads.find((thread) => thread.workspace.mode === "checkout");
    expect(checkout?.workspace.path).toBe(moved);
    const worktree = threads.find((thread) => thread.id === worktreeThread.id);
    expect(() => git(worktree?.workspace.path ?? "", "status")).not.toThrow();
    expect(git(worktree?.workspace.path ?? "", "rev-parse", "--git-common-dir")).toContain(moved);
  });

  it("refuses while a thread is running and names the count", async () => {
    const { project, path } = await setUpProject();
    const thread = await startThread(project, "checkout", "r1");
    const tracker = await trackView(world.core, thread.id);
    await world.core.conversations.send(thread.id, { text: "bash sleep 30", requestId: "r2" });
    await waitUntil(() => isRunning(tracker.view()), "the run to start");
    const moved = await moveFolder(path, "new");
    await expect(world.core.projects.setFolder(project.id, moved)).rejects.toMatchObject({
      code: "thread_busy",
      message: expect.stringContaining("1 thread is running"),
    });
    await world.core.conversations.abort(thread.id);
    await tracker.stop();
  });

  it("is a no-op for the same path", async () => {
    const { project, path } = await setUpProject();
    expect((await world.core.projects.setFolder(project.id, path)).path).toBe(path);
  });

  it("rejects a folder that is not a repository", async () => {
    const { project, path } = await setUpProject();
    await startThread(project, "worktree", "r1");
    const moved = await moveFolder(path, "new");
    const plain = join(world.root, "projects", "plain");
    await mkdir(plain, { recursive: true });
    await expect(world.core.projects.setFolder(project.id, plain)).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect((await world.core.projects.list()).find((p) => p.id === project.id)?.path).toBe(path);
    expect(moved).toBeTruthy();
  });

  it("rejects a different repository while the old folder still exists", async () => {
    const { project } = await setUpProject();
    const other = await makeRepoFolder("other", "unrelated");
    await expect(world.core.projects.setFolder(project.id, other)).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("accepts the same repository copied elsewhere by root commit", async () => {
    const { project, path } = await setUpProject();
    const copy = join(world.root, "projects", "copy");
    git(world.root, "clone", "--quiet", path, copy);
    expect((await world.core.projects.setFolder(project.id, copy)).path).toBe(copy);
  });

  it("can be re-run to finish after a partial failure", async () => {
    const { project, path } = await setUpProject();
    await startThread(project, "checkout", "r1");
    const moved = await moveFolder(path, "new");
    const broken = join(world.root, "projects", "broken");
    await expect(world.core.projects.setFolder(project.id, broken)).rejects.toMatchObject({
      code: "path_not_found",
    });
    await world.core.projects.setFolder(project.id, moved);
    await world.core.projects.setFolder(project.id, moved);
    const [thread] = await threadsOf(project);
    expect(thread?.workspace.path).toBe(moved);
  });
});
