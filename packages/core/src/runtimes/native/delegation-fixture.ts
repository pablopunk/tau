import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { type Options, query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { Project } from "@tau/protocol";
import { legacyWorkspace } from "../../harness/conversation-index";
import { createNativeConversation } from "../../harness/conversation-native";
import { type ConversationStore, createConversationStore } from "../../harness/conversation-store";
import { createRuntimeStore, type RuntimeStore } from "../../harness/runtime-store";
import { openRuntimeWorld, type RuntimeWorld } from "../../harness/runtime-store-fixture";
import { classifyThread } from "../../processes/governor/governed";
import {
  type FakeAnthropicServer,
  type ScriptedTurn,
  startFakeAnthropicServer,
} from "../testing/fake-anthropic-server";
import {
  childEnvironment,
  createOfflineWorld,
  FAKE_API_KEY,
  type OfflineWorld,
} from "../testing/offline-sandbox";
import type { NativeQueryFn } from "./controller";
import { createNativeDelegation, type NativeDelegation } from "./delegation";
import type { NativeEvent } from "./events";
import { type NativeRunPolicy, type NativeSpawn, nativeLaunchPolicy } from "./launch-policy";
import { createNativeService, type NativeService } from "./service";

const MODEL = "claude-sonnet-4-5";
const SDK_VARIABLE = /^(CLAUDE_CODE_|CLAUDE_AGENT_SDK)/;
const CREDENTIAL_NAME = /TOKEN|KEY|SECRET|OAUTH|AUTH|PASSWORD/;

export const PROJECT_ID = "p1";

export type Cleanups = (() => void | Promise<void>)[];

export interface DelegationRig {
  readonly runtime: RuntimeWorld;
  readonly conversations: ConversationStore;
  readonly service: NativeService;
  readonly delegation: NativeDelegation;
  readonly parentId: string;
  readonly queries: Record<string, unknown>[];
  readonly project: Project;
  storeOf(threadId: string): RuntimeStore;
  childrenOf(): Promise<string[]>;
}

export const eventsOf = async (store: RuntimeStore): Promise<NativeEvent[]> =>
  (await store.events()).map((entry) => entry.event);

const projectAt = (path: string): Project => ({
  id: PROJECT_ID,
  name: "main",
  path,
  createdAt: 0,
  kind: "folder",
  status: "ready",
  isGitRepo: false,
});

async function parentThreadIn(runtime: RuntimeWorld, project: Project): Promise<string> {
  const { summary } = await createNativeConversation(runtime.harness, {
    project,
    input: { text: "parent", requestId: "parent-start" },
    workspace: legacyWorkspace(project.path),
    now: Date.now(),
  });
  return summary.id;
}

export interface RigInputs {
  readonly project: Project;
  readonly query: NativeQueryFn;
  readonly policyFor?: (threadId: string, cwd: string) => NativeRunPolicy;
  readonly buildOptions?: (ctx: { threadId: string; cwd: string }) => Record<string, unknown>;
  readonly pollMs?: number;
  readonly parentId?: string;
}

/** A service and delegation over `runtime`, with a native parent thread that never runs. */
export async function assembleRig(runtime: RuntimeWorld, inputs: RigInputs): Promise<DelegationRig> {
  const conversations = createConversationStore(runtime.harness, async () => inputs.project.path);
  const queries: Record<string, unknown>[] = [];
  const query: NativeQueryFn = (args) => {
    queries.push(args.options);
    return inputs.query(args);
  };
  const service = createNativeService({
    harness: runtime.harness,
    conversations,
    query,
    ...(inputs.policyFor && { policyFor: inputs.policyFor }),
    ...(inputs.buildOptions && { buildOptions: inputs.buildOptions }),
    onChange: () => undefined,
  });
  const delegation = createNativeDelegation({
    service,
    harness: runtime.harness,
    conversations,
    ...(inputs.pollMs !== undefined && { pollMs: inputs.pollMs }),
  });
  const parentId = inputs.parentId ?? (await parentThreadIn(runtime, inputs.project));
  return {
    runtime,
    conversations,
    service,
    delegation,
    parentId,
    queries,
    project: inputs.project,
    storeOf: (threadId) => createRuntimeStore(runtime.harness, threadId),
    childrenOf: async () =>
      (await conversations.list(PROJECT_ID))
        .filter((thread) => thread.parentId === parentId)
        .map((t) => t.id),
  };
}

export async function fakeRig(directory: string, query: NativeQueryFn, cleanups: Cleanups, pollMs = 10) {
  const runtime = await openRuntimeWorld(directory);
  cleanups.push(() => runtime.close().catch(() => undefined));
  const rig = await assembleRig(runtime, { project: projectAt(directory), query, pollMs });
  cleanups.push(() => rig.service.close());
  return rig;
}

export interface FakeRun {
  readonly text?: string;
  readonly isError?: boolean;
  /** Ends the stream without a result: the controller settles `outcome-unknown`. */
  readonly noResult?: boolean;
  /** The stream waits for this (or for `interrupt`) before it ends. */
  readonly hold?: Promise<void>;
}

export interface FakeQuery {
  readonly query: NativeQueryFn;
  readonly runs: () => number;
}

export function fakeQuery(run: FakeRun = {}): FakeQuery {
  let runs = 0;
  const query: NativeQueryFn = () => {
    runs += 1;
    const uuid = `fake-${runs}`;
    let stop: () => void = () => undefined;
    const interrupted = new Promise<void>((resolve) => {
      stop = resolve;
    });
    const stream = (async function* () {
      yield { type: "system", subtype: "init", session_id: "fake-session", uuid: `${uuid}-init` };
      if (run.hold) await Promise.race([run.hold, interrupted]);
      if (run.text) {
        yield {
          type: "assistant",
          uuid: `${uuid}-a`,
          session_id: "fake-session",
          message: { id: `${uuid}-m`, content: [{ type: "text", text: run.text }] },
        };
      }
      if (run.noResult) return;
      yield {
        type: "result",
        subtype: run.isError ? "error_during_execution" : "success",
        is_error: run.isError === true,
        result: run.text ?? "",
        session_id: "fake-session",
        uuid: `${uuid}-result`,
      };
    })();
    return Object.assign(stream, { interrupt: async () => stop(), close: () => stop() });
  };
  return { query, runs: () => runs };
}

const hermeticEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(env).filter(
      ([name]) => name === "TAU_RUNTIME_NONCE" || (SDK_VARIABLE.test(name) && !CREDENTIAL_NAME.test(name)),
    ),
  );

