import { execFileSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { type Options, query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { AppError } from "@tau/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeStore, type OperationState, type RuntimeStore } from "../../harness/runtime-store";
import {
  createPassiveThread,
  modelCallsOf,
  openRuntimeWorld,
  type RuntimeWorld,
} from "../../harness/runtime-store-fixture";
import { useTempDir } from "../../test-support/temp-dir";
import type { SupervisorDeps } from "../supervisor";
import { RUNTIME_NONCE_ENV } from "../supervisor";
import {
  expectToolResult,
  type FakeAnthropicServer,
  type ScriptedTurn,
  startFakeAnthropicServer,
  toolResultsIn,
} from "../testing/fake-anthropic-server";
import {
  childEnvironment,
  createOfflineWorld,
  FAKE_API_KEY,
  listTree,
  type OfflineWorld,
  sandboxExecAvailable,
} from "../testing/offline-sandbox";
import {
  createNativeController,
  defaultNativeOptions,
  type NativeController,
  type NativeQueryFn,
  type PrepareResult,
} from "./controller";
import type { NativeEvent } from "./events";
import type { Launch } from "./launch";

const FIXTURE_TEXT = "tau-offline-fixture-text-7f3a";
const READ_ID = "toolu_fake_read_0001";
const BASH_ID = "toolu_fake_bash_0001";
const FINAL_TEXT = "The file says: tau-offline-fixture-text-7f3a. (scripted)";
const PROMPT = "Please read fixture.txt and tell me what it says.";
const MODEL = "claude-sonnet-4-5";
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const SDK_VARIABLE = /^(CLAUDE_CODE_|CLAUDE_AGENT_SDK)/;
const CREDENTIAL_NAME = /TOKEN|KEY|SECRET|OAUTH|AUTH|PASSWORD/;

const tempDir = useTempDir();
const cleanups: (() => void | Promise<void>)[] = [];
const rigs: Rig[] = [];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(condition: () => Promise<boolean>, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
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

function liveProcessesOf(roots: readonly number[]): number[] {
  const rows = execFileSync("/bin/ps", ["-axo", "pid=,pgid="], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  return rows
    .filter(([pid, pgid]) => roots.includes(pid as number) || roots.includes(pgid as number))
    .map(([pid]) => pid as number);
}

function killGroups(pids: readonly number[]): void {
  for (const pid of pids) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

interface SandboxLaunch {
  readonly launch: Launch;
  readonly pids: number[];
  readonly stderr: () => string;
}

function sandboxLaunch(world: OfflineWorld, baseUrl: string): SandboxLaunch {
  const pids: number[] = [];
  let stderr = "";
  const launch: Launch = (spec) => {
    const inherited = Object.entries(spec.env).filter(
      ([name, value]) =>
        value !== undefined &&
        (name === RUNTIME_NONCE_ENV || (SDK_VARIABLE.test(name) && !CREDENTIAL_NAME.test(name))),
    );
    const env = { ...Object.fromEntries(inherited), ...childEnvironment(world, baseUrl) };
    const child = spawn(SANDBOX_EXEC, ["-f", world.profile, spec.command, ...spec.args], {
      cwd: spec.cwd,
      env: env as Record<string, string>,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      ...(spec.signal && { signal: spec.signal }),
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    if (child.pid !== undefined) pids.push(child.pid);
    return child;
  };
  return { launch, pids, stderr: () => stderr };
}

const realQuery: NativeQueryFn = ({ prompt, options }) => sdkQuery({ prompt, options: options as Options });

interface Rig {
  readonly runtime: RuntimeWorld;
  readonly world: OfflineWorld;
  readonly server: FakeAnthropicServer;
  readonly threadId: string;
  readonly store: RuntimeStore;
  readonly sandbox: SandboxLaunch;
  readonly controller: NativeController;
  makeController(store: RuntimeStore, query?: NativeQueryFn, launch?: Launch): NativeController;
  atFirstRequest(): Promise<OperationState> | undefined;
}

interface RigOptions {
  readonly tools?: readonly string[];
  readonly allowedTools?: readonly string[];
  readonly query?: NativeQueryFn;
  readonly directory?: string;
  readonly prepare?: () => Promise<PrepareResult>;
}

const readTurn = (world: OfflineWorld): ScriptedTurn => ({
  blocks: [{ type: "tool_use", id: READ_ID, name: "Read", input: { file_path: world.fixturePath } }],
});

const finalTurn = (text: string, validate?: ScriptedTurn["validate"]): ScriptedTurn => ({
  blocks: [{ type: "text", text }],
  ...(validate && { validate }),
});

function releasable(): { held: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  cleanups.push(() => release());
  return { held, release };
}

async function newRig(
  script: (world: OfflineWorld, snapshot: () => void) => ScriptedTurn[],
  options: RigOptions = {},
): Promise<Rig> {
  const directory = options.directory ?? (await tempDir());
  const runtime = await openRuntimeWorld(directory);
  cleanups.push(() => runtime.close().catch(() => undefined));
  const threadId = await createPassiveThread(runtime);
  const store = createRuntimeStore(runtime.harness, threadId);
  const world = createOfflineWorld(FIXTURE_TEXT);
  cleanups.push(() => rmSync(world.root, { recursive: true, force: true }));
  let snapshot: Promise<OperationState> | undefined;
  const takeSnapshot = () => {
    snapshot ??= store.operationState();
  };
  const server = await startFakeAnthropicServer({
    apiKey: FAKE_API_KEY,
    script: script(world, takeSnapshot),
    model: MODEL,
  });
  cleanups.push(() => server.close());
  const sandbox = sandboxLaunch(world, server.url);
  const buildOptions = () => ({
    model: MODEL,
    cwd: world.cwd,
    systemPrompt: "You are a test agent.",
    title: "native controller",
    tools: [...(options.tools ?? ["Read"])],
    allowedTools: [...(options.allowedTools ?? options.tools ?? ["Read"])],
    settingSources: [],
    strictMcpConfig: true,
    settings: { disableClaudeAiConnectors: true, autoCompactEnabled: false },
    includePartialMessages: true,
    env: childEnvironment(world, server.url),
  });
  const makeController = (forStore: RuntimeStore, query?: NativeQueryFn, launch?: Launch) =>
    createNativeController({
      store: forStore,
      query: query ?? options.query ?? realQuery,
      cwd: world.cwd,
      buildOptions,
      launch: launch ?? sandbox.launch,
      ...(options.prepare && { prepare: options.prepare }),
    });
  const rig: Rig = {
    runtime,
    world,
    server,
    threadId,
    store,
    sandbox,
    controller: makeController(store),
    makeController,
    atFirstRequest: () => snapshot,
  };
  rigs.push(rig);
  cleanups.push(() => killGroups(sandbox.pids));
  return rig;
}

async function admit(store: RuntimeStore, requestId = "r1", text = PROMPT): Promise<void> {
  await store.admit({
    threadId: store.threadId,
    requestId,
    payload: { text, attachmentIds: [], origin: "user", delivery: "queue" },
  });
}

const eventsOf = async (store: RuntimeStore): Promise<NativeEvent[]> =>
  (await store.events()).map((entry) => entry.event);

const expectNoLeftovers = (rig: Rig): void => {
  expect(liveProcessesOf(rig.sandbox.pids), rig.sandbox.stderr().slice(-1500)).toEqual([]);
};

afterEach(async () => {
  const leaked = rigs.splice(0).flatMap((rig) => liveProcessesOf(rig.sandbox.pids));
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  expect(leaked).toEqual([]);
});

const failureContext = (rig: Rig): string =>
  `violations=${JSON.stringify(rig.server.violations)}\nstderr=${rig.sandbox.stderr().slice(-2000)}`;

const neverCalled: NativeQueryFn = () => {
  throw new Error("the SDK must not be called");
};

describe("native controller without a process", () => {
  it("blocks when preparation fails: the item stays queued and nothing is spawned", async () => {
    const runtime = await openRuntimeWorld(await tempDir());
    cleanups.push(() => runtime.close());
    const threadId = await createPassiveThread(runtime);
    const store = createRuntimeStore(runtime.harness, threadId);
    await admit(store);
    const launches: unknown[] = [];
    const controller = createNativeController({
      store,
      query: neverCalled,
      cwd: runtime.directory,
      launch: (spec) => {
        launches.push(spec);
        throw new Error("the launch must not be called");
      },
      prepare: async () => ({ ok: false, reason: "workspace checkpoint failed" }),
    });

    const result = await controller.runNext(threadId);

    expect(result).toEqual({ status: "blocked", reason: "workspace checkpoint failed" });
    expect(launches).toEqual([]);
    expect((await store.pending()).map((item) => item.requestId)).toEqual(["r1"]);
    const state = await store.operationState();
    expect(state.lifecycle).toBe("blocked");
    expect(state.operation).toBeUndefined();
    const notices = (await eventsOf(store)).filter((event) => event.type === "notice");
    expect(notices).toMatchObject([{ code: "blocked", text: expect.stringContaining("checkpoint failed") }]);
    expect(modelCallsOf(runtime.setup)).toBe(0);
  });

  it("never runs with bypassPermissions and defaults to dontAsk", async () => {
    expect(defaultNativeOptions({ threadId: "1", cwd: "/x" })).toMatchObject({
      permissionMode: "dontAsk",
      settingSources: [],
    });
    const runtime = await openRuntimeWorld(await tempDir());
    cleanups.push(() => runtime.close());
    const threadId = await createPassiveThread(runtime);
    const store = createRuntimeStore(runtime.harness, threadId);
    await admit(store);
    const controller = createNativeController({
      store,
      query: neverCalled,
      cwd: runtime.directory,
      buildOptions: () => ({ permissionMode: "bypassPermissions" }),
    });
    await expect(controller.runNext(threadId)).rejects.toMatchObject({ code: "invalid_request" });
    expect((await store.operationState()).lifecycle).toBe("accepted");
    expect(await store.pending()).toHaveLength(1);
  });

  it("rejects a run for another thread and a run with nothing queued", async () => {
    const runtime = await openRuntimeWorld(await tempDir());
    cleanups.push(() => runtime.close());
    const threadId = await createPassiveThread(runtime);
    const store = createRuntimeStore(runtime.harness, threadId);
    const controller = createNativeController({ store, query: neverCalled, cwd: runtime.directory });
    await expect(controller.runNext("other")).rejects.toBeInstanceOf(AppError);
    await expect(controller.runNext(threadId)).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("native reconcile from persisted state", () => {
  const START = 1_700_000_000_000;

  interface Seeded {
    readonly store: RuntimeStore;
    readonly controller: NativeController;
    readonly signals: [number, string | number][];
  }

  async function seed(options: {
    identity: boolean;
    delivered: boolean;
    table: SupervisorDeps["processTable"];
  }): Promise<Seeded> {
    const runtime = await openRuntimeWorld(await tempDir());
    cleanups.push(() => runtime.close());
    const threadId = await createPassiveThread(runtime);
    const store = createRuntimeStore(runtime.harness, threadId);
    await admit(store);
    for (const step of ["preparing", "ready"] as const) await store.setLifecycle(step);
    await store.recordLaunchIntent({ operationId: "op1", nonce: "n1" });
    if (options.identity) {
      await store.recordIdentity({ pid: 424242, startTime: START, nonce: "n1", pgid: 424242 });
    }
    if (options.delivered) await store.markDeliveredOnce("r1");
    const signals: [number, string | number][] = [];
    const controller = createNativeController({
      store,
      query: neverCalled,
      cwd: runtime.directory,
      supervisor: {
        processTable: options.table,
        sendSignal: (pid, signal) => {
          signals.push([pid, signal]);
        },
      },
    });
    return { store, controller, signals };
  }

  const tableOf = (entry: { startTime: string } | undefined): SupervisorDeps["processTable"] => {
    const rows = entry ? [{ pid: 424242, ppid: 1, pgid: 424242, zombie: false, ...entry }] : [];
    return { find: async () => rows[0], list: async () => rows };
  };

  const lifecycleOf = async (seeded: Seeded) => (await seeded.store.operationState()).lifecycle;

  it("settles outcome-unknown when a launch intent has no identity", async () => {
    const seeded = await seed({ identity: false, delivered: false, table: tableOf(undefined) });
    expect(await seeded.controller.reconcile(seeded.store.threadId)).toBe("outcome-unknown");
    expect(await lifecycleOf(seeded)).toBe("outcome-unknown");
    expect(seeded.signals).toEqual([]);
  });

  it("settles outcome-unknown for a dead process whose prompt was delivered", async () => {
    const seeded = await seed({ identity: true, delivered: true, table: tableOf(undefined) });
    expect(await seeded.controller.reconcile(seeded.store.threadId)).toBe("outcome-unknown");
    expect(seeded.signals).toEqual([]);
  });

  it("settles interrupted for a dead process whose prompt was never delivered", async () => {
    const seeded = await seed({ identity: true, delivered: false, table: tableOf(undefined) });
    expect(await seeded.controller.reconcile(seeded.store.threadId)).toBe("interrupted");
    expect(await lifecycleOf(seeded)).toBe("interrupted");
  });

  it("resumes from a lifecycle already moved to reconciling and never relaunches", async () => {
    const seeded = await seed({ identity: true, delivered: false, table: tableOf(undefined) });
    await seeded.store.setLifecycle("reconciling", { restart: true });
    expect(await seeded.controller.reconcile(seeded.store.threadId)).toBe("interrupted");
    expect(await lifecycleOf(seeded)).toBe("interrupted");
    expect(await seeded.controller.reconcile(seeded.store.threadId)).toBe("settled");
    expect(seeded.signals).toEqual([]);
  });

  it("settles a cancel that was in flight at the restart as cancelled and closes the cancel record", async () => {
    const seeded = await seed({ identity: true, delivered: true, table: tableOf(undefined) });
    await seeded.store.recordCancel("op1");
    expect(await seeded.controller.reconcile(seeded.store.threadId)).toBe("settled");
    expect(await lifecycleOf(seeded)).toBe("cancelled");
    expect((await seeded.store.inspect()).cancelsInFlight).toBe(0);
  });

  it("treats a reused pid as dead and never signals it, then stays idempotent", async () => {
    const seeded = await seed({
      identity: true,
      delivered: true,
      table: tableOf({ startTime: String(START + 60_000) }),
    });
    expect(await seeded.controller.reconcile(seeded.store.threadId)).toBe("outcome-unknown");
    expect(seeded.signals).toEqual([]);
    expect(await seeded.controller.reconcile(seeded.store.threadId)).toBe("settled");
    expect(await seeded.controller.reconcile(seeded.store.threadId)).toBe("settled");
  });

  it("signals nothing when the process table is unreadable", async () => {
    const broken: SupervisorDeps["processTable"] = {
      find: async () => {
        throw new Error("ps failed");
      },
      list: async () => {
        throw new Error("ps failed");
      },
    };
    const seeded = await seed({ identity: true, delivered: false, table: broken });
    expect(await seeded.controller.reconcile(seeded.store.threadId)).toBe("outcome-unknown");
    expect(await lifecycleOf(seeded)).toBe("outcome-unknown");
    expect(seeded.signals).toEqual([]);
  });
});

describe.skipIf(!sandboxExecAvailable())("native controller with the real SDK, offline", () => {
  it("runs one admitted message to completion with durable identity before the first model request", async () => {
    const rig = await newRig((world, snapshot) => [
      { ...readTurn(world), validate: () => void snapshot() },
      finalTurn(FINAL_TEXT, expectToolResult(READ_ID, FIXTURE_TEXT)),
    ]);
    await admit(rig.store);

    const result = await rig.controller.runNext(rig.threadId);

    expect(rig.server.violations, failureContext(rig)).toEqual([]);
    expect(result).toMatchObject({ status: "settled", outcome: "completed" });
    expect(rig.server.messageRequests).toHaveLength(2);

    const events = await eventsOf(rig.store);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["session", "assistant-text", "tool-call", "tool-result", "usage", "result"]),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: "assistant-text", text: FINAL_TEXT }));
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool-call", name: "Read", callId: READ_ID }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool-result", callId: READ_ID, isError: false }),
    );
    expect(events.find((event) => event.type === "tool-result")).toMatchObject({
      text: expect.stringContaining(FIXTURE_TEXT),
    });
    expect(events.find((event) => event.type === "result")).toMatchObject({
      subtype: "success",
      isError: false,
    });

    const state = await rig.store.operationState();
    expect(state.lifecycle).toBe("completed");
    expect(state.operation?.terminal).toMatchObject({ lifecycle: "completed" });
    expect(state.operation?.deliveredRequestId).toBe("r1");
    expect(state.operation?.sessionId).toEqual(expect.any(String));
    expect(await rig.store.pending()).toEqual([]);
    const identity = state.operation?.identity;
    expect(identity).toMatchObject({ pid: rig.sandbox.pids[0], pgid: rig.sandbox.pids[0] });
    expect(identity?.nonce).toBe(state.operation?.nonce);
    expect(isGone(identity?.pid ?? 0)).toBe(true);
    expectNoLeftovers(rig);

    const atRequestOne = await rig.atFirstRequest();
    expect(atRequestOne?.operation?.identity).toEqual(identity);
    expect(["starting", "running"]).toContain(atRequestOne?.lifecycle);
    expect(atRequestOne?.operation?.deliveredRequestId).toBe("r1");
    expect(modelCallsOf(rig.runtime.setup)).toBe(0);
  });

  it("cancels mid-turn with verified death, idempotently, and leaves no process", async () => {
    const { held } = releasable();
    const rig = await newRig((world) => [
      readTurn(world),
      { ...finalTurn("never delivered"), holdResponseUntil: held },
    ]);
    await admit(rig.store);
    const running = rig.controller.runNext(rig.threadId).catch((error: unknown) => error);
    await rig.server.messageRequestArrived(2);
    const operationId = (await rig.store.operationState()).operation?.operationId ?? "";

    await expect(rig.controller.runNext(rig.threadId)).rejects.toMatchObject({ code: "invalid_request" });
    const outcome = await rig.controller.cancel(rig.threadId, operationId);
    const again = await rig.controller.cancel(rig.threadId, operationId);

    expect(outcome).toBe("cancelled");
    expect(again).toBe("cancelled");
    expect(await running).toMatchObject({ status: "settled", outcome: "cancelled", operationId });
    const state = await rig.store.operationState();
    expect(state.lifecycle).toBe("cancelled");
    expect(state.operation?.terminal?.lifecycle).toBe("cancelled");
    expect(isGone(state.operation?.identity?.pid ?? 0)).toBe(true);
    expect((await rig.store.inspect()).cancelsInFlight).toBe(0);
    expect(rig.server.messageRequests).toHaveLength(2);
    expect(rig.sandbox.pids).toHaveLength(1);
    expectNoLeftovers(rig);
    expect(modelCallsOf(rig.runtime.setup)).toBe(0);
  });

  it("recovers after a controller crash: stops the live child by identity and never relaunches", async () => {
    const directory = await tempDir();
    const { held } = releasable();
    const rig = await newRig(
      (world) => [{ ...readTurn(world), holdResponseUntil: held }, finalTurn("unused")],
      {
        directory,
      },
    );
    await admit(rig.store);
    const abandoned = rig.controller.runNext(rig.threadId).catch((error: unknown) => error);
    await rig.server.messageRequestArrived(1);
    await waitUntil(async () => {
      const state = await rig.store.operationState();
      return state.operation?.identity !== undefined && state.eventCount > 0;
    }, "identity and the first event");
    const before = await rig.store.operationState();
    const identity = before.operation?.identity;
    expect(before.operation?.terminal).toBeUndefined();
    expect(isGone(identity?.pid ?? 0)).toBe(false);

    await rig.runtime.close();
    const restarted = await openRuntimeWorld(directory, rig.runtime.setup);
    cleanups.push(() => restarted.close().catch(() => undefined));
    const store = createRuntimeStore(restarted.harness, rig.threadId);
    const launchesAfterRestart: unknown[] = [];
    const controller = rig.makeController(store, neverCalled, (spec) => {
      launchesAfterRestart.push(spec);
      throw new Error("a restart must never relaunch");
    });

    const outcome = await controller.reconcile(rig.threadId);

    expect(outcome).toBe("outcome-unknown");
    const after = await store.operationState();
    expect(after.lifecycle).toBe("outcome-unknown");
    expect(after.operation?.terminal).toMatchObject({ lifecycle: "outcome-unknown" });
    expect(after.operation?.identity).toEqual(identity);
    expect(isGone(identity?.pid ?? 0)).toBe(true);
    await sleep(300);
    expect(rig.server.messageRequests).toHaveLength(1);
    expect(launchesAfterRestart).toEqual([]);
    expect(rig.sandbox.pids).toHaveLength(1);
    expect(await controller.reconcile(rig.threadId)).toBe("settled");
    expectNoLeftovers(rig);
    expect(modelCallsOf(restarted.setup)).toBe(0);
    await abandoned;
  });

  it("settles outcome-unknown, never completed, when the iterator throws without a result", async () => {
    const exploding: NativeQueryFn = (args) => {
      const real = realQuery(args);
      const messages = (async function* () {
        for await (const message of real) {
          yield message;
          if ((message as { type?: string }).type === "assistant") throw new Error("iterator exploded");
        }
      })();
      return Object.assign(messages, { close: () => real.close?.() });
    };
    const rig = await newRig((world) => [readTurn(world), finalTurn(FINAL_TEXT)], { query: exploding });
    await admit(rig.store);

    const result = await rig.controller.runNext(rig.threadId);

    expect(result).toMatchObject({
      status: "settled",
      outcome: "outcome-unknown",
      reason: expect.stringContaining("iterator exploded"),
    });
    const state = await rig.store.operationState();
    expect(state.lifecycle).toBe("outcome-unknown");
    expect((await eventsOf(rig.store)).some((event) => event.type === "result")).toBe(false);
    expect(isGone(state.operation?.identity?.pid ?? 0)).toBe(true);
    expectNoLeftovers(rig);
  });

  it("denies an unlisted Bash tool by default and does not run it", async () => {
    const rig = await newRig(
      (world) => [
        {
          blocks: [
            {
              type: "tool_use",
              id: BASH_ID,
              name: "Bash",
              input: { command: `touch ${world.cwd}/pwned.txt`, description: "touch a file" },
            },
          ],
        },
        finalTurn("Bash was denied. (scripted)", (request) =>
          toolResultsIn(request.messages.at(-1)).find((block) => block.tool_use_id === BASH_ID)?.is_error ===
          true
            ? undefined
            : "the Bash tool call was not denied",
        ),
      ],
      { tools: ["Read", "Bash"], allowedTools: ["Read"] },
    );
    await admit(rig.store);

    const result = await rig.controller.runNext(rig.threadId);

    expect(rig.server.violations, failureContext(rig)).toEqual([]);
    expect(result).toMatchObject({ status: "settled", outcome: "completed" });
    expect(listTree(rig.world.cwd)).toEqual([`fixture.txt (${FIXTURE_TEXT.length + 1}B)`]);
    expect(await eventsOf(rig.store)).toContainEqual(
      expect.objectContaining({ type: "tool-result", callId: BASH_ID, isError: true }),
    );
    expectNoLeftovers(rig);
  });

  it("lets exactly one of two concurrent runNext calls run", async () => {
    const rig = await newRig((world) => [readTurn(world), finalTurn(FINAL_TEXT)]);
    await admit(rig.store);

    const settled = await Promise.allSettled([
      rig.controller.runNext(rig.threadId),
      rig.controller.runNext(rig.threadId),
    ]);

    expect(settled.map((entry) => entry.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = settled.find((entry) => entry.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "invalid_request" });
    expect(rig.server.messageRequests).toHaveLength(2);
    expect(rig.sandbox.pids).toHaveLength(1);
    expect((await rig.store.operationState()).lifecycle).toBe("completed");
    expectNoLeftovers(rig);
    expect(modelCallsOf(rig.runtime.setup)).toBe(0);
  });
});

describe.skipIf(!sandboxExecAvailable())("native controller across several turns, offline", () => {
  const FIRST_ANSWER = "first answer (scripted)";
  const SECOND_PROMPT = "And what did I ask you first?";
  const SECOND_ANSWER = "You asked about fixture.txt. (scripted)";
  const mentions = (request: { messages: unknown }, text: string): boolean =>
    JSON.stringify(request.messages).includes(text);

  const recordingQuery =
    (seen: Record<string, unknown>[]): NativeQueryFn =>
    (args) => {
      seen.push(args.options);
      return realQuery(args);
    };

  it("continues the same SDK conversation in a second operation on one thread", async () => {
    const seen: Record<string, unknown>[] = [];
    const rig = await newRig(
      () => [
        finalTurn(FIRST_ANSWER),
        finalTurn(SECOND_ANSWER, (request) =>
          [PROMPT, FIRST_ANSWER, SECOND_PROMPT].every((text) => mentions(request, text))
            ? undefined
            : "the second request does not carry the first turn",
        ),
      ],
      { query: recordingQuery(seen) },
    );
    await admit(rig.store, "r1");
    const first = await rig.controller.runNext(rig.threadId);
    const afterFirst = await rig.store.operationState();
    await admit(rig.store, "r2", SECOND_PROMPT);

    const second = await rig.controller.runNext(rig.threadId);

    expect(rig.server.violations, failureContext(rig)).toEqual([]);
    expect(first).toMatchObject({ status: "settled", outcome: "completed" });
    expect(second).toMatchObject({ status: "settled", outcome: "completed" });
    expect(rig.server.messageRequests).toHaveLength(2);
    expect(rig.sandbox.pids).toHaveLength(2);
    const sessionId = afterFirst.sessionId;
    expect(sessionId).toEqual(expect.any(String));
    expect(seen[0]?.resume).toBeUndefined();
    expect(seen[1]?.resume).toBe(sessionId);

    const state = await rig.store.operationState();
    expect(state.sessionId).toBe(sessionId);
    expect(state.operation?.operationId).not.toBe(afterFirst.operation?.operationId);
    expect(state.operation?.nonce).not.toBe(afterFirst.operation?.nonce);
    expect(state.operation?.deliveredRequestId).toBe("r2");
    expect(state.operation?.terminal).toMatchObject({ lifecycle: "completed" });
    expect(state.history).toMatchObject([
      { operationId: afterFirst.operation?.operationId, lifecycle: "completed" },
    ]);
    const events = await eventsOf(rig.store);
    expect(events).toContainEqual(expect.objectContaining({ type: "assistant-text", text: FIRST_ANSWER }));
    expect(events).toContainEqual(expect.objectContaining({ type: "assistant-text", text: SECOND_ANSWER }));
    expect(events.filter((event) => event.type === "result")).toHaveLength(2);
    expect(await rig.store.pending()).toEqual([]);
    expectNoLeftovers(rig);
  });

  it("refuses the next run after an unknown outcome until it is acknowledged", async () => {
    const rig = await newRig(() => [finalTurn(FIRST_ANSWER)]);
    await admit(rig.store, "r1");
    for (const step of ["preparing", "ready"] as const) await rig.store.setLifecycle(step);
    await rig.store.recordLaunchIntent({ operationId: "lost-op", nonce: "lost-nonce" });
    await rig.store.markDeliveredOnce("r1");
    await rig.store.markDelivered("r1");
    await rig.store.settle("outcome-unknown", "the process vanished");
    await admit(rig.store, "r2", PROMPT);

    await expect(rig.controller.runNext(rig.threadId)).rejects.toMatchObject({ code: "invalid_request" });
    expect(rig.sandbox.pids).toEqual([]);
    expect((await rig.store.pending()).map((item) => item.requestId)).toEqual(["r2"]);
    expect((await rig.store.operationState()).lifecycle).toBe("outcome-unknown");

    await rig.store.acknowledgeUnknown({ operationId: "lost-op", note: "checked by hand" });
    const result = await rig.controller.runNext(rig.threadId);

    expect(rig.server.violations, failureContext(rig)).toEqual([]);
    expect(result).toMatchObject({ status: "settled", outcome: "completed" });
    const state = await rig.store.operationState();
    expect(state.history).toMatchObject([
      { operationId: "lost-op", lifecycle: "outcome-unknown", acknowledgement: { note: "checked by hand" } },
    ]);
    expect(state.operation?.operationId).not.toBe("lost-op");
    expectNoLeftovers(rig);
  });

  it("retries a blocked run as the same operation without archiving a second one", async () => {
    let failures = 0;
    const rig = await newRig(() => [finalTurn(FIRST_ANSWER), finalTurn(SECOND_ANSWER)], {
      prepare: async () => (failures-- > 0 ? { ok: false, reason: "not yet" } : { ok: true }),
    });
    await admit(rig.store, "r1");
    await rig.controller.runNext(rig.threadId);
    const first = (await rig.store.operationState()).operation;
    await admit(rig.store, "r2", SECOND_PROMPT);
    failures = 1;

    const blocked = await rig.controller.runNext(rig.threadId);

    expect(blocked).toEqual({ status: "blocked", reason: "not yet" });
    const whileBlocked = await rig.store.operationState();
    expect(whileBlocked.lifecycle).toBe("blocked");
    expect(whileBlocked.operation).toBeUndefined();
    expect(whileBlocked.history).toHaveLength(1);
    expect((await rig.store.pending()).map((item) => item.requestId)).toEqual(["r2"]);

    const retried = await rig.controller.runNext(rig.threadId);

    expect(retried).toMatchObject({ status: "settled", outcome: "completed" });
    const state = await rig.store.operationState();
    expect(state.history).toHaveLength(1);
    expect(state.history[0]?.operationId).toBe(first?.operationId);
    expect(state.operation?.deliveredRequestId).toBe("r2");
    expect(await rig.store.pending()).toEqual([]);
    expect(rig.server.messageRequests).toHaveLength(2);
    expectNoLeftovers(rig);
  });
});
