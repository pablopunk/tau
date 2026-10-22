import { execFileSync, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type Options, query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { SendMessageInput } from "@tau/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

import { createApprovals } from "../../approvals/approvals";
import type { Approvals } from "../../approvals/approvals-port";
import { createChangeEmitter } from "../../change-emitter";
import { legacyWorkspace } from "../../harness/conversation-index";
import { createNativeConversation, type NativeStartRequest } from "../../harness/conversation-native";
import { type ConversationStore, createConversationStore } from "../../harness/conversation-store";
import { createRuntimeStore, type RuntimeStore } from "../../harness/runtime-store";
import { modelCallsOf, openRuntimeWorld, type RuntimeWorld } from "../../harness/runtime-store-fixture";
import { useTempDir } from "../../test-support/temp-dir";
import type { SupervisorDeps } from "../supervisor";
import {
  type FakeAnthropicServer,
  type ScriptedTurn,
  startFakeAnthropicServer,
  toolResultsIn,
} from "../testing/fake-anthropic-server";
import {
  childEnvironment,
  createOfflineWorld,
  FAKE_API_KEY,
  type OfflineWorld,
  sandboxExecAvailable,
} from "../testing/offline-sandbox";
import type { NativeQueryFn } from "./controller";
import type { NativeEvent } from "./events";
import { type NativeRunPolicy, type NativeSpawn, nativeLaunchPolicy } from "./launch-policy";
import { buildNativeOptions } from "./native-options";
import { withNativeThreads } from "./permissions";
import { createNativeService, type NativeService, type NativeServiceDeps } from "./service";

const MODEL = "claude-sonnet-4-5";
const FIRST_PROMPT = "Say the first thing.";
const SECOND_PROMPT = "Now say the second thing.";
const FIRST_ANSWER = "first answer (scripted)";
const SECOND_ANSWER = "second answer (scripted)";
const SDK_VARIABLE = /^(CLAUDE_CODE_|CLAUDE_AGENT_SDK)/;
const CREDENTIAL_NAME = /TOKEN|KEY|SECRET|OAUTH|AUTH|PASSWORD/;

const tempDir = useTempDir();
const cleanups: (() => void | Promise<void>)[] = [];
const spawnedPids: number[] = [];
const spawnedFiles: string[] = [];
const unhandled: unknown[] = [];

const recordUnhandled = (reason: unknown) => unhandled.push(reason);
process.on("unhandledRejection", recordUnhandled);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(condition: () => Promise<boolean>, what: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

function liveProcessesOf(roots: readonly number[]): number[] {
  const rows = execFileSync("/bin/ps", ["-axo", "pid=,pgid="], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  return rows
    .filter(([pid, pgid]) => roots.includes(pid as number) || roots.includes(pgid as number))
    .map(([pid]) => pid as number);
}

const isGone = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
};

function releasable(): { held: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  cleanups.push(() => release());
  return { held, release };
}

afterEach(async () => {
  const leaked = liveProcessesOf(spawnedPids);
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const pid of spawnedPids.splice(0)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  spawnedFiles.length = 0;
  expect(unhandled).toEqual([]);
  unhandled.length = 0;
  expect(leaked).toEqual([]);
});

const input = (text: string, requestId: string): SendMessageInput => ({ text, requestId });

const eventsOf = async (store: RuntimeStore): Promise<NativeEvent[]> =>
  (await store.events()).map((entry) => entry.event);

const finalTurn = (text: string, validate?: ScriptedTurn["validate"]): ScriptedTurn => ({
  blocks: [{ type: "text", text }],
  ...(validate && { validate }),
});

interface Rig {
  readonly runtime: RuntimeWorld;
  readonly conversations: ConversationStore;
  readonly service: NativeService;
  readonly changes: string[];
  readonly queries: Record<string, unknown>[];
  storeOf(threadId: string): RuntimeStore;
  start(text?: string, requestId?: string): Promise<string>;
}

const realQuery: NativeQueryFn = ({ prompt, options }) => sdkQuery({ prompt, options: options as Options });

const hermeticEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(env).filter(
      ([name]) => name === "TAU_RUNTIME_NONCE" || (SDK_VARIABLE.test(name) && !CREDENTIAL_NAME.test(name)),
    ),
  );

function recordingSpawn(stderr: { text: string }): NativeSpawn {
  return (file, args, options) => {
    const child = spawn(file, [...args], {
      cwd: options.cwd,
      env: options.env as Record<string, string>,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      ...(options.signal && { signal: options.signal }),
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.text += chunk.toString("utf8");
    });
    if (child.pid !== undefined) spawnedPids.push(child.pid);
    spawnedFiles.push(file);
    return child;
  };
}

interface SdkRigOptions {
  readonly directory?: string;
  readonly query?: NativeQueryFn;
  /** Runs with `default` permissions: Claude Code's own tools, every ask goes to canUseTool. */
  readonly asking?: { readonly approvals?: Approvals };
}

interface SdkWorld {
  readonly world: OfflineWorld;
  readonly server: FakeAnthropicServer;
  readonly stderr: { text: string };
  rigOn(runtime: RuntimeWorld): Rig;
  readonly runtime: RuntimeWorld;
  readonly rig: Rig;
}

function assemble(
  runtime: RuntimeWorld,
  projectPath: string,
  deps: Pick<NativeServiceDeps, "query" | "policyFor" | "buildOptions" | "supervisor" | "approvals">,
): Rig {
  const conversations = createConversationStore(runtime.harness, async () => projectPath);
  const changes: string[] = [];
  const queries: Record<string, unknown>[] = [];
  const query: NativeQueryFn = (args) => {
    queries.push(args.options);
    return deps.query(args);
  };
  const service = createNativeService({
    harness: runtime.harness,
    conversations,
    ...deps,
    query,
    onChange: (projectId) => changes.push(projectId),
  });
  const storeOf = (threadId: string) => createRuntimeStore(runtime.harness, threadId);
  const startRequest = (text: string, requestId: string): NativeStartRequest => ({
    project: { id: "p1", path: projectPath },
    input: input(text, requestId),
    workspace: legacyWorkspace(projectPath),
    now: Date.now(),
  });
  return {
    runtime,
    conversations,
    service,
    changes,
    queries,
    storeOf,
    start: async (text = FIRST_PROMPT, requestId = "start-1") =>
      (await service.startThread(startRequest(text, requestId))).id,
  };
}

async function sdkWorld(
  script: (world: OfflineWorld) => ScriptedTurn[],
  options: SdkRigOptions = {},
): Promise<SdkWorld> {
  const directory = options.directory ?? (await tempDir());
  const runtime = await openRuntimeWorld(directory);
  cleanups.push(() => runtime.close().catch(() => undefined));
  const world = createOfflineWorld("tau-service-fixture");
  cleanups.push(() => rmSync(world.root, { recursive: true, force: true }));
  const server = await startFakeAnthropicServer({
    apiKey: FAKE_API_KEY,
    script: script(world),
    model: MODEL,
  });
  cleanups.push(() => server.close());
  const stderr = { text: "" };
  const policy = nativeLaunchPolicy({
    sandbox: {
      settings: () => ({ main: true, worktree: false, subagent: false }),
      scopeOf: async () => "main",
      trustOf: async () => ({ kind: "main", root: world.cwd }),
      home: world.home,
      tmp: world.tmp,
    },
    spawn: recordingSpawn(stderr),
  });
  const policyFor = (threadId: string, cwd: string): NativeRunPolicy => {
    const run = policy.forThread(threadId, cwd);
    return {
      prepare: run.prepare,
      launch: (spec) =>
        run.launch({ ...spec, env: { ...hermeticEnv(spec.env), ...childEnvironment(world, server.url) } }),
    };
  };
  const offlineExtras = () => ({
    model: MODEL,
    title: "native service",
    strictMcpConfig: true,
    settings: { disableClaudeAiConnectors: true, autoCompactEnabled: false },
    includePartialMessages: true,
    env: childEnvironment(world, server.url),
  });
  const buildOptions = (ctx: { threadId: string; cwd: string }) =>
    options.asking
      ? { ...buildNativeOptions({ ...ctx, settingSources: [] }), ...offlineExtras() }
      : {
          cwd: world.cwd,
          systemPrompt: "You are a test agent.",
          tools: [],
          settingSources: [],
          permissionMode: "dontAsk",
          ...offlineExtras(),
        };
  const make = (forRuntime: RuntimeWorld) =>
    assemble(forRuntime, world.cwd, {
      query: options.query ?? realQuery,
      policyFor,
      buildOptions,
      ...(options.asking?.approvals && { approvals: options.asking.approvals }),
    });
  const rig = make(runtime);
  cleanups.push(() => rig.service.close());
  return { world, server, stderr, runtime, rig, rigOn: make };
}

const context = (sdk: SdkWorld): string =>
  `violations=${JSON.stringify(sdk.server.violations)}\nstderr=${sdk.stderr.text.slice(-2000)}`;

const lifecycleOf = async (rig: Rig, threadId: string) =>
  (await rig.storeOf(threadId).operationState()).lifecycle;

const waitForLifecycle = (rig: Rig, threadId: string, expected: string, timeoutMs?: number) =>
  waitUntil(async () => (await lifecycleOf(rig, threadId)) === expected, `lifecycle ${expected}`, timeoutMs);

describe.skipIf(!sandboxExecAvailable())(
  "native service with the real SDK under the sandbox, offline",
  () => {
    it("starts a thread, runs its first message detached, and mirrors the run on the sidebar", async () => {
      const sdk = await sdkWorld(() => [finalTurn(FIRST_ANSWER)]);
      const { rig } = sdk;

      const threadId = await rig.start();

      expect(await rig.service.isNative(threadId)).toBe(true);
      expect((await rig.conversations.find(threadId))?.executor).toBe("claude-code");
      await waitForLifecycle(rig, threadId, "completed");
      await rig.service.settled();
      expect(sdk.server.violations, context(sdk)).toEqual([]);
      const events = await eventsOf(rig.storeOf(threadId));
      expect(events).toContainEqual(expect.objectContaining({ type: "assistant-text", text: FIRST_ANSWER }));
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining(["session", "usage", "result"]),
      );
      expect(await rig.storeOf(threadId).pending()).toEqual([]);
      expect(sdk.server.messageRequests).toHaveLength(1);
      expect(spawnedPids).toHaveLength(1);
      expect(spawnedFiles).toEqual(["/usr/bin/sandbox-exec"]);
      expect(existsSync(join(sdk.world.home, ".claude"))).toBe(true);
      expect(await rig.conversations.find(threadId)).toMatchObject({ status: "idle", model: null });
      expect((await rig.conversations.find(threadId))?.lastRunEndedAt).toEqual(expect.any(Number));
      expect(new Set(rig.changes)).toEqual(new Set(["p1"]));
      expect(modelCallsOf(sdk.runtime.setup)).toBe(0);
    });

    it("runs a second send after completion on the same SDK session", async () => {
      const mentions = (request: { messages: unknown }, text: string) =>
        JSON.stringify(request.messages).includes(text);
      const sdk = await sdkWorld(() => [
        finalTurn(FIRST_ANSWER),
        finalTurn(SECOND_ANSWER, (request) =>
          [FIRST_PROMPT, FIRST_ANSWER, SECOND_PROMPT].every((text) => mentions(request, text))
            ? undefined
            : "the second request does not carry the first turn",
        ),
      ]);
      const { rig } = sdk;
      const threadId = await rig.start();
      await waitForLifecycle(rig, threadId, "completed");
      await rig.service.settled();
      const sessionId = (await rig.storeOf(threadId).operationState()).sessionId;

      await rig.service.send(threadId, input(SECOND_PROMPT, "send-2"));
      await waitUntil(
        async () =>
          (await eventsOf(rig.storeOf(threadId))).filter((event) => event.type === "result").length === 2,
        "the second result",
      );
      await rig.service.settled();

      expect(sdk.server.violations, context(sdk)).toEqual([]);
      expect(sessionId).toEqual(expect.any(String));
      expect(rig.queries[0]?.resume).toBeUndefined();
      expect(rig.queries[1]?.resume).toBe(sessionId);
      expect((await rig.storeOf(threadId).operationState()).sessionId).toBe(sessionId);
      expect(sdk.server.messageRequests).toHaveLength(2);
      expect(spawnedPids).toHaveLength(2);
      expect(await lifecycleOf(rig, threadId)).toBe("completed");
    });

    it("queues a send made while a run is in progress and runs it exactly once afterwards", async () => {
      const { held, release } = releasable();
      const sdk = await sdkWorld(() => [
        { ...finalTurn(FIRST_ANSWER), holdResponseUntil: held },
        finalTurn(SECOND_ANSWER),
      ]);
      const { rig } = sdk;
      const threadId = await rig.start();
      await sdk.server.messageRequestArrived(1);

      const receipt = await rig.service.send(threadId, input(SECOND_PROMPT, "send-2"));
      const duplicate = await rig.service.send(threadId, input(SECOND_PROMPT, "send-2"));

      expect(duplicate).toEqual(receipt);
      expect((await rig.storeOf(threadId).pending()).map((item) => item.requestId)).toEqual(["send-2"]);
      expect(sdk.server.messageRequests).toHaveLength(1);
      expect(spawnedPids).toHaveLength(1);

      release();
      await waitUntil(
        async () =>
          (await eventsOf(rig.storeOf(threadId))).filter((event) => event.type === "result").length === 2,
        "both results",
      );
      await rig.service.settled();
      await sleep(200);

      expect(sdk.server.violations, context(sdk)).toEqual([]);
      expect(sdk.server.messageRequests).toHaveLength(2);
      expect(spawnedPids).toHaveLength(2);
      expect(await rig.storeOf(threadId).pending()).toEqual([]);
      expect((await rig.storeOf(threadId).operationState()).history).toHaveLength(1);
    });

    it("cancels the running turn, keeps queued input and runs nothing more", async () => {
      const { held } = releasable();
      const sdk = await sdkWorld(() => [
        { ...finalTurn("never delivered"), holdResponseUntil: held },
        finalTurn("unused"),
      ]);
      const { rig } = sdk;
      const threadId = await rig.start();
      await sdk.server.messageRequestArrived(1);
      await waitUntil(
        async () => (await rig.storeOf(threadId).operationState()).operation?.identity !== undefined,
        "identity",
      );
      await rig.service.send(threadId, input(SECOND_PROMPT, "send-2"));
      const operation = (await rig.storeOf(threadId).operationState()).operation;

      const result = await rig.service.cancel(threadId);
      await rig.service.settled();

      expect(result).toEqual({ status: "cancelled", outcome: "cancelled" });
      expect(await lifecycleOf(rig, threadId)).toBe("cancelled");
      expect(isGone(operation?.identity?.pid ?? 0)).toBe(true);
      expect((await rig.storeOf(threadId).pending()).map((item) => item.requestId)).toEqual(["send-2"]);
      expect(await rig.service.cancel(threadId)).toEqual({ status: "idle" });
      await sleep(200);
      expect(sdk.server.messageRequests).toHaveLength(1);
      expect(spawnedPids).toHaveLength(1);
      expect(await rig.conversations.find(threadId)).toMatchObject({ status: "idle" });
    });

    it("marks a run cut off by a restart outcome-unknown, stops its child and never relaunches", async () => {
      const { held } = releasable();
      const directory = await tempDir();
      const sdk = await sdkWorld(
        () => [{ ...finalTurn("never delivered"), holdResponseUntil: held }, finalTurn("unused")],
        {
          directory,
        },
      );
      const threadId = await sdk.rig.start();
      await sdk.server.messageRequestArrived(1);
      await waitUntil(async () => {
        const state = await sdk.rig.storeOf(threadId).operationState();
        return state.operation?.identity !== undefined && state.eventCount > 0;
      }, "identity and the first event");
      const identity = (await sdk.rig.storeOf(threadId).operationState()).operation?.identity;
      expect(isGone(identity?.pid ?? 0)).toBe(false);

      await sdk.runtime.close();
      const restarted = await openRuntimeWorld(directory, sdk.runtime.setup);
      cleanups.push(() => restarted.close().catch(() => undefined));
      const afterRestart = sdk.rigOn(restarted);

      const reconciled = await afterRestart.service.reconcileAll();

      expect(reconciled).toEqual([{ threadId, outcome: "outcome-unknown" }]);
      expect(await lifecycleOf(afterRestart, threadId)).toBe("outcome-unknown");
      expect(isGone(identity?.pid ?? 0)).toBe(true);
      await sleep(300);
      expect(sdk.server.messageRequests).toHaveLength(1);
      expect(spawnedPids).toHaveLength(1);
      expect(await afterRestart.conversations.find(threadId)).toMatchObject({ status: "error" });
      expect(modelCallsOf(restarted.setup)).toBe(0);
      expect(await afterRestart.service.reconcileAll()).toEqual([{ threadId, outcome: "settled" }]);
    });
  },
);

