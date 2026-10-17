import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Harness, InboxState, LiveState } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFauxSetup } from "../testing/faux-provider";
import { legacyWorkspace } from "./conversation-index";
import { type ConversationStore, createConversationStore } from "./conversation-store";
import { cancelQueued } from "./conversation-submit";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "./open";
import { createAgentRegistry } from "./registry";

const FAUX = { provider: "faux", modelId: "faux-1" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let root: string;
let project: string;
let harness: Harness;
let store: ConversationStore;

async function viewOf(id: string) {
  const conversation = await harness.conversation(Number(id) as never, BACKGROUND);
  const view = await conversation?.viewState(BACKGROUND);
  return { conversation, view };
}

async function inboxOf(id: string): Promise<InboxState["items"]> {
  const { view } = await viewOf(id);
  const items = (view?.value.docs["pi.inbox"] as InboxState | undefined)?.items ?? [];
  view?.dispose();
  return items;
}

async function isRunning(id: string) {
  const { view } = await viewOf(id);
  const running = (view?.value.docs["pi.live"] as LiveState | undefined)?.run !== undefined;
  view?.dispose();
  return running;
}

async function untilRunning(id: string) {
  for (let attempt = 0; attempt < 200 && !(await isRunning(id)); attempt++) await sleep(25);
}

async function untilInboxEmpty(id: string) {
  for (let attempt = 0; attempt < 100 && (await inboxOf(id)).length > 0; attempt++) await sleep(25);
  expect(await inboxOf(id)).toEqual([]);
}

async function startBusyThread() {
  const { summary } = await store.start({
    project: { id: "p1", name: "main", path: project, createdAt: 0, kind: "folder", status: "ready" },
    model: FAUX,
    thinkingLevel: "off",
    input: { text: "bash sleep 1", requestId: "r1" },
    workspace: legacyWorkspace(project),
    now: Date.now(),
  });
  await untilRunning(summary.id);
  return summary.id;
}

async function userEntryKinds(id: string) {
  const { conversation } = await viewOf(id);
  await conversation?.waitForIdle(BACKGROUND);
  const entries = await conversation?.entries({}, 50, undefined, BACKGROUND);
  return entries?.items.map((entry) => entry.kind) ?? [];
}

const send = (id: string, text: string, whenBusy: "steer" | "followUp") =>
  store.send(id, { text, requestId: `req-${text}` }, Date.now(), whenBusy);

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "pie-submit-")));
  project = join(root, "project");
  await mkdir(project);
  harness = await openAgentHarness({
    storage: await openSqliteStorage(join(root, "agent.sqlite")),
    models: createFauxSetup().models,
    registry: createAgentRegistry(),
  });
  store = createConversationStore(harness, async () => project);
});

afterEach(async () => {
  await harness.close(BACKGROUND);
  await rm(root, { recursive: true, force: true });
});

describe("whenBusy delivery", () => {
  it("queues two follow-ups and delivers both after the final answer, in order", async () => {
    const id = await startBusyThread();
    await send(id, "one", "followUp");
    await send(id, "two", "followUp");
    expect((await inboxOf(id)).map((item) => item.mode)).toEqual(["followUp", "followUp"]);
    const kinds = await userEntryKinds(id);
    const firstFinalAnswer = kinds.indexOf("pi.assistant", kinds.lastIndexOf("pi.toolResult"));
    const secondUser = kinds.findIndex((kind, index) => kind === "pi.user" && index > 0);
    expect(secondUser).toBeGreaterThan(firstFinalAnswer);
    expect(kinds.filter((kind) => kind === "pi.user")).toHaveLength(3);
    expect(await inboxOf(id)).toEqual([]);
  });

  it("delivers a steer right after the tool results, before the final answer", async () => {
    const id = await startBusyThread();
    await send(id, "steer now", "steer");
    expect((await inboxOf(id))[0]?.mode).toBe("steer");
    const kinds = await userEntryKinds(id);
    const secondUser = kinds.findIndex((kind, index) => kind === "pi.user" && index > 0);
    expect(secondUser).toBeLessThan(kinds.lastIndexOf("pi.assistant"));
  });
});

describe("cancelQueued", () => {
  it("cancels a queued item once and reports false afterwards", async () => {
    const id = await startBusyThread();
    await send(id, "later", "followUp");
    const itemId = String((await inboxOf(id))[0]?.id);
    const { conversation } = await viewOf(id);
    expect(await cancelQueued(harness, conversation as never, itemId)).toEqual({ cancelled: true });
    await untilInboxEmpty(id);
    expect(await cancelQueued(harness, conversation as never, itemId)).toEqual({ cancelled: false });
    expect((await userEntryKinds(id)).filter((kind) => kind === "pi.user")).toHaveLength(1);
  });

  it("answers cancelled false for an item already delivered", async () => {
    const id = await startBusyThread();
    await send(id, "later", "followUp");
    const itemId = String((await inboxOf(id))[0]?.id);
    await userEntryKinds(id);
    const { conversation } = await viewOf(id);
    expect(await cancelQueued(harness, conversation as never, itemId)).toEqual({ cancelled: false });
  });
});
