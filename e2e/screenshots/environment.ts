import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, request } from "@playwright/test";
import { PROJECTS, SUBAGENT_REPLIES, THREADS } from "./demo";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(REPO, "packages/cli/dist/bin.js");
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "Demo",
  GIT_AUTHOR_EMAIL: "demo@example.com",
  GIT_COMMITTER_NAME: "Demo",
  GIT_COMMITTER_EMAIL: "demo@example.com",
};
const SERVER_START_ATTEMPTS = 100;
const SERVER_POLL_MS = 200;
const THREAD_SETTLE_ATTEMPTS = 100;

export interface DemoEnvironment {
  readonly url: string;
  /** Sign-in token: open `${url}/?token=${token}` in any browser. */
  readonly token: string;
  /** The signed-in cookie, for a browser context. */
  readonly storageState: Awaited<ReturnType<APIRequestContext["storageState"]>>;
  stop(): Promise<void>;
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env: { ...process.env, ...GIT_IDENTITY }, stdio: "ignore" });

function createRepository(root: string, name: string, files: Readonly<Record<string, string>>) {
  const path = join(root, "code", name);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(path, file)), { recursive: true });
    writeFileSync(join(path, file), content);
  }
  git(path, "init", "-q", "-b", "main");
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "Initial commit");
  return path;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(port: number, child: ChildProcess) {
  for (let attempt = 0; attempt < SERVER_START_ATTEMPTS; attempt++) {
    if (child.exitCode !== null) throw new Error("the demo server exited early");
    const up = await fetch(`http://127.0.0.1:${port}/`).then(
      () => true,
      () => false,
    );
    if (up) return;
    await sleep(SERVER_POLL_MS);
  }
  throw new Error("the demo server never came up");
}

function replyTable() {
  return Object.fromEntries([...SUBAGENT_REPLIES, ...THREADS].map(({ prompt, steps }) => [prompt, steps]));
}

async function seed(api: APIRequestContext) {
  const json = async (response: Awaited<ReturnType<APIRequestContext["get"]>>) => {
    if (!response.ok())
      throw new Error(`${response.url()} answered ${response.status()}: ${await response.text()}`);
    return response.status() === 204 ? undefined : response.json();
  };
  await json(await api.put("/api/providers/openrouter/key", { data: { key: "sk-or-v1-demo" } }));
  await json(await api.put("/api/settings/default-model", { data: { provider: "faux", modelId: "faux-1" } }));
}

async function addProjects(api: APIRequestContext, root: string) {
  const projects = new Map<string, string>();
  for (const { name, files } of PROJECTS) {
    const path = createRepository(root, name, files);
    const response = await api.post("/api/projects", { data: { path } });
    projects.set(name, ((await response.json()) as { id: string }).id);
  }
  return projects;
}

async function startThreads(api: APIRequestContext, projects: Map<string, string>) {
  for (const thread of THREADS) {
    const response = await api.post("/api/conversations", {
      data: {
        projectId: projects.get(thread.project),
        text: thread.prompt,
        requestId: `demo-${thread.title}`,
      },
    });
    const { id } = (await response.json()) as { id: string };
    await api.patch(`/api/conversations/${id}`, { data: { title: thread.title } });
    await untilIdle(api, id);
  }
}

async function untilIdle(api: APIRequestContext, id: string) {
  for (let attempt = 0; attempt < THREAD_SETTLE_ATTEMPTS; attempt++) {
    const all = (await (await api.get("/api/conversations")).json()) as Array<{ id: string; status: string }>;
    if (all.find((thread) => thread.id === id)?.status !== "running") return;
    await sleep(SERVER_POLL_MS);
  }
  throw new Error(`thread ${id} never finished`);
}

export async function startDemoEnvironment(): Promise<DemoEnvironment> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tau-shots-")));
  const home = join(root, "home");
  mkdirSync(home);
  const replies = join(root, "replies.json");
  writeFileSync(replies, JSON.stringify(replyTable()));
  const port = await freePort();
  const state = join(root, "state");
  const child = spawn(
    process.execPath,
    [CLI, "serve", "--faux", "--no-open", "--port", String(port), "--home", state],
    {
      env: {
        ...process.env,
        ...GIT_IDENTITY,
        HOME: home,
        TAU_FAUX_REPLIES: replies,
        TAU_FAKE_CLAUDE_CLI: "1",
      },
      stdio: "ignore",
    },
  );
  const stop = async () => {
    child.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  };
  try {
    await waitForServer(port, child);
    const token = readFileSync(join(state, "token"), "utf8").trim();
    const url = `http://127.0.0.1:${port}`;
    const api = await request.newContext({ baseURL: url, extraHTTPHeaders: { origin: url } });
    await api.get(`/?token=${encodeURIComponent(token)}`);
    await seed(api);
    await startThreads(api, await addProjects(api, root));
    const storageState = await api.storageState();
    await api.dispose();
    return { url, token, storageState, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
