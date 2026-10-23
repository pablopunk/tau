import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

import { withAdmissionGate } from "../../harness/conversation-submit";
import { modelCallsOf } from "../../harness/runtime-store-fixture";
import { classifyThread } from "../../processes/governor/governed";
import { useTempDir } from "../../test-support/temp-dir";
import { sandboxExecAvailable } from "../testing/offline-sandbox";
import {
  type NativeChildCall,
  type NativeChildResult,
  nativeChildRequestId,
  resultOfOutcome,
  UNKNOWN_OUTCOME_MESSAGE,
} from "./delegation";
import {
  assembleRig,
  type Cleanups,
  type DelegationRig,
  eventsOf,
  fakeQuery,
  fakeRig,
  type SdkWorld,
  sdkWorld,
} from "./delegation-fixture";
import { launchDetached } from "./launch";
import { TAU_INSTRUCTIONS } from "./native-options";

const tempDir = useTempDir();
const cleanups: Cleanups = [];
const spawnedPids: number[] = [];
const unhandled: unknown[] = [];

process.on("unhandledRejection", (reason) => unhandled.push(reason));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitUntil(condition: () => Promise<boolean>, what: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

const isGone = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
};

const aliveAmong = (pids: readonly number[]): number[] => {
  const rows = execFileSync("/bin/ps", ["-axo", "pid=,pgid="], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  return rows
    .filter(([pid, pgid]) => pids.includes(pid as number) || pids.includes(pgid as number))
    .map(([p]) => p as number);
};

function releasable() {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  cleanups.push(() => release());
  return { held, release };
}

afterEach(async () => {
  const leaked = aliveAmong(spawnedPids);
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const pid of spawnedPids.splice(0)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  expect(unhandled).toEqual([]);
  unhandled.length = 0;
  expect(leaked).toEqual([]);
});

const callOf = (
  rig: DelegationRig,
  callId: string,
  extra: Partial<NativeChildCall> = {},
): NativeChildCall => ({
  parentId: rig.parentId,
  callId,
  description: "look around",
  prompt: "Say the thing.",
  ...extra,
});

const failed = (result: NativeChildResult) => {
  if (result.ok) throw new Error("expected a failure");
  return result;
};

describe("native child creation", () => {
  it("makes a sidebar child of the parent in the parent's workspace, titled by the description", async () => {
    const run = fakeQuery({ text: "found it" });
    const rig = await fakeRig(await tempDir(), run.query, cleanups);
    const parent = await rig.conversations.find(rig.parentId);

    const result = await rig.delegation.runNativeChild(callOf(rig, "call-1"));

    expect(result).toMatchObject({ ok: true, status: "done", text: "found it" });
    const child = await rig.conversations.find(result.childId);
    expect(child).toMatchObject({
      parentId: rig.parentId,
      projectId: parent?.projectId,
      title: "look around",
      executor: "claude-code",
      agentType: "claude-code",
      agentStatus: "done",
      background: false,
      workspace: parent?.workspace,
    });
    expect(await rig.childrenOf()).toEqual([result.childId]);
    expect(classifyThread({ parentId: child?.parentId ?? undefined, workspace: child?.workspace })).toBe(
      "subagent",
    );
  });

  it("refuses to start a child under a child", async () => {
    const rig = await fakeRig(await tempDir(), fakeQuery({ text: "x" }).query, cleanups);
    const { childId } = await rig.delegation.runNativeChild(callOf(rig, "call-1"));

    await expect(
      rig.delegation.runNativeChild({ ...callOf(rig, "call-2"), parentId: childId }),
    ).rejects.toMatchObject({
      code: "invalid_request",
    });

    expect(await rig.childrenOf()).toEqual([childId]);
  });

  it("gives the child no coordination tools: no MCP server and no mention of subagent tools", async () => {
    const rig = await fakeRig(await tempDir(), fakeQuery({ text: "x" }).query, cleanups);

    await rig.delegation.runNativeChild(callOf(rig, "call-1"));

    const options = rig.queries[0] ?? {};
    expect(options.mcpServers).toBeUndefined();
    expect(options.agents).toBeUndefined();
    expect(options.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: TAU_INSTRUCTIONS });
    expect(TAU_INSTRUCTIONS).not.toMatch(
      /subagent|send_message|stop_agent|list_agents|merge_agent|coordinat/i,
    );
  });

  it("is idempotent by parent call: a replay finds the same child and starts no second run", async () => {
    const run = fakeQuery({ text: "once" });
    const rig = await fakeRig(await tempDir(), run.query, cleanups);

    const first = await rig.delegation.runNativeChild(callOf(rig, "call-1"));
    const replay = await rig.delegation.runNativeChild(callOf(rig, "call-1"));
    const other = await rig.delegation.runNativeChild(callOf(rig, "call-2"));

    expect(replay).toEqual(first);
    expect(other.childId).not.toBe(first.childId);
    expect(run.runs()).toBe(2);
    expect(await rig.childrenOf()).toHaveLength(2);
    expect(nativeChildRequestId(rig.parentId, "call-1")).toBe(`agent:${rig.parentId}:call-1`);
  });

  it("re-attaches a concurrent replay to the same running child", async () => {
    const { held, release } = releasable();
    const run = fakeQuery({ text: "after hold", hold: held });
    const rig = await fakeRig(await tempDir(), run.query, cleanups);

    const first = rig.delegation.runNativeChild(callOf(rig, "call-1"));
    await waitUntil(async () => run.runs() === 1, "the run to start");
    const replay = rig.delegation.runNativeChild(callOf(rig, "call-1"));
    await sleep(50);
    release();

    const [a, b] = await Promise.all([first, replay]);
    expect(b).toEqual(a);
    expect(run.runs()).toBe(1);
    expect(await rig.childrenOf()).toHaveLength(1);
  });
});

