import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDetachedBackend, ForegroundHolderError, WAITING_TO_STOP_NOTICE } from "./detached";
import { createServiceManager } from "./manager";
import { buildSpec, pidFileOf } from "./spec";
import { CLI, createTestNode } from "./test-context";

type Signal = [number, string | undefined];

function setup(
  options: { lockPid?: number; filePid?: number; command?: string; dies?: "term" | "kill" | "never" } = {},
) {
  const sent: Signal[] = [];
  const state = { lock: options.lockPid, alive: new Set<number>(), notices: 0 };
  for (const pid of [options.lockPid, options.filePid]) if (pid !== undefined) state.alive.add(pid);
  const dies = options.dies ?? "term";
  const node = createTestNode({
    isAlive: (pid) => state.alive.has(pid),
    kill: (pid, signal) => {
      sent.push([pid, signal]);
      if ((signal === "SIGKILL" && dies !== "never") || (signal === "SIGTERM" && dies === "term")) {
        state.alive.delete(pid);
        if (state.lock === pid) state.lock = undefined;
      }
    },
    commandOf: async () => options.command,
  });
  const home = join(node.osHome, "home");
  mkdirSync(home, { recursive: true });
  if (options.filePid !== undefined) writeFileSync(pidFileOf(home), String(options.filePid));
  const spec = buildSpec(node.context, CLI, home);
  const backend = createDetachedBackend(node.context, {
    readLock: async () => (state.lock === undefined ? undefined : { pid: state.lock }),
    onWaiting: () => void state.notices++,
  });
  return { node, spec, backend, sent, state, home };
}

describe("detached waited stop", () => {
  it("signals the pid file pid when it holds the lock, then removes the file", async () => {
    const t = setup({ lockPid: 77, filePid: 77 });
    await t.backend.stop(t.spec);
    expect(t.sent).toEqual([[77, "SIGTERM"]]);
    expect(existsSync(pidFileOf(t.home))).toBe(false);
  });

  it("never signals an unrelated pid from a stale pid file", async () => {
    const t = setup({ filePid: 99 });
    await t.backend.stop(t.spec);
    expect(t.sent).toEqual([]);
    expect(existsSync(pidFileOf(t.home))).toBe(false);
  });

  it("with a stale file and a --service lock holder, stops the holder only", async () => {
    const t = setup({ lockPid: 77, filePid: 99, command: "node tau serve --service" });
    await t.backend.stop(t.spec);
    expect(t.sent).toEqual([[77, "SIGTERM"]]);
  });

  it("never signals a foreground holder, an empty command, or win32", async () => {
    for (const extra of [{ command: "node tau serve" }, { command: undefined }]) {
      const t = setup({ lockPid: 77, ...extra });
      await t.backend.stop(t.spec);
      expect(t.sent).toEqual([]);
    }
    const win = setup({ lockPid: 77, command: "tau --service" });
    const backend = createDetachedBackend(
      { ...win.node.context, platform: "win32" },
      { readLock: async () => ({ pid: 77 }) },
    );
    await backend.stop(win.spec);
    expect(win.sent).toEqual([]);
  });

  it("SIGKILLs after the budget when the same pid still holds the lock, with one notice", async () => {
    const t = setup({ lockPid: 77, filePid: 77, dies: "kill" });
    await t.backend.stop(t.spec);
    expect(t.sent).toEqual([
      [77, "SIGTERM"],
      [77, "SIGKILL"],
    ]);
    expect(t.state.notices).toBe(1);
    expect(WAITING_TO_STOP_NOTICE).toContain("closing its threads");
  });

  it("does not SIGKILL a replacement server that took the lock", async () => {
    const t = setup({ lockPid: 77, filePid: 77, dies: "never" });
    const sleep = t.node.context.sleep;
    let swapped = false;
    const context = {
      ...t.node.context,
      sleep: async (ms: number) => {
        await sleep(ms);
        if (!swapped) {
          swapped = true;
          t.state.lock = 88;
          t.state.alive.add(88);
        }
      },
    };
    const backend = createDetachedBackend(context, {
      readLock: async () => (t.state.lock === undefined ? undefined : { pid: t.state.lock }),
      onWaiting: () => undefined,
    });
    await backend.stop(t.spec);
    expect(t.sent).toEqual([[77, "SIGTERM"]]);
  });

  it("restart waits for the old server, then spawns", async () => {
    const t = setup({ lockPid: 77, filePid: 77, command: "node tau serve --service" });
    await t.backend.restart(t.spec);
    expect(t.sent).toEqual([[77, "SIGTERM"]]);
    expect(t.node.runner.detached).toHaveLength(1);
  });

  it("restart refuses a foreground holder and spawns nothing", async () => {
    const t = setup({ lockPid: 77, command: "node tau serve" });
    await expect(t.backend.restart(t.spec)).rejects.toBeInstanceOf(ForegroundHolderError);
    expect(t.node.runner.detached).toEqual([]);
  });
});

describe("install migration", () => {
  it("stops a detached --service server before the native install", async () => {
    const t = setup({ lockPid: 77, filePid: 77 });
    const manager = createServiceManager(t.node.context, CLI, t.home, {
      readLock: async () => (t.state.lock === undefined ? undefined : { pid: t.state.lock }),
      onWaiting: () => undefined,
    });
    await manager.install();
    expect(t.sent).toEqual([[77, "SIGTERM"]]);
    const bootstrap = t.node.runner.calls.findIndex((call) => call.includes("bootstrap"));
    expect(bootstrap).toBeGreaterThanOrEqual(0);
  });

  it("refuses a foreground holder instead of installing", async () => {
    const t = setup({ lockPid: 77, command: "node tau serve" });
    const manager = createServiceManager(t.node.context, CLI, t.home, {
      readLock: async () => ({ pid: 77 }),
    });
    await expect(manager.install()).rejects.toBeInstanceOf(ForegroundHolderError);
    expect(t.node.runner.calls.some((call) => call.includes("bootstrap"))).toBe(false);
  });
});
