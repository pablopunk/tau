import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configure,
  defineExtension,
  defineTool,
  type Harness,
  type InboxState,
  type LiveState,
} from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFauxSetup } from "../testing/faux-provider";
import { registerChildConversation } from "./conversation-child";
import { ConversationDoc } from "./conversation-docs";
import { legacyWorkspace } from "./conversation-index";
import { type ConversationStore, createConversationStore } from "./conversation-store";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "./open";
import { createAgentRegistry } from "./registry";

const FAUX = { provider: "faux", modelId: "faux-1" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let root: string;
let project: string;
let other: string;
let harness: Harness | undefined;
let store: ConversationStore;

async function open(extra?: Parameters<ReturnType<typeof createAgentRegistry>["install"]>[0]) {
  const registry = createAgentRegistry();
  if (extra) registry.install(extra);
  harness = await openAgentHarness({
    storage: await openSqliteStorage(join(root, "agent.sqlite")),
    models: createFauxSetup().models,
    registry,
  });
  store = createConversationStore(harness, async () => project);
  return harness;
}

async function startThread(text: string, requestId: string) {
  const { summary } = await store.start({
    project: { id: "p1", name: "main", path: project, createdAt: 0, kind: "folder", status: "ready" },
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
  return conversation;
}

async function inboxOf(h: Harness, id: string): Promise<InboxState["items"]> {
  const conversation = await h.conversation(Number(id) as never, BACKGROUND);
  const view = await conversation?.viewState(BACKGROUND);
  const items = (view?.value.docs["pi.inbox"] as InboxState | undefined)?.items ?? [];
  view?.dispose();
  return items;
}

async function isRunning(h: Harness, id: string) {
  const conversation = await h.conversation(Number(id) as never, BACKGROUND);
  const view = await conversation?.viewState(BACKGROUND);
  const running = (view?.value.docs["pi.live"] as LiveState | undefined)?.run !== undefined;
  view?.dispose();
  return running;
}

async function untilRunning(h: Harness, id: string) {
  for (let attempt = 0; attempt < 200 && !(await isRunning(h, id)); attempt++) await sleep(25);
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "pie-pins-")));
  project = join(root, "project");
  other = join(root, "other");
  await mkdir(project);
  await mkdir(other);
});

afterEach(async () => {
  await harness?.close(BACKGROUND);
  harness = undefined;
  await rm(root, { recursive: true, force: true });
});

describe("MVP5 Phase 0c pins", () => {
  it("a fork copies the parent's agent as of the fork entry (cwd and model)", async () => {
    const h = await open();
    const { id } = await startThread("hello", "r1");
    const parent = await untilIdle(h, id);
    const entries = await parent?.entries({}, 10, undefined, BACKGROUND);
    const first = entries?.items.find((entry) => entry.kind === "pi.user");
    await parent?.configure({ cwd: other }, BACKGROUND);
    const fork = await parent?.fork(first?.id as never, { ownership: { kind: "ownerless" } }, BACKGROUND);
    const agent = await fork?.agent(BACKGROUND);
    expect(agent?.model).toMatchObject(FAUX);
    expect(agent?.cwd).toBe(project);
    expect((await parent?.agent(BACKGROUND))?.cwd).toBe(other);
  });

  it("whenBusy followUp is delivered after the final answer; a queued item can be aborted, a delivered one not", async () => {
    const h = await open();
    const { id } = await startThread("bash sleep 1", "r1");
    await untilRunning(h, id);
    await store.send(id, { text: "second", requestId: "r2" }, Date.now(), "followUp");
    await store.send(id, { text: "third", requestId: "r3" }, Date.now(), "followUp");
    const queued = await inboxOf(h, id);
    expect(queued.map((item) => item.mode)).toEqual(["followUp", "followUp"]);
    const [secondItem, thirdItem] = queued;
    expect(await h.abortSubmission(thirdItem?.id as never, BACKGROUND)).toBe("aborted");
    const conversation = await untilIdle(h, id);
    expect(await inboxOf(h, id)).toEqual([]);
    const entries = await conversation?.entries({}, 50, undefined, BACKGROUND);
    const kinds = entries?.items.map((entry) => entry.kind) ?? [];
    const finalAnswerOfFirstRun = kinds.indexOf("pi.assistant", kinds.lastIndexOf("pi.toolResult"));
    const secondUser = kinds.findIndex((kind, index) => kind === "pi.user" && index > 0);
    expect(secondUser).toBeGreaterThan(finalAnswerOfFirstRun);
    expect(kinds.filter((kind) => kind === "pi.user")).toHaveLength(2);
    expect(await h.abortSubmission(secondItem?.id as never, BACKGROUND)).toMatch(/already_placed|settled/);
  });

  it("a task child is registered in the tool's own tx, found by known(), and offers no task tool", async () => {
    let extension: ReturnType<typeof defineExtension> | undefined;
    const task = defineTool({
      name: "task",
      description: "pin",
      parameters: Type.Object({ description: Type.String(), prompt: Type.String() }),
      replay: "safe",
      execute: async (args, api, context) => {
        const childId = await api.commit(async (tx) => {
          const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
          if (existing) return existing.id;
          const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
          if (extension) await configure(tx, created.id, { extensions: { remove: [extension] } });
          const parent = await tx.doc(ConversationDoc, api.conversationId);
          await registerChildConversation(tx, {
            conversationId: created.id,
            parentId: String(api.conversationId),
            projectId: parent.projectId,
            title: args.description,
            workspace: legacyWorkspace(project),
            now: Date.now(),
          });
          return created.id;
        }, context);
        const child = await api.conversation(childId, context);
        const submission = await child?.submit(
          { type: "input", content: args.prompt, requestId: `task:${api.taskId}` },
          context,
        );
        await submission?.wait(context);
        return { output: [{ type: "text", text: "child done" }] };
      },
    });
    extension = defineExtension({ name: "task", tools: [task] });
    const h = await open(extension);
    const { id } = await startThread("task research things", "r1");
    await untilIdle(h, id);
    const threads = await store.list("p1");
    const child = threads.find((thread) => thread.parentId === id);
    expect(child).toMatchObject({ title: "research things", parentId: id });
    expect(await store.find(child?.id ?? "")).toMatchObject({ parentId: id });
    const childConversation = await h.conversation(Number(child?.id) as never, BACKGROUND);
    const childAgent = await childConversation?.agent(BACKGROUND);
    expect(childAgent?.cwd).toBe(project);
    expect(JSON.stringify(childAgent?.extensions ?? [])).not.toContain('"task"');
    expect(
      JSON.stringify(
        (await (await h.conversation(Number(id) as never, BACKGROUND))?.agent(BACKGROUND))?.extensions,
      ),
    ).toContain("task");
  });
});