export interface Spawned {
  readonly pids: number[];
  readonly files: string[];
}

function recordingSpawn(spawned: Spawned): NativeSpawn {
  return (file, args, options) => {
    const child = spawn(file, [...args], {
      cwd: options.cwd,
      env: options.env as Record<string, string>,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      ...(options.signal && { signal: options.signal }),
    });
    if (child.pid !== undefined) spawned.pids.push(child.pid);
    spawned.files.push(file);
    return child;
  };
}

export interface SdkWorld {
  readonly world: OfflineWorld;
  readonly server: FakeAnthropicServer;
  readonly spawned: Spawned;
  readonly rig: DelegationRig;
  readonly runtime: RuntimeWorld;
  /** The same node after a restart: new harness over the same files, new service. */
  reopen(): Promise<DelegationRig>;
}

const realQuery: NativeQueryFn = ({ prompt, options }) => sdkQuery({ prompt, options: options as Options });

/** The real Agent SDK under sandbox-exec, offline, against a scripted server; only the subagent scope is sandboxed. */
export async function sdkWorld(
  directory: string,
  script: (world: OfflineWorld) => ScriptedTurn[],
  cleanups: Cleanups,
): Promise<SdkWorld> {
  const runtime = await openRuntimeWorld(directory);
  cleanups.push(() => runtime.close().catch(() => undefined));
  const world = createOfflineWorld("tau-delegation-fixture");
  cleanups.push(() => rmSync(world.root, { recursive: true, force: true }));
  const server = await startFakeAnthropicServer({
    apiKey: FAKE_API_KEY,
    script: script(world),
    model: MODEL,
  });
  cleanups.push(() => server.close());
  const spawned: Spawned = { pids: [], files: [] };
  const project = projectAt(world.cwd);
  const holder: { conversations?: ConversationStore } = {};
  const policy = nativeLaunchPolicy({
    sandbox: {
      settings: () => ({ main: false, worktree: false, subagent: true }),
      scopeOf: async (id) => {
        const thread = await holder.conversations?.find(id);
        return thread
          ? classifyThread({ parentId: thread.parentId ?? undefined, workspace: thread.workspace })
          : "unknown";
      },
      trustOf: async () => ({ kind: "checkout", root: world.cwd }),
      home: world.home,
      tmp: world.tmp,
    },
    spawn: recordingSpawn(spawned),
  });
  const policyFor = (threadId: string, cwd: string): NativeRunPolicy => {
    const run = policy.forThread(threadId, cwd);
    return {
      prepare: run.prepare,
      launch: (spec) =>
        run.launch({ ...spec, env: { ...hermeticEnv(spec.env), ...childEnvironment(world, server.url) } }),
    };
  };
  const buildOptions = () => ({
    cwd: world.cwd,
    systemPrompt: "You are a test agent.",
    tools: [],
    settingSources: [],
    permissionMode: "dontAsk",
    model: MODEL,
    title: "delegation",
    strictMcpConfig: true,
    settings: { disableClaudeAiConnectors: true, autoCompactEnabled: false },
    includePartialMessages: true,
    env: childEnvironment(world, server.url),
  });
  const make = async (over: RuntimeWorld, parentId?: string) => {
    const rig = await assembleRig(over, {
      project,
      query: realQuery,
      policyFor,
      buildOptions,
      pollMs: 10,
      ...(parentId && { parentId }),
    });
    holder.conversations = rig.conversations;
    return rig;
  };
  const rig = await make(runtime);
  cleanups.push(() => rig.service.close());
  return {
    world,
    server,
    spawned,
    rig,
    runtime,
    reopen: async () => {
      await runtime.close();
      const restarted = await openRuntimeWorld(directory, runtime.setup);
      cleanups.push(() => restarted.close().catch(() => undefined));
      const reopened = await make(restarted, rig.parentId);
      cleanups.push(() => reopened.service.close());
      return reopened;
    },
  };
}
