import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Conversation, ConversationId, Harness } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFauxSetup } from "../../testing/faux-provider";
import { legacyWorkspace } from "../conversation-index";
import { type ConversationStore, createConversationStore } from "../conversation-store";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "../open";
import { createAgentRegistry } from "../registry";
import { findOrCreateChild } from "./task-child";
import { TodosDoc, todoWriteToolFile } from "./todo-write";
import { createToolServicesRef } from "./tool-file";

const FAUX = { provider: "faux", modelId: "faux-1" };

let root: string;
let project: string;
let harness: Harness | undefined;
let store: ConversationStore;

async function open() {
  harness = await openAgentHarness({
    storage: await openSqliteStorage(join(root, "agent.sqlite")),
    models: createFauxSetup().models,
    registry: createAgentRegistry(),
  });
  store = createConversationStore(harness, async () => project);
  return harness;
}

async function startThread(text: string, requestId: string) {
  const { summary } = await store.start({
    project: {
      id: "p1",
      name: "main",
      path: project,
      createdAt: 0,
      kind: "folder",
      status: "ready",
      isGitRepo: false,
    },
    model: FAUX,
    thinkingLevel: "off",
    input: { text, requestId },
    workspace: legacyWorkspace(project),
    now: Date.now(),
  });
  return summary;
}

async function untilIdle(h: Harness, id: string) {
  const conversation = await h.conversation(Number(id) as never, BACKGROUND);
  await conversation?.waitForIdle(BACKGROUND);
  return conversation as Conversation;
}

async function childrenOf(parentId: string) {
  return (await store.list("p1")).filter((thread) => thread.parentId === parentId);
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "task-todo-")));
  project = join(root, "project");
  await mkdir(project);
});

afterEach(async () => {
  await harness?.close(BACKGROUND);
  harness = undefined;
  await rm(root, { recursive: true, force: true });
});

describe("task tool", () => {
  it("makes a child thread that answers and links to its parent", async () => {
    const h = await open();
    const { id } = await startThread("task look around", "r1");
    await untilIdle(h, id);
    const [child, ...rest] = await childrenOf(id);
    expect(rest).toEqual([]);
    expect(child).toMatchObject({ title: "look around", parentId: id });
  });

  it("makes one child per call, so several tasks in a thread give several children", async () => {
    const h = await open();
    const { id } = await startThread("task first job", "r1");
    const conversation = await untilIdle(h, id);
    await store.send(id, { text: "task second job", requestId: "r2" }, Date.now());
    await conversation.waitForIdle(BACKGROUND);
    const titles = (await childrenOf(id)).map((child) => child.title).sort();
    expect(titles).toEqual(["first job", "second job"]);
  });

  it("finds the same child when the same task runs again", async () => {
    const h = await open();
    const { id } = await startThread("task same job", "r1");
    const conversation = await untilIdle(h, id);
    const spawnAgain = (taskId: string) =>
      conversation.commit(
        (tx) =>
          findOrCreateChild(tx, {
            taskId,
            parentId: Number(id) as ConversationId,
            description: "same job",
            withoutExtension: () => undefined,
          }),
        BACKGROUND,
      );
    const [child] = await childrenOf(id);
    const owned = await conversation.commit(
      async (tx) => (await tx.scanTasks({ conversationId: Number(id) as ConversationId }, 50)).items,
      BACKGROUND,
    );
    const owner = await conversation.commit(async (tx) => {
      for (const record of owned) {
        const children = await tx.scanConversations({ ownerTaskId: record.id } as never, 1);
        if (children.items.length) return String(record.id);
      }
      return undefined;
    }, BACKGROUND);
    const again = await spawnAgain(owner as string);
    expect(String(again)).toBe(child?.id);
    expect(await childrenOf(id)).toHaveLength(1);
  });
});

describe("todo_write tool", () => {
  it("replaces the whole list in the conversation doc", async () => {
    const h = await open();
    const { id } = await startThread("hello", "r1");
    const conversation = await untilIdle(h, id);
    const tool = todoWriteToolFile(createToolServicesRef()).extension.tools?.[0] as unknown as {
      execute(args: unknown, api: unknown, context: unknown): Promise<{ output: { text: string }[] }>;
    };
    const api = {
      conversationId: Number(id),
      commit: (change: never, context: never) => conversation.commit(change, context),
    };
    await tool.execute(
      {
        todos: [
          { content: "a", status: "pending" },
          { content: "b", status: "pending" },
        ],
      },
      api,
      BACKGROUND,
    );
    const result = await tool.execute({ todos: [{ content: "b", status: "completed" }] }, api, BACKGROUND);
    expect(result.output[0]?.text).toBe("Todos updated: 1/1 completed.");
    const doc = await h.snapshot(TodosDoc, Number(id) as ConversationId, BACKGROUND);
    expect(doc?.todos).toEqual([{ content: "b", status: "completed" }]);
  });
});
