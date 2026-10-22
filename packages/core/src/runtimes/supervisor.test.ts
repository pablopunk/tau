import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it, vi } from "vitest";
import { type ProcessTable, parsePsRow } from "./process-table";
import {
  classifyAfterRestart,
  descendantsOf,
  isSameProcessAlive,
  type ProcessIdentity,
  readIdentity,
  type StopOptions,
  type SupervisedHandle,
  type SupervisorDeps,
  spawnSupervised,
  stopByIdentity,
  stopSupervised,
} from "./supervisor";

const NONCE_PREFIX = `tau-supervisor-test-${randomUUID()}`;
const FAST: StopOptions = { eofGraceMs: 150, termGraceMs: 400, killGraceMs: 1500, verifyTimeoutMs: 2000 };
const FORGED_START_TIME = "Mon Jan 1 00:00:00 1990";

const COOPERATIVE_CHILD =
  "process.stdin.on('end',()=>process.exit(0));process.stdin.resume();console.log('ready')";
const SIGTERM_IGNORING_CHILD =
  "process.on('SIGTERM',()=>{});process.stdin.resume();setInterval(()=>{},1000);console.log('ready')";
const GRANDCHILD_PARENT = [
  "const {spawn}=require('node:child_process');",
  "const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});",
  "g.unref();process.stdin.resume();setInterval(()=>{},1000);console.log('grandchild '+g.pid)",
].join("");

const everyTrackedIdentity: ProcessIdentity[] = [];
let nonceCounter = 0;

const nextNonce = (): string => `${NONCE_PREFIX}-${nonceCounter++}`;

async function spawnNode(script: string): Promise<SupervisedHandle> {
  const handle = await spawnSupervised(
    {
      command: process.execPath,
      args: ["-e", script],
      cwd: tmpdir(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    },
    nextNonce(),
  );
  everyTrackedIdentity.push(handle.identity);
  return handle;
}

function firstStdoutMatching(handle: SupervisedHandle, pattern: RegExp): Promise<RegExpExecArray> {
  return new Promise((resolve, reject) => {
    let seen = "";
    const timer = setTimeout(
      () => reject(new Error(`no stdout matching ${pattern}; saw ${JSON.stringify(seen)}`)),
      10_000,
    );
    handle.child.stdout.on("data", (chunk: Buffer) => {
      seen += chunk.toString();
      const match = pattern.exec(seen);
      if (match) {
        clearTimeout(timer);
        resolve(match);
      }
    });
  });
}

async function spawnReady(script: string): Promise<SupervisedHandle> {
  const handle = await spawnNode(script);
  await firstStdoutMatching(handle, /ready/);
  return handle;
}

async function trackedGrandchild(handle: SupervisedHandle): Promise<ProcessIdentity> {
  const match = await firstStdoutMatching(handle, /grandchild (\d+)/);
  const identity = await readIdentity(Number(match[1]), handle.identity.nonce);
  if (!identity) throw new Error("grandchild vanished before it could be tracked");
  everyTrackedIdentity.push(identity);
  return identity;
}

const forgedStartTime = (identity: ProcessIdentity): ProcessIdentity => ({
  ...identity,
  startTime: FORGED_START_TIME,
});

const alwaysAliveTable = (identity: ProcessIdentity): ProcessTable => {
  const entry = {
    pid: identity.pid,
    ppid: 1,
    pgid: identity.pgid,
    startTime: identity.startTime,
    zombie: false,
  };
  return { find: async () => entry, list: async () => [entry] };
};

const brokenTable: ProcessTable = {
  find: async () => {
    throw new Error("ps unavailable");
  },
  list: async () => {
    throw new Error("ps unavailable");
  },
};

const psCommandLines = (): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile("ps", ["eww", "-A", "-o", "pid=,command="], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });

async function killTrackedSurvivors(): Promise<void> {
  for (const identity of everyTrackedIdentity) {
    if (await isSameProcessAlive(identity)) process.kill(identity.pid, "SIGKILL");
  }
}

afterAll(killTrackedSurvivors);

describe("process table parsing", () => {
  it("normalizes the padded start time that ps prints for single-digit days", () => {
    const entry = parsePsRow("  123     1   123 Ss   Thu Oct  2 10:00:00 2026");
    expect(entry).toEqual({
      pid: 123,
      ppid: 1,
      pgid: 123,
      startTime: "Thu Oct 2 10:00:00 2026",
      zombie: false,
    });
  });

  it("flags zombies and ignores garbage rows", () => {
    expect(parsePsRow("42 1 42 Z+ Thu Oct 22 10:00:00 2026")?.zombie).toBe(true);
    expect(parsePsRow("not a process row")).toBeUndefined();
  });
});