const BASH_ID = "toolu_fake_bash_service";

const approvalsFor = (): Approvals =>
  createApprovals({
    settings: {
      get: async () =>
        ({ claudeConnectors: { disabled: [], alwaysAllow: [], askBeforeWrites: true } }) as never,
      setClaudeConnectors: async () => undefined,
    },
    changes: createChangeEmitter(),
    conversationOfSession: withNativeThreads(async () => undefined),
  });

const touchTurn = (world: OfflineWorld): ScriptedTurn => ({
  blocks: [
    {
      type: "tool_use",
      id: BASH_ID,
      name: "Bash",
      input: { command: `touch ${join(world.cwd, "approved.txt")}`, description: "make approved.txt" },
    },
  ],
});

const isErrorFor =
  (id: string): ScriptedTurn["validate"] =>
  (request) =>
    toolResultsIn(request.messages.at(-1)).find((block) => block.tool_use_id === id)?.is_error === true
      ? undefined
      : `the tool call ${id} was not denied`;

describe.skipIf(!sandboxExecAvailable())("native service permissions with the real SDK, offline", () => {
  const waitingApprovals = (approvals: Approvals, threadId: string) =>
    waitUntil(async () => approvals.list(threadId).length === 1, "one waiting approval");

  it("asks the approvals service under the thread id and runs the tool once the user allows it", async () => {
    const approvals = approvalsFor();
    const sdk = await sdkWorld((world) => [touchTurn(world), finalTurn("Done. (scripted)")], {
      asking: { approvals },
    });
    const { rig } = sdk;
    const threadId = await rig.start();

    await waitingApprovals(approvals, threadId);
    expect(approvals.list(threadId)).toMatchObject([
      { toolUseId: BASH_ID, conversationId: threadId, tool: "Bash" },
    ]);
    expect(existsSync(join(sdk.world.cwd, "approved.txt"))).toBe(false);
    await approvals.decide(threadId, BASH_ID, "allow");
    await waitForLifecycle(rig, threadId, "completed");
    await rig.service.settled();

    expect(sdk.server.violations, context(sdk)).toEqual([]);
    expect(existsSync(join(sdk.world.cwd, "approved.txt"))).toBe(true);
    expect(approvals.hasPending(threadId)).toBe(false);
    expect(await eventsOf(rig.storeOf(threadId))).toContainEqual(
      expect.objectContaining({ type: "notice", code: "permission-allowed" }),
    );
  });

  it("denies every tool that needs the user when no approvals service exists", async () => {
    const sdk = await sdkWorld(
      (world) => [touchTurn(world), finalTurn("Denied. (scripted)", isErrorFor(BASH_ID))],
      { asking: {} },
    );
    const { rig } = sdk;
    const threadId = await rig.start();

    await waitForLifecycle(rig, threadId, "completed");
    await rig.service.settled();

    expect(sdk.server.violations, context(sdk)).toEqual([]);
    expect(existsSync(join(sdk.world.cwd, "approved.txt"))).toBe(false);
  });

  it("denies the waiting approval and cancels the run when the service closes", async () => {
    const approvals = approvalsFor();
    const { held } = releasable();
    const sdk = await sdkWorld(
      (world) => [touchTurn(world), { ...finalTurn("never delivered"), holdResponseUntil: held }],
      { asking: { approvals } },
    );
    const { rig } = sdk;
    const threadId = await rig.start();
    await waitingApprovals(approvals, threadId);
    const identity = (await rig.storeOf(threadId).operationState()).operation?.identity;

    await rig.service.close();

    expect(approvals.list(threadId)).toEqual([]);
    expect(await lifecycleOf(rig, threadId)).toBe("cancelled");
    expect(isGone(identity?.pid ?? 0)).toBe(true);
    expect(existsSync(join(sdk.world.cwd, "approved.txt"))).toBe(false);
  });

  it("denies the waiting approval and stops the run when the thread is removed", async () => {
    const approvals = approvalsFor();
    const { held } = releasable();
    const sdk = await sdkWorld(
      (world) => [touchTurn(world), { ...finalTurn("never delivered"), holdResponseUntil: held }],
      { asking: { approvals } },
    );
    const { rig } = sdk;
    const threadId = await rig.start();
    await waitingApprovals(approvals, threadId);
    const identity = (await rig.storeOf(threadId).operationState()).operation?.identity;

    await rig.service.onConversationRemoved(threadId);
    await rig.service.settled();

    expect(approvals.list(threadId)).toEqual([]);
    expect(await lifecycleOf(rig, threadId)).toBe("cancelled");
    expect(isGone(identity?.pid ?? 0)).toBe(true);
    expect(existsSync(join(sdk.world.cwd, "approved.txt"))).toBe(false);
  });
});