describe("native child outcomes", () => {
  it("returns the child's final assistant text on completed", async () => {
    const rig = await fakeRig(await tempDir(), fakeQuery({ text: "the final report" }).query, cleanups);

    expect(await rig.delegation.runNativeChild(callOf(rig, "c"))).toMatchObject({
      ok: true,
      text: "the final report",
    });
  });

  it("reports failed with the result text and marks the child failed", async () => {
    const rig = await fakeRig(
      await tempDir(),
      fakeQuery({ text: "it broke", isError: true }).query,
      cleanups,
    );

    const result = failed(await rig.delegation.runNativeChild(callOf(rig, "c")));

    expect(result.status).toBe("failed");
    expect(result.message).toContain("failed: it broke");
    expect((await rig.conversations.find(result.childId))?.agentStatus).toBe("failed");
  });

  it("reports an unknown outcome as an error naming the child, never as success", async () => {
    const rig = await fakeRig(await tempDir(), fakeQuery({ noResult: true }).query, cleanups);

    const result = failed(await rig.delegation.runNativeChild(callOf(rig, "c")));

    expect(result.message.startsWith(UNKNOWN_OUTCOME_MESSAGE)).toBe(true);
    expect(result.message).toContain(`child thread ${result.childId}`);
    expect(await rig.storeOf(result.childId).operationState()).toMatchObject({
      lifecycle: "outcome-unknown",
    });
  });

  it("reports blocked with the reason and keeps the input in the child", async () => {
    const run = fakeQuery({ text: "never" });
    const rig = await fakeRig(await tempDir(), run.query, cleanups);
    const blockedRig = await assembleRig(rig.runtime, {
      project: rig.project,
      query: run.query,
      pollMs: 10,
      parentId: rig.parentId,
      policyFor: () => ({
        prepare: async () => ({ ok: false, reason: "the sandbox is unavailable" }),
        launch: launchDetached,
      }),
    });
    cleanups.push(() => blockedRig.service.close());

    const result = failed(await blockedRig.delegation.runNativeChild(callOf(blockedRig, "c")));

    expect(result.message).toContain("did not start: the sandbox is unavailable");
    expect(result.message).toContain("input is kept");
    expect(run.runs()).toBe(0);
    const pending = await blockedRig.storeOf(result.childId).pending();
    expect(pending.map((item) => item.requestId)).toEqual([nativeChildRequestId(rig.parentId, "c")]);
  });

  it("reports a child cancelled by someone else as stopped", async () => {
    const { held } = releasable();
    const run = fakeQuery({ text: "never", hold: held });
    const rig = await fakeRig(await tempDir(), run.query, cleanups);

    const pending = rig.delegation.runNativeChild(callOf(rig, "c"));
    await waitUntil(async () => (await rig.childrenOf()).length === 1 && run.runs() === 1, "the child run");
    const [childId] = await rig.childrenOf();
    await waitUntil(
      async () => (await rig.storeOf(childId ?? "").operationState()).operation?.operationId !== undefined,
      "the operation",
    );
    await rig.service.cancel(childId ?? "");

    const result = failed(await pending);
    expect(result).toMatchObject({ status: "stopped" });
    expect((await rig.conversations.find(result.childId))?.agentStatus).toBe("stopped");
  });

  it("maps every outcome kind and treats anything unverified as an error", () => {
    expect(resultOfOutcome("7", { kind: "completed", text: "" })).toMatchObject({ ok: true });
    for (const outcome of [
      { kind: "failed", text: "x" },
      { kind: "blocked", reason: "x" },
      { kind: "cancelled" },
      { kind: "interrupted", reason: "x" },
      { kind: "unknown", reason: "x" },
      { kind: "timed-out" },
      { kind: "wait-stopped" },
    ] as const) {
      expect(resultOfOutcome("7", outcome).ok).toBe(false);
    }
    expect(resultOfOutcome("7", { kind: "timed-out" })).toMatchObject({ status: "failed" });
    expect(resultOfOutcome("7", { kind: "interrupted", reason: "x" })).toMatchObject({ status: "stopped" });
  });
});

