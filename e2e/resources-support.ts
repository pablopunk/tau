import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type APIRequestContext, request } from "@playwright/test";
import {
  decodeServerFrame,
  encodeFrame,
  LIVE_PATH,
  nextViewState,
  type ViewState,
} from "../packages/protocol/src/index";
import { createRestartableServer, type RestartableServer } from "./restartable-server";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

export type Power = "off" | "balanced" | "background";

/** Phase 1: persisted only, never enforced. Staging gate: everything stays off. */
export interface SandboxValues {
  main: boolean;
  worktree: boolean;
  subagent: boolean;
}

export const SANDBOX_OFF: SandboxValues = {
  main: false,
  worktree: false,
  subagent: false,
};

export async function sandboxSupportOf(api: APIRequestContext): Promise<Record<string, unknown>> {
  return (await (await api.get("/api/settings/resources/support")).json()) as Record<string, unknown>;
}

export interface ResourceValues {
  levels: { main: Power; worktree: Power; subagent: Power };
}

export const OFF: ResourceValues = {
  levels: { main: "off", worktree: "off", subagent: "off" },
};

export const ALL = (level: Power): ResourceValues => ({
  levels: { main: level, worktree: level, subagent: level },
});

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
  setSandbox(next: Partial<SandboxValues>): Promise<void>;
  activity(): Promise<Activity>;
  waitActivity(check: (value: Activity) => boolean, ms?: number): Promise<Activity>;
  start(prompt: string, options?: { mode?: "worktree" | "checkout" }): Promise<string>;
  read(id: string): Promise<string>;
  toolCallIds(id: string): Promise<string[]>;
  /** The text of every tool result in the thread, in order (the model-visible output). */
  toolOutputs(id: string): Promise<string[]>;
  waitIdle(id: string, seconds?: number): Promise<string>;
  restart(): Promise<void>;
  /** SIGKILL the server (no shutdown hooks), then start it again on the same home. */
  crash(): Promise<void>;
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
  /** An existing git folder to add as the project instead of a fresh demo repo. */
  repo?: string;
  env?: Record<string, string>;
}): Promise<ResourceServer> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tau-resv-")));
  const repo = options.repo ?? demoRepo(root);
  writeFileSync(join(root, "replies.json"), JSON.stringify(options.replies));
  const port = await freePort();
  const home = join(root, "tau-home");
  mkdirSync(home);
  mkdirSync(join(root, "os-home"));
  const binary = process.env.TAU_E2E_BINARY;
  const stubs = join(root, "stubs");
  if (binary) {
    mkdirSync(stubs);
    for (const name of ["launchctl", "systemctl"]) {
      writeFileSync(join(stubs, name), "#!/bin/sh\nexit 1\n");
      chmodSync(join(stubs, name), 0o755);
    }
  }
  const server = createRestartableServer({
    port,
    home,
    command: options.command ?? (binary ? { file: binary, args: [] } : undefined),
    env: {
      ...(binary && { PATH: `${stubs}:${process.env.PATH ?? ""}` }),
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
  const projectId = (
    (await (await api.post("/api/projects", { data: { path: repo } })).json()) as { id: string }
  ).id;
  let counter = 0;
  const activity = async () => (await (await api.get("/api/settings/resources/activity")).json()) as Activity;
  const viewEntries = async (id: string) => {
    const token = readFileSync(join(home, "token"), "utf8").trim();
    const socket = new (WebSocket as unknown as new (url: string, options: object) => WebSocket)(
      `${baseURL.replace(/^http/, "ws")}${LIVE_PATH}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    let view: ViewState;
    const done = new Promise<void>((resolve, reject) => {
      socket.onopen = () => socket.send(encodeFrame({ type: "subscribe", conversationId: id }));
      socket.onerror = () => reject(new Error("socket error"));
      socket.onmessage = (event) => {
        const frame = decodeServerFrame(String(event.data));
        if (frame?.type !== "ops") return;
        view = nextViewState(view, frame.ops);
        resolve();
      };
    });
    await done;
    socket.close();
    return view?.entries;
  };
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
    async setSandbox(next) {
      const response = await api.put("/api/settings/sandbox", { data: { ...SANDBOX_OFF, ...next } });
      if (!response.ok()) throw new Error(`setSandbox ${response.status()} ${await response.text()}`);
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
      const data: Record<string, unknown> = {
        projectId,
        text: prompt,
        requestId: `r-${counter++}-${Date.now()}`,
      };
      if (startOptions?.mode) data.workspace = startOptions.mode;
      const response = await api.post("/api/conversations", { data });
      if (!response.ok()) throw new Error(`start ${response.status()} ${await response.text()}`);
      return ((await response.json()) as { id: string }).id;
    },
    read: (id) => server.tau("threads", "read", id),
    async toolCallIds(id) {
      const entries = (await viewEntries(id)) ?? [];
      return entries.flatMap((entry) => {
        const content = (entry.model?.[0] as { content?: unknown } | undefined)?.content;
        if (!Array.isArray(content)) return [];
        return content
          .filter((block: { type?: string }) => block.type === "toolCall")
          .map((block: { id: string }) => block.id);
      });
    },
    async toolOutputs(id) {
      const entries = (await viewEntries(id)) ?? [];
      return entries
        .filter((entry) => entry.kind === "pi.tool-result")
        .map((entry) => {
          const content = (entry.model?.[0] as { content?: { type: string; text?: string }[] } | undefined)
            ?.content;
          return (content ?? []).map((block) => block.text ?? "").join("");
        });
    },
    async waitIdle(id, seconds = 120) {
      const end = Date.now() + seconds * 1000;
      await sleep(500);
      while (Date.now() < end) {
        const all = (await (await api.get("/api/conversations")).json()) as { id: string; status: string }[];
        const status = all.find((thread) => thread.id === id)?.status;
        if (status !== undefined && status !== "running") break;
        await sleep(1000);
      }
      return server.tau("threads", "read", id);
    },
    async restart() {
      await server.restart();
      api = await request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
      await login();
    },
    async crash() {
      const pids = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" })
        .split("\n")
        .filter(Boolean);
      for (const pid of pids) process.kill(Number(pid), "SIGKILL");
      await sleep(500);
      await server.start();
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
