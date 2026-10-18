import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Change, ConversationSummary } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { createChangeEmitter } from "../change-emitter";
import {
  createFakeTerminalDaemon,
  type FakeTerminalDaemon,
  type FakeTerminalHandle,
} from "./fake-terminal-daemon";
import { createTerminalService } from "./terminal-service";

const text = (chunks: Uint8Array[]) => chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");
const encode = (value: string) => new TextEncoder().encode(value);
const none = { onData: () => undefined, onExit: () => undefined };

function thread(id: string, path: string, over: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id,
    projectId: "p",
    parentId: null,
    workspace: {
      mode: "checkout",
      path,
      branch: null,
      base: null,
      state: "ready",
      mergedSha: null,
      pullRequestUrl: null,
    },
    ...over,
  } as ConversationSummary;
}

async function setup(options: { env?: Record<string, string>; daemon?: FakeTerminalDaemon } = {}) {
  const folder = await mkdtemp(join(tmpdir(), "tau-term-"));
  const threads = new Map<string, ConversationSummary>([
    ["t1", thread("t1", folder)],
    ["t2", thread("t2", folder)],
  ]);
  const daemon = options.daemon ?? createFakeTerminalDaemon();
  const changes = createChangeEmitter();
  const seen: Change[] = [];
  changes.subscribe((change) => seen.push(change));
  const service = createTerminalService({
    daemon,
    changes,
    conversations: {
      find: async (id) => threads.get(id),
      list: async () => [...threads.values()],
    },
    home: "/tau-home",
    env: options.env ?? {
      PATH: "/usr/bin",
      SECRET_TOKEN: "x",
      SHELL: "/bin/zsh",
      LC_ALL: "C",
      XDG_DATA_HOME: "/d",
    },
    titleIntervalMs: 10,
  });
  return { service, daemon, threads, seen, folder, api: service.api };
}

function firstTerminal(daemon: FakeTerminalDaemon): FakeTerminalHandle {
  const handle = daemon.terminals[0];
  if (!handle) throw new Error("no terminal was opened");
  return handle;
}

const dims = { cols: 80, rows: 24 };