describe("waiting and stopping", () => {
  it("holds no admission lock while waiting: a follow-up, the Pi gate and a stop all go through", async () => {
    const { held } = releasable();
    const run = fakeQuery({ text: "late", hold: held });
    const rig = await fakeRig(await tempDir(), run.query, cleanups);
    const waiting = rig.delegation.runNativeChild(callOf(rig, "c"));
    await waitUntil(async () => run.runs() === 1, "the run to start");
    const [childId = ""] = await rig.childrenOf();

    const gate = await Promise.race([
      withAdmissionGate(childId, async () => "acquired"),
      sleep(200).then(() => "blocked"),
    ]);
    const followUp = await Promise.race([
      rig.service.send(childId, { text: "and then?", requestId: "follow-1" }),
      sleep(500).then(() => "blocked"),
    ]);
    const stopped = await Promise.race([rig.service.cancel(childId), sleep(5000).then(() => "blocked")]);

    expect(gate).toBe("acquired");
    expect(followUp).not.toBe("blocked");
    expect(stopped).toMatchObject({ status: "cancelled" });
    expect(failed(await waiting).status).toBe("stopped");
  });

  it("cancels the child when the parent call is aborted and reports it after the stop is verified", async () => {
    const { held } = releasable();
    const run = fakeQuery({ text: "never", hold: held });
    const rig = await fakeRig(await tempDir(), run.query, cleanups);
    const abort = new AbortController();

    const waiting = rig.delegation.runNativeChild(callOf(rig, "c", { signal: abort.signal }));
    await waitUntil(async () => run.runs() === 1, "the run to start");
    abort.abort();

    const result = failed(await waiting);
    expect(result.status).toBe("stopped");
    expect(result.message).toContain("because this call was stopped");
    expect(await rig.storeOf(result.childId).operationState()).toMatchObject({ lifecycle: "cancelled" });
    expect((await rig.conversations.find(result.childId))?.agentStatus).toBe("stopped");
  });

  it("withdraws a request that never started so a later poke cannot run it", async () => {
    const prepareGate = releasable();
    const run = fakeQuery({ text: "must not run" });
    const rig = await fakeRig(await tempDir(), run.query, cleanups);
    const stuck = await assembleRig(rig.runtime, {
      project: rig.project,
      query: run.query,
      pollMs: 10,
      parentId: rig.parentId,
      policyFor: () => ({
        prepare: async () => {
          await prepareGate.held;
          return { ok: false, reason: "held back" };
        },
        launch: launchDetached,
      }),
    });
    cleanups.push(() => stuck.service.close());
    const abort = new AbortController();

    const waiting = stuck.delegation.runNativeChild(callOf(stuck, "c", { signal: abort.signal }));
    await waitUntil(async () => (await stuck.childrenOf()).length === 1, "the child");
    abort.abort();
    await sleep(50);
    prepareGate.release();

    const result = failed(await waiting);
    expect(result.status).toBe("stopped");
    expect(await stuck.storeOf(result.childId).pending()).toEqual([]);
    expect(run.runs()).toBe(0);
  });
});

describe("native child removal", () => {
  it("cancels the child's run first when it is removed", async () => {
    const { held } = releasable();
    const run = fakeQuery({ text: "never", hold: held });
    const rig = await fakeRig(await tempDir(), run.query, cleanups);
    const waiting = rig.delegation.runNativeChild(callOf(rig, "c"));
    await waitUntil(async () => run.runs() === 1, "the run to start");
    const [childId = ""] = await rig.childrenOf();
    await waitUntil(
      async () => (await rig.storeOf(childId).operationState()).operation?.operationId !== undefined,
      "the operation",
    );

    await rig.service.onConversationRemoved(childId);

    expect(await rig.storeOf(childId).operationState()).toMatchObject({ lifecycle: "cancelled" });
    expect(failed(await waiting).status).toBe("stopped");
  });
});

const FIRST_ANSWER = "child answer (scripted)";

const finalTurn = (text: string, held?: Promise<void>) => ({
  blocks: [{ type: "text" as const, text }],
  ...(held && { holdResponseUntil: held }),
});

async function trackedSdkWorld(script: Parameters<typeof sdkWorld>[1]): Promise<SdkWorld> {
  const sdk = await sdkWorld(await tempDir(), script, cleanups);
  const track = setInterval(() => {
    for (const pid of sdk.spawned.pids) if (!spawnedPids.includes(pid)) spawnedPids.push(pid);
  }, 5);
  cleanups.push(() => clearInterval(track));
  return sdk;
}