describe("supervised stop", () => {
  it("records a verifiable identity and passes the nonce to the child", async () => {
    const handle = await spawnReady(COOPERATIVE_CHILD);
    const { identity } = handle;
    expect(identity.pid).toBe(handle.child.pid);
    expect(identity.pgid).toBe(identity.pid);
    expect(identity.startTime).not.toBe("");
    expect(await isSameProcessAlive(identity)).toBe(true);
    expect(await psCommandLines()).toContain(`TAU_RUNTIME_NONCE=${identity.nonce}`);
    await stopSupervised(handle, FAST);
  });

  it("stops a cooperative child on stdin EOF without any signal", async () => {
    const handle = await spawnReady(COOPERATIVE_CHILD);
    const result = await stopSupervised(handle, FAST);
    expect(result).toMatchObject({ outcome: "stopped", escalated: [] });
    expect(await isSameProcessAlive(handle.identity)).toBe(false);
    expect((await handle.exited).code).toBe(0);
  });

  it("escalates to SIGKILL for a child that ignores SIGTERM", async () => {
    const handle = await spawnReady(SIGTERM_IGNORING_CHILD);
    const result = await stopSupervised(handle, FAST);
    expect(result).toMatchObject({ outcome: "stopped" });
    if (result.outcome === "stopped") expect(result.escalated).toEqual(["term", "kill"]);
    expect(await isSameProcessAlive(handle.identity)).toBe(false);
    expect((await handle.exited).signal).toBe("SIGKILL");
  });

  it("kills a grandchild that started its own session and verifies both are gone", async () => {
    const handle = await spawnNode(GRANDCHILD_PARENT);
    const grandchild = await trackedGrandchild(handle);
    expect(grandchild.pgid).not.toBe(handle.identity.pgid);
    expect(await descendantsOf(handle.identity.pid)).toContain(grandchild.pid);

    const result = await stopSupervised(handle, FAST);

    expect(result.outcome).toBe("stopped");
    expect(result).not.toHaveProperty("survivors");
    expect(await isSameProcessAlive(handle.identity)).toBe(false);
    expect(await isSameProcessAlive(grandchild)).toBe(false);
  });

  it("stops a child from a persisted identity after the handle is dropped", async () => {
    const handle = await spawnReady(COOPERATIVE_CHILD);
    const persisted: ProcessIdentity = JSON.parse(JSON.stringify(handle.identity));
    const exited = handle.exited;

    const result = await stopByIdentity(persisted, FAST);

    expect(result).toMatchObject({ outcome: "stopped", escalated: ["term"] });
    expect(await isSameProcessAlive(persisted)).toBe(false);
    expect((await exited).signal).toBe("SIGTERM");
    expect(await stopByIdentity(persisted, FAST)).toEqual({ outcome: "not-running" });
  });
});

describe("PID reuse guard", () => {
  it("never signals a live process whose start time differs from the recorded identity", async () => {
    const sacrificial = await spawnReady(SIGTERM_IGNORING_CHILD);
    const stale = forgedStartTime(sacrificial.identity);
    const sendSignal = vi.fn((pid: number, signal: NodeJS.Signals | 0) => process.kill(pid, signal));
    const deps: Partial<SupervisorDeps> = { sendSignal };

    expect(await isSameProcessAlive(stale)).toBe(false);
    expect(await stopByIdentity(stale, FAST, deps)).toEqual({ outcome: "not-running" });

    expect(sendSignal).not.toHaveBeenCalled();
    expect(await isSameProcessAlive(sacrificial.identity)).toBe(true);
    await stopSupervised(sacrificial, FAST);
  });
});

describe("verification", () => {
  it("reports unknown, never stopped, when the process table keeps showing the process", async () => {
    const handle = await spawnReady(SIGTERM_IGNORING_CHILD);
    const deps: Partial<SupervisorDeps> = { processTable: alwaysAliveTable(handle.identity) };
    const options: StopOptions = { eofGraceMs: 50, termGraceMs: 100, killGraceMs: 100, verifyTimeoutMs: 200 };

    const result = await stopSupervised(handle, options, deps);

    expect(result.outcome).toBe("unknown");
    if (result.outcome === "unknown") expect(result.survivors).toEqual([handle.identity.pid]);
    await handle.exited;
  });

  it("reports unknown when ps itself fails", async () => {
    const handle = await spawnReady(COOPERATIVE_CHILD);
    const result = await stopSupervised(handle, FAST, { processTable: brokenTable });
    expect(result).toMatchObject({ outcome: "unknown", survivors: [] });
    await stopSupervised(handle, FAST);
  });
});

describe("classifyAfterRestart", () => {
  it("tells dead, alive-same, alive-reused-pid and unknown apart", async () => {
    const handle = await spawnReady(COOPERATIVE_CHILD);
    expect(await classifyAfterRestart(handle.identity)).toBe("alive-same");
    expect(await classifyAfterRestart(forgedStartTime(handle.identity))).toBe("alive-reused-pid");
    expect(await classifyAfterRestart(handle.identity, { processTable: brokenTable })).toBe("unknown");

    await stopSupervised(handle, FAST);

    expect(await classifyAfterRestart(handle.identity)).toBe("dead");
    expect(await readIdentity(handle.identity.pid, handle.identity.nonce)).toBeUndefined();
  });
});

describe("no orphans", () => {
  it("leaves no tracked process and no process carrying a test nonce", async () => {
    const alive: number[] = [];
    for (const identity of everyTrackedIdentity) {
      if (await isSameProcessAlive(identity)) alive.push(identity.pid);
    }
    expect(alive).toEqual([]);
    const withNonce = (await psCommandLines()).split("\n").filter((line) => line.includes(NONCE_PREFIX));
    expect(withNonce).toEqual([]);
  });
});
