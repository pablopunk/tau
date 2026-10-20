import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type APIRequestContext, request } from "@playwright/test";
import { createRestartableServer, type RestartableServer } from "./restartable-server";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

export interface ResourceValues {
  priority: "off" | "balanced" | "background";
  heavySlots: number | null;
  memoryLimitMb: number | null;
  appliesTo: { main: boolean; worktrees: boolean; subagents: boolean };
}

export const OFF: ResourceValues = {
  priority: "off",
  heavySlots: null,
  memoryLimitMb: null,
  appliesTo: { main: true, worktrees: true, subagents: true },
};

export interface ActivityEntry {
  entryId: string;
  command: string;
}
export interface Activity {
  holders: ActivityEntry[];
  waiting: ActivityEntry[];
}

export type ReplyStep = { text?: string; tools?: { name: string; arguments: Record<string, unknown> }[] };

export const bash = (command: string, timeout?: number): ReplyStep => ({
  tools: [{ name: "bash", arguments: timeout ? { command, timeout } : { command } }],
});

/** One scripted thread: the prompt, a bash call, then a final text. */
export const bashThread = (command: string, timeout?: number): ReplyStep[] => [
  bash(command, timeout),
  { text: "finished" },
];

export interface ResourceServer {
  readonly root: string;
  readonly repo: string;
  readonly projectId: string;
  readonly server: RestartableServer;
  readonly api: APIRequestContext;
  setResources(next: Partial<ResourceValues>): Promise<void>;
  activity(): Promise<Activity>;
  waitActivity(check: (value: Activity) => boolean, ms?: number): Promise<Activity>;
  start(prompt: string, options?: { mode?: "worktree" | "checkout" }): Promise<string>;
  read(id: string): Promise<string>;
  waitIdle(id: string, seconds?: number): Promise<string>;
  restart(): Promise<void>;
  stop(): Promise<void>;
}

function demoRepo(root: string): string {
  const repo = join(root, "code");
  mkdirSync(repo);
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "E",
    GIT_AUTHOR_EMAIL: "e@e.io",
    GIT_COMMITTER_NAME: "E",
    GIT_COMMITTER_EMAIL: "e@e.io",
  };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore", env });
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# res\n");
  git("add", ".");
  git("commit", "-q", "-m", "first");
  return repo;
}

/** A detached faux server in a scratch home, scripted by `replies` (prompt text to steps). */
export async function startResourceServer(options: {
  replies: Record<string, ReplyStep[]>;
  command?: { file: string; args: string[] };
  env?: Record<string, string>;
}): Promise<ResourceServer> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tau-resv-")));
  const repo = demoRepo(root);
  writeFileSync(join(root, "replies.json"), JSON.stringify(options.replies));
  const port = await freePort();
  const home = join(root, "tau-home");
  mkdirSync(home);
  mkdirSync(join(root, "os-home"));
  const server = createRestartableServer({
    port,
    home,
    command: options.command,
    env: {
      HOME: join(root, "os-home"),
      TAU_FAUX_REPLIES: join(root, "replies.json"),
      TAU_FAKE_CLAUDE_CLI: "1",
      ...options.env,
    },
  });
  await server.start();
  const baseURL = `http://127.0.0.1:${port}`;
  let api = await request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
  const login = async () => {
    const token = readFileSync(join(home, "token"), "utf8").trim();
    await api.get(`/?token=${encodeURIComponent(token)}`);
  };
  await login();
  await api.put("/api/providers/openrouter/key", { data: { key: "sk-or-v1-faux" } });
  await api.put("/api/settings/default-model", { data: { provider: "faux", modelId: "faux-1" } });
  const projectId = ((await (await api.post("/api/projects", { data: { path: repo } })).json()) as { id: string })
    .id;
  let counter = 0;
  const activity = async () => (await (await api.get("/api/settings/resources/activity")).json()) as Activity;
  const result: ResourceServer = {
    root,
    repo,
    projectId,
    server,
    get api() {
      return api;
    },
    async setResources(next) {
      const response = await api.put("/api/settings/resources", { data: { ...OFF, ...next } });
      if (!response.ok()) throw new Error(`setResources ${response.status()} ${await response.text()}`);
    },
    activity,
    async waitActivity(check, ms = 30_000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const value = await activity();
        if (check(value)) return value;
        await sleep(150);
      }
      throw new Error(`activity never matched: ${JSON.stringify(await activity())}`);
    },
    async start(prompt, startOptions) {
      const data: Record<string, unknown> = { projectId, text: prompt, requestId: `r-${counter++}-${Date.now()}` };
      if (startOptions?.mode) data.workspace = { mode: startOptions.mode };
      const response = await api.post("/api/conversations", { data });
      if (!response.ok()) throw new Error(`start ${response.status()} ${await response.text()}`);
      return ((await response.json()) as { id: string }).id;
    },
    read: (id) => server.tau("threads", "read", id),
    async waitIdle(id, seconds = 120) {
      await server.tau("threads", "wait", id, "--timeout", String(seconds)).catch(() => undefined);
      return server.tau("threads", "read", id);
    },
    async restart() {
      await server.restart();
      api = await request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
      await login();
    },
    async stop() {
      await api.dispose();
      await server.stop().catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    },
  };
  return result;
}