const settledPids = (sdk: SdkWorld) => {
  for (const pid of sdk.spawned.pids) if (!spawnedPids.includes(pid)) spawnedPids.push(pid);
};

describe.skipIf(!sandboxExecAvailable())("native child with the real SDK under the sandbox, offline", () => {
  it("runs the child sandboxed as a subagent, returns its text and makes no Pi model call", async () => {
    const sdk = await trackedSdkWorld(() => [finalTurn(FIRST_ANSWER)]);

    const result = await sdk.rig.delegation.runNativeChild(callOf(sdk.rig, "call-1"));
    await sdk.rig.service.settled();
    settledPids(sdk);

    expect(result).toMatchObject({ ok: true, text: FIRST_ANSWER });
    expect(sdk.server.violations).toEqual([]);
    expect(sdk.spawned.files).toEqual(["/usr/bin/sandbox-exec"]);
    expect(sdk.server.messageRequests).toHaveLength(1);
    expect(modelCallsOf(sdk.runtime.setup)).toBe(0);
    expect(await eventsOf(sdk.rig.storeOf(result.childId))).toContainEqual(
      expect.objectContaining({ type: "assistant-text", text: FIRST_ANSWER }),
    );
  });

  it("replays the same parent call onto the same child with one SDK child spawned", async () => {
    const sdk = await trackedSdkWorld(() => [
      finalTurn(FIRST_ANSWER),
      finalTurn("second run must not happen"),
    ]);

    const first = await sdk.rig.delegation.runNativeChild(callOf(sdk.rig, "call-1"));
    const replay = await sdk.rig.delegation.runNativeChild(callOf(sdk.rig, "call-1"));
    await sdk.rig.service.settled();
    settledPids(sdk);

    expect(replay).toEqual(first);
    expect(sdk.spawned.pids).toHaveLength(1);
    expect(sdk.server.messageRequests).toHaveLength(1);
    expect(await sdk.rig.childrenOf()).toEqual([first.childId]);
  });

  it("kills the child with a verified death when the parent call is aborted", async () => {
    const { held } = releasable();
    const sdk = await trackedSdkWorld(() => [finalTurn("never delivered", held)]);
    const abort = new AbortController();

    const waiting = sdk.rig.delegation.runNativeChild(callOf(sdk.rig, "call-1", { signal: abort.signal }));
    await sdk.server.messageRequestArrived(1);
    await waitUntil(async () => {
      const [childId = ""] = await sdk.rig.childrenOf();
      return (
        childId !== "" && (await sdk.rig.storeOf(childId).operationState()).operation?.identity !== undefined
      );
    }, "the child identity");
    const [childId = ""] = await sdk.rig.childrenOf();
    const pid = (await sdk.rig.storeOf(childId).operationState()).operation?.identity?.pid ?? 0;
    abort.abort();

    const result = failed(await waiting);
    settledPids(sdk);
    expect(result.status).toBe("stopped");
    expect(isGone(pid)).toBe(true);
    expect(await sdk.rig.storeOf(childId).operationState()).toMatchObject({ lifecycle: "cancelled" });
    expect(sdk.spawned.pids).toHaveLength(1);
  });

  it("re-attaches after a parent restart to the same child and reports its unknown outcome, spawning nothing", async () => {
    const { held } = releasable();
    const sdk = await trackedSdkWorld(() => [finalTurn("never delivered", held), finalTurn("must not run")]);
    const first = sdk.rig.delegation.runNativeChild(callOf(sdk.rig, "call-1"));
    first.catch(() => undefined);
    await sdk.server.messageRequestArrived(1);
    await waitUntil(async () => {
      const [childId = ""] = await sdk.rig.childrenOf();
      const state = childId === "" ? undefined : await sdk.rig.storeOf(childId).operationState();
      return state?.operation?.identity !== undefined && state.eventCount > 0;
    }, "the child identity and first event");
    const [childId = ""] = await sdk.rig.childrenOf();
    const pid = (await sdk.rig.storeOf(childId).operationState()).operation?.identity?.pid ?? 0;

    const afterRestart = await sdk.reopen();
    settledPids(sdk);
    await afterRestart.service.reconcileAll();
    const replay = failed(await afterRestart.delegation.runNativeChild(callOf(afterRestart, "call-1")));

    expect(replay.childId).toBe(childId);
    expect(replay.message.startsWith(UNKNOWN_OUTCOME_MESSAGE)).toBe(true);
    expect(isGone(pid)).toBe(true);
    expect(sdk.spawned.pids).toHaveLength(1);
    expect(sdk.server.messageRequests).toHaveLength(1);
    expect(await afterRestart.childrenOf()).toEqual([childId]);
    expect(modelCallsOf(sdk.runtime.setup)).toBe(0);
  });
});
