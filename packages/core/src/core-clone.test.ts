import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Core, Project } from "@pi-everywhere/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CoreDependencies, createCoreWith, defaultCoreDependencies } from "./create-core";
import { installFakeGit, isAlive } from "./test-support/fake-git";
import { makeLocalRepo } from "./test-support/local-repo";
import { useTempDir } from "./test-support/temp-dir";

const tempDir = useTempDir();
const ALLOW_FILES = { ...process.env, PI_EVERYWHERE_ALLOW_FILE_CLONES: "1" };

let root: string;
let cores: Core[];

const open = async (env: CoreDependencies["env"] = ALLOW_FILES, faux = true) => {
  const core = await createCoreWith(
    { home: join(root, "home"), faux },
    { ...defaultCoreDependencies(), env },
  );
  cores.push(core);
  return core;
};

const projectOf = async (core: Core, id: string) => {
  const found = (await core.projects.list()).find((project) => project.id === id);
  if (!found) throw new Error("project is gone");
  return found;
};

const waitForStatus = (core: Core, id: string, status: Project["status"]) =>
  vi.waitFor(async () => expect((await projectOf(core, id)).status).toBe(status), { timeout: 15_000 });

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  root = await tempDir();
  cores = [];
});

afterEach(async () => {
  await Promise.all(cores.map((core) => core.close()));
  vi.restoreAllMocks();
});

describe("cloning against a local repository", () => {
  it("clones into the projects folder and ends ready with the real path", async () => {
    const core = await open();
    const url = await makeLocalRepo(join(root, "remotes"), "demo");
    const cloning = await core.projects.clone({ url });
    expect(cloning).toMatchObject({ kind: "git", status: "cloning", name: "demo", gitUrl: url });
    expect(cloning.path).toBe(join(root, "home", "projects", "demo"));
    await waitForStatus(core, cloning.id, "ready");
    expect(await readFile(join(cloning.path, "hello.txt"), "utf8")).toBe("hello");
  });

  it("claims -2 for a second repository with the same folder name", async () => {
    const core = await open();
    const first = await core.projects.clone({ url: await makeLocalRepo(join(root, "a"), "same") });
    const second = await core.projects.clone({ url: await makeLocalRepo(join(root, "b"), "same") });
    expect(second.path).toBe(`${first.path}-2`);
    await waitForStatus(core, first.id, "ready");
    await waitForStatus(core, second.id, "ready");
  });

  it("uses the projects folder from settings and an explicit name", async () => {
    const core = await open();
    const folder = join(root, "elsewhere", "deep");
    await core.settings.setProjectsFolder(folder);
    const project = await core.projects.clone({
      url: await makeLocalRepo(join(root, "r"), "x"),
      name: " Mine ",
    });
    expect(project).toMatchObject({ name: "Mine", path: join(folder, "x") });
    await waitForStatus(core, project.id, "ready");
  });

  it("rejects a duplicate of the same repository, spelled differently", async () => {
    const core = await open();
    const url = await makeLocalRepo(join(root, "remotes"), "dup");
    const first = await core.projects.clone({ url });
    await expect(core.projects.clone({ url: `${url}/` })).rejects.toMatchObject({
      code: "duplicate_project",
    });
    await waitForStatus(core, first.id, "ready");
  });

  it("fails with the last stderr line, deletes the claimed folder and retries into the same path", async () => {
    const core = await open();
    const failing = await core.projects.clone({ url: "https://127.0.0.1:1/fail.git" });
    await waitForStatus(core, failing.id, "failed");
    expect((await projectOf(core, failing.id)).error).toEqual(expect.any(String));
    expect(await exists(failing.path)).toBe(false);
    await core.projects.retryClone(failing.id);
    expect((await projectOf(core, failing.id)).path).toBe(failing.path);
    await waitForStatus(core, failing.id, "failed");
  });

  it("rejects file URLs unless the faux core allows them", async () => {
    const url = await makeLocalRepo(join(root, "remotes"), "local");
    const realMode = await open(ALLOW_FILES, false);
    await expect(realMode.projects.clone({ url })).rejects.toMatchObject({ code: "invalid_git_url" });
    await realMode.close();
    const fauxWithoutFlag = await open({ ...process.env, PI_EVERYWHERE_ALLOW_FILE_CLONES: undefined });
    await expect(fauxWithoutFlag.projects.clone({ url })).rejects.toMatchObject({ code: "invalid_git_url" });
  });

  it.each([
    "-x",
    "ext::sh -c touch% /tmp/pwned",
    "a::b",
    "https://example.com/../x",
    "https://user:pw@example.com/x.git",
  ])("rejects %s and leaves no folder behind", async (url) => {
    const core = await open();
    await expect(core.projects.clone({ url })).rejects.toMatchObject({ code: "invalid_git_url" });
    expect(await exists(join(root, "home", "projects"))).toBe(false);
  });

  it("reports git_missing when git cannot run", async () => {
    const core = await open({ ...process.env, PATH: join(root, "empty-bin") });
    await expect(core.projects.clone({ url: "https://example.com/x.git" })).rejects.toMatchObject({
      code: "git_missing",
    });
  });
});

describe("a clone that hangs", () => {
  const startHanging = async () => {
    const fake = await installFakeGit(root);
    const core = await open(fake.env(ALLOW_FILES));
    const project = await core.projects.clone({ url: "https://example.com/hang.git" });
    await vi.waitFor(() => stat(join(fake.stateDir, "sleeper.pid")));
    const pid = async (name: string) => Number(await readFile(join(fake.stateDir, name), "utf8"));
    return { fake, core, project, pid };
  };

  it("is killed with its process group, and its folder deleted, when the project is removed", async () => {
    const { core, project, pid } = await startHanging();
    const [git, sleeper] = [await pid("git.pid"), await pid("sleeper.pid")];
    expect(isAlive(git)).toBe(true);
    await core.projects.remove(project.id);
    await vi.waitFor(() => expect([isAlive(git), isAlive(sleeper)]).toEqual([false, false]));
    await vi.waitFor(async () => expect(await exists(project.path)).toBe(false));
    expect((await core.projects.list()).map((item) => item.id)).not.toContain(project.id);
  });

  it("is marked failed and cleaned up at the next startup, so a retry reuses the path", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { core, project, pid } = await startHanging();
    const sleeper = await pid("sleeper.pid");
    await core.close();
    process.kill(-(await pid("git.pid")), "SIGKILL");
    await vi.waitFor(() => expect(isAlive(sleeper)).toBe(false));
    await vi.waitFor(async () => expect(await exists(project.path)).toBe(false));
    await mkdir(project.path, { recursive: true });
    await writeFile(join(project.path, "partial"), "x");
    const reopened = await open();
    const recovered = await projectOf(reopened, project.id);
    expect(recovered).toMatchObject({
      status: "failed",
      error: "Interrupted by a restart",
      path: project.path,
    });
    expect(await exists(project.path)).toBe(false);
    await reopened.projects.retryClone(project.id);
    expect((await projectOf(reopened, project.id)).path).toBe(project.path);
  });
});