const fakeAnswer = (answer: string): NativeQueryFn => {
  let turns = 0;
  return () => {
    turns += 1;
    const uuid = `turn-${turns}`;
    return (async function* () {
      yield { type: "system", subtype: "init", session_id: "fake-session", uuid: `${uuid}-init` };
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: answer,
        session_id: "fake-session",
        uuid: `${uuid}-result`,
      };
    })();
  };
};

async function plainRig(
  deps: Partial<Pick<NativeServiceDeps, "query" | "policyFor" | "supervisor">> = {},
  directory?: string,
): Promise<Rig> {
  const root = directory ?? (await tempDir());
  const runtime = await openRuntimeWorld(root);
  cleanups.push(() => runtime.close().catch(() => undefined));
  const rig = assemble(runtime, root, { query: fakeAnswer("plain answer"), ...deps });
  cleanups.push(() => rig.service.close());
  return rig;
}

describe("native service without a process", () => {
  it("rejects empty text and attachments before admitting anything", async () => {
    const rig = await plainRig();
    const threadId = await rig.start();
    await waitForLifecycle(rig, threadId, "completed");
    await rig.service.settled();
    const before = await rig.storeOf(threadId).window();

    await expect(rig.service.send(threadId, input("   ", "empty"))).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(
      rig.service.send(threadId, {
        ...input("hi", "image"),
        images: [{ mimeType: "image/png", data: "AAAA" }],
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(rig.service.send("999", input("hi", "ghost"))).rejects.toMatchObject({ code: "not_found" });
    await expect(
      rig.service.startThread({
        project: { id: "p1", path: "/x" },
        input: input("", "blank"),
        workspace: legacyWorkspace("/x"),
        now: 1,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });

    expect(await rig.storeOf(threadId).window()).toEqual(before);
    expect(await rig.conversations.list("p1")).toHaveLength(1);
  });

  it("starts a thread idempotently by request id and never runs the first message twice", async () => {
    let runs = 0;
    const answerer = fakeAnswer("once");
    const query: NativeQueryFn = (args) => {
      runs += 1;
      return answerer(args);
    };
    const rig = await plainRig({ query });
    const [first, second] = await Promise.all([
      rig.start(FIRST_PROMPT, "same"),
      rig.start(FIRST_PROMPT, "same"),
    ]);
    await waitForLifecycle(rig, first, "completed");
    await rig.service.settled();

    expect(second).toBe(first);
    expect(runs).toBe(1);
    expect(await rig.conversations.list("p1")).toHaveLength(1);
  });

  it("blocks without spawning when the launch policy rejects, retains the input, and retries on the next send", async () => {
    let allowed = false;
    const prepared: boolean[] = [];
    const policyFor = (): NativeRunPolicy => ({
      prepare: async () => {
        prepared.push(allowed);
        return allowed ? { ok: true } : { ok: false, reason: "the sandbox cannot be enforced" };
      },
      launch: () => {
        throw new Error("never launched in this test");
      },
    });
    const rig = await plainRig({ policyFor, query: fakeAnswer("after unblock") });
    const threadId = await rig.start();
    await waitForLifecycle(rig, threadId, "blocked");
    await rig.service.settled();

    expect((await rig.storeOf(threadId).pending()).map((item) => item.requestId)).toEqual(["start-1"]);
    expect(await eventsOf(rig.storeOf(threadId))).toContainEqual(
      expect.objectContaining({ type: "notice", code: "blocked" }),
    );
    expect(await rig.conversations.find(threadId)).toMatchObject({ status: "error" });
    expect(prepared).toEqual([false]);

    allowed = true;
    await rig.service.send(threadId, input(SECOND_PROMPT, "send-2"));
    await waitForLifecycle(rig, threadId, "completed");
    await rig.service.settled();
    expect(await rig.storeOf(threadId).pending()).toEqual([]);
  });

  it("turns a failing run into a notice, never an unhandled rejection, and keeps the input", async () => {
    let failing = true;
    const rig = await plainRig();
    const failingStore = (threadId: string): RuntimeStore => {
      const real = createRuntimeStore(rig.runtime.harness, threadId);
      return new Proxy(real, {
        get: (target, property, receiver) =>
          property === "beginOperation" && failing
            ? () => Promise.reject(new Error("store exploded"))
            : Reflect.get(target, property, receiver),
      });
    };
    const service = createNativeService({
      harness: rig.runtime.harness,
      conversations: rig.conversations,
      query: fakeAnswer("recovered"),
      createStore: failingStore,
      onChange: () => undefined,
    });
    const threadId = (
      await service.startThread({
        project: { id: "p1", path: rig.runtime.directory },
        input: input(FIRST_PROMPT, "boom-1"),
        workspace: legacyWorkspace(rig.runtime.directory),
        now: Date.now(),
      })
    ).id;
    await service.settled();

    const events = await eventsOf(rig.storeOf(threadId));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "notice",
        code: "pump-error",
        text: expect.stringContaining("store exploded"),
      }),
    );
    expect((await rig.storeOf(threadId).pending()).map((item) => item.requestId)).toEqual(["boom-1"]);
    expect(await rig.conversations.find(threadId)).toMatchObject({ status: "error" });

    failing = false;
    await service.send(threadId, input(SECOND_PROMPT, "boom-2"));
    await service.settled();
    expect(await rig.storeOf(threadId).pending()).toEqual([]);
    expect(await lifecycleOf(rig, threadId)).toBe("completed");
  });

  it("settles a query that throws as outcome-unknown, stops the pump and keeps later input queued", async () => {
    const query: NativeQueryFn = () => {
      throw new Error("the SDK refused to start");
    };
    const rig = await plainRig({ query });
    const threadId = await rig.start();
    await waitForLifecycle(rig, threadId, "outcome-unknown");
    await rig.service.settled();

    await rig.service.send(threadId, input(SECOND_PROMPT, "send-2"));
    await rig.service.settled();
    await sleep(100);

    expect((await rig.storeOf(threadId).pending()).map((item) => item.requestId)).toEqual(["send-2"]);
    expect(await lifecycleOf(rig, threadId)).toBe("outcome-unknown");
  });

  it("applies persisted state at startup without launching, then resumes once the unknown outcome is acknowledged", async () => {
    const directory = await tempDir();
    const first = await plainRig({}, directory);
    const { summary } = await createNativeConversation(first.runtime.harness, {
      project: { id: "p1", path: directory },
      input: input(FIRST_PROMPT, "seeded"),
      workspace: legacyWorkspace(directory),
      now: 10,
    });
    const store = first.storeOf(summary.id);
    await store.admit({
      threadId: summary.id,
      requestId: "seeded",
      payload: { text: FIRST_PROMPT, attachmentIds: [], origin: "user", delivery: "queue" },
    });
    for (const step of ["preparing", "ready"] as const) await store.setLifecycle(step);
    await store.recordLaunchIntent({ operationId: "op-1", nonce: "n-1" });
    await store.recordIdentity({ pid: 424242, startTime: 1_700_000_000_000, nonce: "n-1", pgid: 424242 });
    await store.markDeliveredOnce("seeded");
    await store.markDelivered("seeded");
    await store.admit({
      threadId: summary.id,
      requestId: "waiting",
      payload: { text: SECOND_PROMPT, attachmentIds: [], origin: "user", delivery: "queue" },
    });
    const signals: unknown[] = [];
    const supervisor: Partial<SupervisorDeps> = {
      processTable: { find: async () => undefined, list: async () => [] },
      sendSignal: (pid, signal) => void signals.push([pid, signal]),
    };
    let launched = 0;
    const answerer = fakeAnswer("after acknowledgement");
    const query: NativeQueryFn = (args) => {
      launched += 1;
      return answerer(args);
    };
    await first.runtime.close();
    const reopened = await openRuntimeWorld(directory, first.runtime.setup);
    cleanups.push(() => reopened.close().catch(() => undefined));
    const rig = assemble(reopened, directory, { query, supervisor });

    expect(await rig.service.reconcileAll()).toEqual([{ threadId: summary.id, outcome: "outcome-unknown" }]);
    await rig.service.send(summary.id, input("another", "extra"));
    await rig.service.settled();

    expect(launched).toBe(0);
    expect(signals).toEqual([]);
    expect((await rig.storeOf(summary.id).pending()).map((item) => item.requestId)).toEqual([
      "waiting",
      "extra",
    ]);

    await rig.storeOf(summary.id).acknowledgeUnknown({ operationId: "op-1", note: "checked by hand" });
    await rig.service.send(summary.id, input("one more", "after-ack"));
    await waitUntil(async () => (await rig.storeOf(summary.id).pending()).length === 0, "the queue to drain");
    await rig.service.settled();

    expect(launched).toBe(3);
  });

  it("reports a thread that is not native, and a deleted one", async () => {
    const rig = await plainRig();
    const threadId = await rig.start();
    await waitForLifecycle(rig, threadId, "completed");
    await rig.service.settled();

    expect(await rig.service.isNative("12345")).toBe(false);
    await rig.conversations.remove(threadId, Date.now());
    const another = assemble(rig.runtime, rig.runtime.directory, { query: fakeAnswer("x") });
    expect(await another.service.isNative(threadId)).toBe(false);
  });
});
