import { join } from "node:path";
import type { Harness } from "@earendil-works/pi-durable";
import {
  type ConversationId,
  defineDoc,
  defineExtension,
  defineTask,
  defineTool,
  hook,
  ToolTask,
} from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { createChangeEmitter } from "../change-emitter";
import { createStatusTracker } from "../status/status-tracker";
import { processToolServices } from "../test-support/process-tool-services";
import { createFauxSetup, type FauxSetup } from "../testing/faux-provider";
import { ConversationDoc, INDEX_SEED, ProjectIndexDoc } from "./conversation-docs";
import { legacyWorkspace } from "./conversation-index";
import { type ConversationStore, createConversationStore } from "./conversation-store";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "./open";
import { createAgentRegistry } from "./registry";

export const NATIVE_DOC_KIND = "native.thread";
export const NATIVE_ENTRY_KIND = "native.event";
export const NATIVE_TASK_NAME = "native.wait";

export type NativeThreadState = { sessionId: string; events: string[] };

/** A conversation document of a kind Pi does not own: the native thread's own state. */
export const NativeThreadDoc = defineDoc<NativeThreadState>({
  kind: NATIVE_DOC_KIND,
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ sessionId: "", events: [] }),
});

export type NativeWaitInput = { label: string; waitMs: number };
type NativeWaitState = { phase: "begin" } | { phase: "sleep"; until: number };

/** A custom durable task with a real timed wait; its result is `{ label }`. */
export const NativeWaitTask = defineTask<NativeWaitInput, NativeWaitState, { label: string }>({
  name: NATIVE_TASK_NAME,
  version: 1,
  initial: () => ({ phase: "begin" }),
  phases: {
    begin: (task, runtime, taskContext) =>
      runtime.commit(async (tx) => {
        (await tx.doc(NativeThreadDoc, runtime.conversationId)).events.push(`task-begin:${task.input.label}`);
        return {
          status: "running",
          checkpoint: { phase: "sleep", until: runtime.now() + task.input.waitMs },
        };
      }, taskContext),
    sleep: async (task, runtime, taskContext) => {
      await runtime.sleep(task.state.checkpoint.until, taskContext);
      await runtime.commit(async (tx) => {
        (await tx.doc(NativeThreadDoc, runtime.conversationId)).events.push(`task-done:${task.input.label}`);
        return {
          status: "terminal",
          outcome: { status: "completed", result: { label: task.input.label } },
        };
      }, taskContext);
    },
  },
  abort: (_task, runtime, taskContext) =>
    runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), taskContext),
});

export interface PiWorkCounters {
  /** Provider requests the faux model served. */
  modelCalls(): number;
  /** Executions of the counting tool. */
  toolExecutions: number;
  /** Tool tasks that reached `beforeTool`, for any tool. */
  toolTasks: number;
}

function countingExtension(counters: PiWorkCounters) {
  const countingTool = defineTool({
    name: "spike_count",
    description: "Counts its executions.",
    parameters: Type.Object({}),
    execute: async () => {
      counters.toolExecutions += 1;
      return { output: [{ type: "text", text: "counted" }] };
    },
  });
  return defineExtension({
    name: "spike-native",
    tools: [countingTool],
    hooks: [
      hook(ToolTask, {
        beforeTool: () => {
          counters.toolTasks += 1;
          return undefined;
        },
      }),
    ],
    tasks: [NativeWaitTask],
  });
}

export interface SpikeWorld {
  readonly harness: Harness;
  readonly store: ConversationStore;
  readonly counters: PiWorkCounters;
  readonly faux: FauxSetup["faux"];
  readonly project: { readonly id: string; readonly path: string };
  close(): Promise<void>;
}

export interface SpikeWorldOptions {
  readonly directory: string;
  /** Pass the first world's setup to a reopened world so the model counter spans the restart. */
  readonly setup?: FauxSetup;
  readonly counters?: PiWorkCounters;
}

export function newCounters(setup: FauxSetup): PiWorkCounters {
  return {
    modelCalls: () => setup.faux.state.callCount,
    toolExecutions: 0,
    toolTasks: 0,
  };
}

/** Opens the same wiring `createCore` uses for conversations, over `agent.sqlite` in `directory`. */
export async function openSpikeWorld(options: SpikeWorldOptions): Promise<SpikeWorld & { setup: FauxSetup }> {
  const { directory } = options;
  const setup = options.setup ?? createFauxSetup();
  const counters = options.counters ?? newCounters(setup);
  const status = createStatusTracker({ changes: createChangeEmitter(), now: Date.now });
  const harness = await openAgentHarness({
    storage: await openSqliteStorage(join(directory, "agent.sqlite")),
    models: setup.models,
    registry: createAgentRegistry(processToolServices(directory), undefined, undefined, [
      countingExtension(counters),
    ]),
    beforeResume: (opened) => status.attach(opened),
  });
  const store = createConversationStore(harness, async () => directory);
  return {
    harness,
    store,
    counters,
    faux: setup.faux,
    project: { id: "p1", path: directory },
    setup,
    close: () => harness.close(BACKGROUND),
  };
}

export interface ContainerRequest {
  readonly title: string;
  readonly sessionId: string;
  readonly now: number;
}

/**
 * Creates a conversation with an index entry and `app.conversation` meta (so Tau lists it) and no `pendingFirstInput`,
 * no model, and no submission: Pi is never asked to do anything.
 */
export async function createPassiveContainer(world: SpikeWorld, request: ContainerRequest) {
  const { project } = world;
  return world.harness.createConversation(
    {
      ownership: { kind: "ownerless" },
      agent: { cwd: project.path },
      init: async (tx, conversationId) => {
        const meta = await tx.doc(ConversationDoc, conversationId);
        meta.projectId = project.id;
        meta.title = request.title;
        meta.titleSource = "user";
        const native = await tx.doc(NativeThreadDoc, conversationId);
        native.sessionId = request.sessionId;
        const index = await tx.doc(ProjectIndexDoc, project.id, INDEX_SEED);
        index.conversations.push({
          conversationId: Number(conversationId),
          title: request.title,
          createdAt: request.now,
          updatedAt: request.now,
          status: "idle",
          workspace: legacyWorkspace(project.path),
        });
      },
    },
    BACKGROUND,
  );
}

export async function appendNativeEvent(harness: Harness, id: ConversationId, event: string) {
  await harness.commit(async (tx) => {
    (await tx.doc(NativeThreadDoc, id)).events.push(event);
  }, BACKGROUND);
}
