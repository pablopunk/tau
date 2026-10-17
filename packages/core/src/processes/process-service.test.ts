import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConversationSummary } from "@pi-everywhere/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractLocalUrls } from "./local-urls";
import { createLogTail, lastLines } from "./log-tail";
import { groupIsAlive, sleep } from "./process-group";
import { createProcessService, type ProcessService } from "./process-service";

let home: string;
let cwd: string;
let changes: string[];
let service: ProcessService;

const makeService = () =>
  createProcessService({ home, emitChange: (id) => changes.push(id), stopGraceMs: 300 });

async function waitFor(check: () => Promise<boolean> | boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error("timed out");
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pi-proc-home-"));
  cwd = await mkdtemp(join(tmpdir(), "pi-proc-cwd-"));
  changes = [];
  service = makeService();
});

afterEach(async () => {
  await service.stopAll();
  await rm(home, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

describe("process service", () => {
  it("starts in the given folder, captures logs and stops", async () => {
    const info = await service.start({ conversationId: "c1", cwd, command: "pwd; sleep 30" });
    expect(info).toMatchObject({ state: "running", exitCode: null });
    await waitFor(async () => (await service.logs(info.id, 5)).includes("pi-proc-cwd-"));
    await service.stop(info.id);
    await service.stop(info.id);
    expect((await service.list("c1"))[0]).toMatchObject({ state: "killed", exitCode: null });
    expect(changes.length).toBeGreaterThan(1);
  });

  it("marks a finished process exited with its code", async () => {
    const info = await service.start({ conversationId: "c1", cwd, command: "echo hi; exit 3" });
    await waitFor(async () => (await service.list("c1"))[0]?.state === "exited");
    expect((await service.list("c1"))[0]?.exitCode).toBe(3);
    expect(await service.logs(info.id, 5)).toBe("hi");
  });

  it("kills the whole group, including a child of a child", async () => {
    const info = await service.start({
      conversationId: "c1",
      cwd,
      command: "sh -c 'sleep 60 & echo $! ; wait'; wait",
    });
    await waitFor(async () => /^\d+/.test(await service.logs(info.id, 1)));
    const grandchild = Number((await service.logs(info.id, 1)).trim());
    expect(() => process.kill(grandchild, 0)).not.toThrow();
    await service.stop(info.id);
    await waitFor(() => !isAlive(grandchild));
  });

  it("parses local URLs from logs, ignoring colors", async () => {
    const info = await service.start({
      conversationId: "c1",
      cwd,
      command: "printf '\\033[32mready\\033[0m at \\033[36mhttp://localhost:5173/\\033[0m\\n'; sleep 30",
    });
    await waitFor(async () => (await service.list("c1"))[0]?.urls.length === 1);
    expect((await service.list("c1"))[0]?.urls).toEqual(["http://localhost:5173/"]);
    await service.stop(info.id);
  });

  it("keeps only a bounded tail in memory", () => {
    const tail = createLogTail(10);
    tail.append("0123456789abcdef");
    expect(tail.text()).toBe("6789abcdef");
    expect(lastLines("a\nb\nc\n", 2)).toBe("b\nc");
  });

  it("extracts every local host form", () => {
    const text = "http://127.0.0.1:1 https://0.0.0.0:2/x http://[::1]:3 http://example.com:4";
    expect(extractLocalUrls(text)).toEqual(["http://127.0.0.1:1", "https://0.0.0.0:2/x", "http://[::1]:3"]);
  });

  it("reaps a live group left by an earlier run and marks it killed", async () => {
    const info = await service.start({ conversationId: "c1", cwd, command: "sleep 60" });
    const pidFile = join(home, "processes", `${info.id}.json`);
    const { pid } = JSON.parse(await readFile(pidFile, "utf8")) as { pid: number };
    const later = makeService();
    await later.reapStaleAtStartup();
    await waitFor(() => !groupIsAlive(pid));
    expect((await later.list("c1"))[0]).toMatchObject({ id: info.id, state: "killed" });
    await service.stopAll();
  });

  it("deletes logs and pid files when the thread goes away", async () => {
    const info = await service.start({ conversationId: "c1", cwd, command: "echo x; sleep 30" });
    await waitFor(async () => (await service.logs(info.id, 1)) === "x");
    await service.onConversationRemoved({ id: "c1" } as ConversationSummary);
    expect(await service.list("c1")).toEqual([]);
    expect(await exists(join(home, "processes", `${info.id}.json`))).toBe(false);
    expect(await exists(join(home, "processes", `${info.id}.log`))).toBe(false);
  });

  it("rejects unknown ids with not_found", async () => {
    await expect(service.stop("nope")).rejects.toMatchObject({ code: "not_found" });
    await expect(service.logs("nope", 1)).rejects.toMatchObject({ code: "not_found" });
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