describe("terminal service: open and environment", () => {
  it("opens in the thread's folder with an allow-listed environment", async () => {
    const { api, daemon, folder } = await setup();
    const info = await api.open("t1", dims);
    const options = daemon.terminals[0]?.options;
    expect(options?.cwd).toBe(folder);
    expect(options?.env).toEqual({
      PATH: "/tau-home/bin:/usr/bin",
      SHELL: "/bin/zsh",
      LC_ALL: "C",
      XDG_DATA_HOME: "/d",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      TAU_HOME: "/tau-home",
      TAU_THREAD_ID: "t1",
    });
    expect(info).toMatchObject({ conversationId: "t1", title: "zsh", status: "running", exitCode: null });
  });

  it("falls back to /bin/sh without SHELL", async () => {
    const { api, daemon } = await setup({ env: { PATH: "/bin" } });
    const info = await api.open("t1", dims);
    expect(daemon.terminals[0]?.options.env.SHELL).toBe("/bin/sh");
    expect(info.title).toBe("sh");
  });

  it("cwdOf order: unknown, removed, missing folder", async () => {
    const { api, threads, folder } = await setup();
    await expect(api.open("nope", dims)).rejects.toMatchObject({ code: "not_found" });
    threads.set("r", thread("r", folder));
    const ready = threads.get("r") as ConversationSummary;
    threads.set("r", { ...ready, workspace: { ...ready.workspace, state: "removed" } });
    await expect(api.open("r", dims)).rejects.toMatchObject({ code: "invalid_request" });
    threads.set("m", thread("m", join(folder, "gone")));
    await expect(api.open("m", dims)).rejects.toMatchObject({ code: "invalid_request" });
    await mkdir(join(folder, "gone"));
    await expect(api.open("m", dims)).resolves.toBeTruthy();
  });

  it("is unavailable with the kill switch: not_found, nothing opens", async () => {
    const { api, daemon } = await setup({ daemon: createFakeTerminalDaemon(false) });
    expect(await api.available()).toBe(false);
    await expect(api.open("t1", dims)).rejects.toMatchObject({ code: "not_found" });
    await expect(api.list("t1")).rejects.toMatchObject({ code: "not_found" });
    expect(daemon.terminals).toHaveLength(0);
  });

  it("limits 8 per thread and 32 in total", async () => {
    const { api } = await setup();
    for (let count = 0; count < 8; count++) await api.open("t1", dims);
    await expect(api.open("t1", dims)).rejects.toMatchObject({ code: "invalid_request" });
    for (let count = 0; count < 8; count++) await api.open("t2", dims);
  });

  it("limits 32 in total", async () => {
    const { api, threads, folder } = await setup();
    for (let index = 0; index < 4; index++) threads.set(`x${index}`, thread(`x${index}`, folder));
    for (let index = 0; index < 4; index++) for (let n = 0; n < 8; n++) await api.open(`x${index}`, dims);
    await expect(api.open("t1", dims)).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("terminal service: replay and attach", () => {
  it("replays ESC c, the mode prefix and the ring to the new client only, then goes live", async () => {
    const { api, daemon } = await setup();
    const info = await api.open("t1", dims);
    const handle = firstTerminal(daemon);
    handle.output("\x1b[?1049hhello");
    const first: Uint8Array[] = [];
    await api.attach(info.id, { onData: (d) => first.push(d), onExit: () => undefined });
    const before = text(first);
    expect(before.startsWith("\x1bc\x1b[?1049h")).toBe(true);
    expect(before.endsWith("hello")).toBe(true);
    const second: Uint8Array[] = [];
    await api.attach(info.id, { onData: (d) => second.push(d), onExit: () => undefined });
    expect(text(first)).toBe(before);
    handle.output("live");
    expect(text(first).endsWith("live")).toBe(true);
    expect(text(second).endsWith("hellolive")).toBe(true);
  });

  it("keeps the newest 256 KB and replays in frames of at most 64 KB", async () => {
    const { api, daemon } = await setup();
    const info = await api.open("t1", dims);
    const line = `${"x".repeat(1023)}\n`;
    for (let index = 0; index < 400; index++) daemon.terminals[0]?.output(`${index} ${line}`);
    const frames: Uint8Array[] = [];
    await api.attach(info.id, { onData: (d) => frames.push(d), onExit: () => undefined });
    expect(frames.slice(1).every((frame) => frame.length <= 64 * 1024)).toBe(true);
    const replay = text(frames.slice(1));
    expect(replay.length).toBeLessThanOrEqual(256 * 1024);
    expect(replay).toContain("399 ");
    expect(replay).not.toContain("\n0 ");
  });

  it("forwards writes", async () => {
    const { api, daemon } = await setup();
    const info = await api.open("t1", dims);
    const attachment = await api.attach(info.id, none);
    attachment.write(encode("ls\r"));
    expect(daemon.terminals[0]?.written).toEqual(["ls\r"]);
  });
});

describe("terminal service: size owner and repaint", () => {
  it("gives the PTY size to the newest client that resized, with handover on detach", async () => {
    const { api, daemon } = await setup();
    const info = await api.open("t1", dims);
    const sizes = firstTerminal(daemon).sizes;
    const one = await api.attach(info.id, none);
    one.resize(100, 30);
    const two = await api.attach(info.id, none);
    expect(sizes.at(-1)).toEqual([100, 30]);
    one.resize(110, 31);
    expect(sizes.at(-1)).toEqual([110, 31]);
    two.resize(120, 40);
    expect(sizes.at(-1)).toEqual([120, 40]);
    one.resize(90, 20);
    expect(sizes.at(-1)).toEqual([120, 40]);
    two.detach();
    expect(sizes.at(-1)).toEqual([90, 20]);
  });

  it("repaints with cols+1 and back when the first size equals the PTY's and a job runs", async () => {
    const { api, daemon } = await setup();
    const info = await api.open("t1", dims);
    const handle = firstTerminal(daemon);
    handle.foregroundName = "vim";
    const client = await api.attach(info.id, none);
    client.resize(80, 24);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(handle.sizes.slice(1)).toEqual([
      [81, 24],
      [80, 24],
    ]);
  });

  it("sends nothing for an equal size at a plain prompt, and a plain resize when it differs", async () => {
    const { api, daemon } = await setup();
    const info = await api.open("t1", dims);
    const handle = firstTerminal(daemon);
    const client = await api.attach(info.id, none);
    client.resize(80, 24);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(handle.sizes).toHaveLength(1);
    const other = await api.attach(info.id, none);
    other.resize(90, 24);
    expect(handle.sizes.slice(1)).toEqual([[90, 24]]);
  });
});

describe("terminal service: lifecycle", () => {
  it("drops the record at once on a clean exit and emits a change", async () => {
    const { api, daemon, seen } = await setup();
    const info = await api.open("t1", dims);
    const exits: Array<number | null> = [];
    await api.attach(info.id, { onData: () => undefined, onExit: (code) => exits.push(code) });
    seen.length = 0;
    daemon.terminals[0]?.exit(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(exits).toEqual([0]);
    expect(await api.list("t1")).toEqual([]);
    expect(seen).toContainEqual({ resource: "terminals", conversationId: "t1" });
    await api.close(info.id);
  });

  it("marks a non-zero exit, emits a change and keeps the record", async () => {
    const { api, daemon, seen } = await setup();
    const info = await api.open("t1", dims);
    const exits: Array<number | null> = [];
    await api.attach(info.id, { onData: () => undefined, onExit: (code) => exits.push(code) });
    daemon.terminals[0]?.exit(3);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(exits).toEqual([3]);
    expect(await api.list("t1")).toMatchObject([{ status: "exited", exitCode: 3 }]);
    expect(seen).toContainEqual({ resource: "terminals", conversationId: "t1" });
  });

  it("close is idempotent, closeAllOf keys on the id only, and children are closed on removal", async () => {
    const { api, service, daemon, threads, folder } = await setup();
    threads.set("kid", thread("kid", folder, { parentId: "t1" }));
    const a = await api.open("t1", dims);
    await api.open("kid", dims);
    await api.open("t2", dims);
    await api.close(a.id);
    await api.close(a.id);
    expect((await api.list("t1")).map((terminal) => terminal.id)).not.toContain(a.id);
    await expect(api.close("nope")).rejects.toMatchObject({ code: "not_found" });
    await service.onConversationRemoved(threads.get("t1") as ConversationSummary);
    expect(daemon.terminals.map((handle) => handle.closed)).toEqual([true, true, false]);
    threads.clear();
    await service.closeAllOf("t2");
    expect(daemon.terminals[2]?.closed).toBe(true);
  });

  it("titles follow the foreground job only while a client is attached", async () => {
    const { api, daemon, seen } = await setup();
    const info = await api.open("t1", dims);
    const handle = firstTerminal(daemon);
    handle.foregroundName = "sleep";
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect((await api.list("t1"))[0]?.title).toBe("zsh");
    const client = await api.attach(info.id, none);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect((await api.list("t1"))[0]?.title).toBe("sleep");
    expect(seen.filter((change) => change.resource === "terminals")).toHaveLength(2);
    handle.foregroundName = undefined;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect((await api.list("t1"))[0]?.title).toBe("zsh");
    client.detach();
  });

  it("closes the daemon at close()", async () => {
    const { service, daemon } = await setup();
    await service.close();
    expect(daemon.closedCount()).toBe(1);
  });
});
