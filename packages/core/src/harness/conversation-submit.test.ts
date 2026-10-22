import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Harness, InboxState, LiveState } from "@earendil-works/pi-durable";
import type { ConversationView } from "@tau/protocol";
import { TODOS_UPDATED_KIND, type TodoItem } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  openFauxWorld,
  setUpConversation,
  trackView,
  type ViewTracker,
  waitUntil,
} from "../test-support/faux-core";
import { createFauxSetup } from "../testing/faux-provider";
import type { UploadStore } from "../upload-store";
import { createUploadStore } from "../upload-store";
import { legacyWorkspace } from "./conversation-index";
import { type ConversationStore, createConversationStore } from "./conversation-store";
import {
  cancelQueued,
  setQueuedMode,
  snapshotQueued,
  snapshotUserItem,
  withAdmissionGate,
} from "./conversation-submit";
import { createNotificationSubmitter } from "./notification-submitter";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "./open";
import { createAgentRegistry } from "./registry";

const FAUX = { provider: "faux", modelId: "faux-1" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForAsync(condition: () => Promise<boolean>, what: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(10);
  }
}

const rejectsWithCode = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code });

let root: string;
let project: string;
let harness: Harness;
let uploads: UploadStore;
let store: ConversationStore;

async function viewOf(id: string) {
  const conversation = await harness.conversation(Number(id) as never, BACKGROUND);
  const view = await conversation?.viewState(BACKGROUND);
  return { conversation, view };
}

async function inboxOf(id: string): Promise<InboxState["items"]> {
  const { view } = await viewOf(id);
  const items = (view?.value.docs["pi.inbox"] as InboxState | undefined)?.items ?? [];
  // Clone before dispose: nested reads on a settled overlay throw.
  const plain = JSON.parse(JSON.stringify(items)) as InboxState["items"];
  view?.dispose();
  return plain;
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

async function startBusyThread(command = "bash sleep 1") {
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
    input: { text: command, requestId: `start-${command}-${Date.now()}` },
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

async function entryTexts(id: string, kind: string) {
  const { conversation } = await viewOf(id);
  await conversation?.waitForIdle(BACKGROUND);
  const entries = await conversation?.entries({}, 100, undefined, BACKGROUND);
  return (entries?.items ?? []).filter((entry) => entry.kind === kind).map((entry) => JSON.stringify(entry));
}

const send = (id: string, text: string, whenBusy: "steer" | "followUp", requestId?: string) =>
  store.send(id, { text, requestId: requestId ?? `req-${text}-${Date.now()}` }, Date.now(), whenBusy);

const notifyTodos = (id: string, todos: TodoItem[], requestId: string) =>
  createNotificationSubmitter((conversationId, context) =>
    harness.conversation(conversationId, context),
  ).notify(id, {
    kind: TODOS_UPDATED_KIND,
    data: { todos, diff: [], requestId },
    text: `<todos-updated>${requestId}</todos-updated>`,
    requestId,
  });

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "tau-submit-")));
  project = join(root, "project");
  await mkdir(project);
  harness = await openAgentHarness({
    storage: await openSqliteStorage(join(root, "agent.sqlite")),
    models: createFauxSetup().models,
    registry: createAgentRegistry(),
  });
  uploads = createUploadStore({ now: Date.now, root: join(root, "uploads") });
  store = createConversationStore(harness, async () => project, { uploads });
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
  it("cancels a queued user item and returns its snapshot, then reports false", async () => {
    const id = await startBusyThread();
    await send(id, "later", "followUp", "cancel-me");
    const itemId = String((await inboxOf(id))[0]?.id);
    const { conversation } = await viewOf(id);
    expect(await cancelQueued(harness, conversation as never, id, itemId)).toEqual({
      cancelled: true,
      restored: [{ text: "later", files: [] }],
    });
    await untilInboxEmpty(id);
    expect(await cancelQueued(harness, conversation as never, id, itemId)).toEqual({
      cancelled: false,
      restored: [],
    });
    expect((await userEntryKinds(id)).filter((kind) => kind === "pi.user")).toHaveLength(1);
  });

  it("answers cancelled false for an item already delivered", async () => {
    const id = await startBusyThread();
    await send(id, "later", "followUp", "cancel-delivered");
    const itemId = String((await inboxOf(id))[0]?.id);
    await userEntryKinds(id);
    const { conversation } = await viewOf(id);
    expect(await cancelQueued(harness, conversation as never, id, itemId)).toEqual({
      cancelled: false,
      restored: [],
    });
  });

  it("rejects unknown ids with not_found", async () => {
    const id = await startBusyThread();
    const { conversation } = await viewOf(id);
    await rejectsWithCode(cancelQueued(harness, conversation as never, id, "999999"), "not_found");
  });

  it("rejects notification items with invalid_request and keeps them queued", async () => {
    const id = await startBusyThread();
    await send(id, "later", "followUp", "cancel-user");
    await notifyTodos(id, [{ content: "a todo", status: "pending" }], "cancel-notice");
    await waitForAsync(async () => (await inboxOf(id)).length === 2, "both items to queue");
    const notificationId = String(
      (await inboxOf(id)).find((item) => (item.entry?.kind ?? "pi.user") !== "pi.user")?.id,
    );
    const { conversation } = await viewOf(id);
    await rejectsWithCode(
      cancelQueued(harness, conversation as never, id, notificationId),
      "invalid_request",
    );
    expect(await inboxOf(id)).toHaveLength(2);
  });

  it("rejects a foreign thread's item with not_found", async () => {
    const first = await startBusyThread("bash sleep 30");
    const second = await startBusyThread("bash sleep 30");
    await send(first, "later", "followUp", "cancel-foreign");
    const itemId = String((await inboxOf(first))[0]?.id);
    const { conversation } = await viewOf(second);
    await rejectsWithCode(cancelQueued(harness, conversation as never, second, itemId), "not_found");
    expect(await inboxOf(first)).toHaveLength(1);
  });
});

describe("setQueuedMode", () => {
  it("switches a queued item in place, preserving its id", async () => {
    const id = await startBusyThread();
    await send(id, "later", "followUp", "switch-me");
    const itemId = String((await inboxOf(id))[0]?.id);
    const { conversation } = await viewOf(id);
    expect(await setQueuedMode(harness, conversation as never, itemId, "steer")).toEqual({
      switched: true,
    });
    const items = await inboxOf(id);
    expect(items).toHaveLength(1);
    expect(String(items[0]?.id)).toBe(itemId);
    expect(items[0]?.mode).toBe("steer");
    expect(await setQueuedMode(harness, conversation as never, itemId, "followUp")).toEqual({
      switched: true,
    });
    expect((await inboxOf(id))[0]?.mode).toBe("followUp");
    await store.abort(id);
  });

  it("answers switched true when already in the desired mode", async () => {
    const id = await startBusyThread();
    await send(id, "later", "followUp", "switch-same");
    const itemId = String((await inboxOf(id))[0]?.id);
    const { conversation } = await viewOf(id);
    expect(await setQueuedMode(harness, conversation as never, itemId, "followUp")).toEqual({
      switched: true,
    });
    expect((await inboxOf(id))[0]?.mode).toBe("followUp");
    await store.abort(id);
  });

  it("answers switched false for an item already delivered", async () => {
    const id = await startBusyThread();
    await send(id, "later", "followUp", "switch-delivered");
    const itemId = String((await inboxOf(id))[0]?.id);
    await userEntryKinds(id);
    const { conversation } = await viewOf(id);
    expect(await setQueuedMode(harness, conversation as never, itemId, "steer")).toEqual({
      switched: false,
    });
  });

  it("rejects unknown ids with not_found", async () => {
    const id = await startBusyThread();
    const { conversation } = await viewOf(id);
    await rejectsWithCode(setQueuedMode(harness, conversation as never, "999999", "steer"), "not_found");
    await store.abort(id);
  });

  it("rejects notification items with invalid_request and keeps them queued", async () => {
    const id = await startBusyThread();
    await send(id, "later", "followUp", "switch-user");
    await notifyTodos(id, [{ content: "a todo", status: "pending" }], "switch-notice");
    await waitForAsync(async () => (await inboxOf(id)).length === 2, "both items to queue");
    const notificationId = String(
      (await inboxOf(id)).find((item) => (item.entry?.kind ?? "pi.user") !== "pi.user")?.id,
    );
    const { conversation } = await viewOf(id);
    await rejectsWithCode(
      setQueuedMode(harness, conversation as never, notificationId, "steer"),
      "invalid_request",
    );
    expect(await inboxOf(id)).toHaveLength(2);
    await store.abort(id);
  });

  it("rejects a foreign thread's item with not_found", async () => {
    const first = await startBusyThread("bash sleep 30");
    const second = await startBusyThread("bash sleep 30");
    await send(first, "later", "followUp", "switch-foreign");
    const itemId = String((await inboxOf(first))[0]?.id);
    const { conversation } = await viewOf(second);
    await rejectsWithCode(setQueuedMode(harness, conversation as never, itemId, "steer"), "not_found");
    expect(await inboxOf(first)).toHaveLength(1);
    await store.abort(first).catch(() => undefined);
    await store.abort(second).catch(() => undefined);
  });
});

describe("sendNow", () => {
  it("delivers the chosen item and returns the others for restoration", async () => {
    const id = await startBusyThread("bash sleep 30");
    await send(id, "first", "followUp", "sendnow-first");
    await send(id, "second", "followUp", "sendnow-second");
    await waitForAsync(async () => (await inboxOf(id)).length === 2, "both to queue");
    const items = await inboxOf(id);
    const secondId = String(items.find((item) => textOf(item) === "second")?.id);
    const result = await store.sendNow(id, secondId);
    expect(result.submissionId).toEqual(expect.any(Number));
    expect(result.restored).toEqual([{ text: "first", files: [] }]);
    const { conversation } = await viewOf(id);
    await conversation?.waitForIdle(BACKGROUND);
    expect(await inboxOf(id)).toEqual([]);
    await store.abort(id).catch(() => undefined);
  });

  it("a notification raced between snapshot and abort still loses to the user message", async () => {
    const id = await startBusyThread("bash sleep 30");
    await send(id, "later", "followUp", "sendnow-raced");
    await waitForAsync(async () => (await inboxOf(id)).length === 1, "the message to queue");
    const itemId = String((await inboxOf(id))[0]?.id);
    const raced = notifyTodos(
      id,
      [{ content: "raced todo", status: "pending" }],
      "sendnow-raced-notice",
    ).catch(() => undefined);
    const result = await store.sendNow(id, itemId, {
      afterSnapshot: () =>
        void notifyTodos(id, [{ content: "hook todo", status: "pending" }], "sendnow-hook").catch(
          () => undefined,
        ),
    });
    // The raced notification was not in the snapshot: nothing returns to the composer for it.
    expect(result.restored).toEqual([]);
    await raced;
    const { conversation } = await viewOf(id);
    await conversation?.waitForIdle(BACKGROUND);
    const kinds =
      (await conversation?.entries({ order: "ascending" }, 100, undefined, BACKGROUND))?.items.map(
        (e) => e.kind,
      ) ?? [];
    const userAt = kinds.lastIndexOf("pi.user");
    const todosAt = kinds.indexOf(TODOS_UPDATED_KIND);
    expect(userAt).toBeGreaterThan(-1);
    expect(todosAt).toBeGreaterThan(userAt);
    await store.abort(id).catch(() => undefined);
  });

  it("rejects unknown and notification items", async () => {
    const id = await startBusyThread("bash sleep 30");
    await send(id, "later", "followUp", "sendnow-reject-user");
    await notifyTodos(id, [{ content: "a todo", status: "pending" }], "sendnow-reject-notice");
    await waitForAsync(async () => (await inboxOf(id)).length === 2, "both to queue");
    const notificationId = String(
      (await inboxOf(id)).find((item) => (item.entry?.kind ?? "pi.user") !== "pi.user")?.id,
    );
    await rejectsWithCode(store.sendNow(id, "999999"), "not_found");
    await rejectsWithCode(store.sendNow(id, notificationId), "invalid_request");
    await store.abort(id);
  });

  it("rolls back durably when the chosen admission fails: everything returns under fresh ids", async () => {
    const id = await startBusyThread("bash sleep 30");
    await send(id, "first", "followUp", "sendnow-rb-first");
    await send(id, "second", "followUp", "sendnow-rb-second");
    await waitForAsync(async () => (await inboxOf(id)).length === 2, "both to queue");
    const before = (await inboxOf(id)).map((item) => String(item.id));
    const secondId = String((await inboxOf(id)).find((item) => textOf(item) === "second")?.id);
    await rejectsWithCode(store.sendNow(id, secondId, { failChosenAdmit: true }), "internal");
    // The rollback re-admits under fresh ids while idle, so the run delivers
    // them instead of queueing: nothing is lost and nothing runs twice.
    const kinds = await userEntryKinds(id);
    expect(kinds.filter((kind) => kind === "pi.user")).toHaveLength(3);
    const texts = await entryTexts(id, "pi.user");
    expect(texts.filter((text) => text.includes("first"))).toHaveLength(1);
    expect(texts.filter((text) => text.includes("second"))).toHaveLength(1);
    expect(before).toHaveLength(2);
    await store.abort(id);
  });

  it("a consumed item reports not_found on the second call", async () => {
    const id = await startBusyThread("bash sleep 30");
    await send(id, "later", "followUp", "sendnow-consumed");
    await waitForAsync(async () => (await inboxOf(id)).length === 1, "the message to queue");
    const itemId = String((await inboxOf(id))[0]?.id);
    await store.sendNow(id, itemId);
    await rejectsWithCode(store.sendNow(id, itemId), "not_found");
    await store.abort(id).catch(() => undefined);
  });
});

describe("abort restore", () => {
  it("returns user items and re-admits notifications without starting a run", async () => {
    const id = await startBusyThread("bash sleep 30");
    await send(id, "later", "followUp", "abort-restore-user");
    await notifyTodos(id, [{ content: "a todo", status: "pending" }], "abort-restore-notice");
    await waitForAsync(async () => (await inboxOf(id)).length === 2, "both to queue");
    const result = await store.abort(id);
    expect(result).toEqual({ restored: [{ text: "later", files: [] }] });
    expect(await isRunning(id)).toBe(false);
    // The notification survived as a placed row — never in the composer snapshot, never a new run.
    const kinds = await userEntryKinds(id);
    expect(kinds.filter((kind) => kind === "pi.user")).toHaveLength(1);
    expect(kinds).toContain(TODOS_UPDATED_KIND);
  });
});

describe("admission gate", () => {
  it("serializes submissions across the gate in order", async () => {
    const id = await startBusyThread("bash sleep 30");
    const order: string[] = [];
    const first = withAdmissionGate(id, async () => {
      await sleep(50);
      order.push("first");
    });
    const second = withAdmissionGate(id, async () => {
      order.push("second");
    });
    // A notification only admitted through the gate waits behind the holder.
    const delivery = notifyTodos(id, [{ content: "gated todo", status: "pending" }], "gate-notice");
    await sleep(10);
    await first;
    await second;
    await delivery;
    expect(order).toEqual(["first", "second"]);
    await store.abort(id);
  });

  it("snapshots carry the normalized entry kind", async () => {
    const id = await startBusyThread("bash sleep 30");
    await send(id, "later", "followUp", "entrykind-user");
    await notifyTodos(id, [{ content: "a todo", status: "pending" }], "entrykind-notice");
    await waitForAsync(async () => (await inboxOf(id)).length === 2, "both to queue");
    const queued = await snapshotQueued(harness, Number(id) as never);
    expect(queued.map((item) => item.entryKind).sort()).toEqual(["app.todos_updated", "pi.user"]);
    expect(snapshotUserItem(queued.find((item) => item.entryKind === "pi.user") as never)).toEqual({
      text: "later",
      files: [],
    });
    await store.abort(id);
  });
});

function textOf(item: unknown): string {
  const content = (item as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" && part !== null ? String((part as { text?: unknown }).text ?? "") : "",
    )
    .join("");
}
const queuedItems = (tracker: ViewTracker) =>
  (tracker.view()?.docs["pi.inbox"] as InboxState | undefined)?.items ?? [];

describe("queue files on the real core", () => {
  it("cancel returns staged FileRefs of the queued item", async () => {
    const world = await openFauxWorld(await mkdtemp(join(tmpdir(), "tau-submit-files-")));
    try {
      const { conversation } = await setUpConversation(world, "hello");
      const ref = await world.core.uploads.stage({
        name: "notes.txt",
        mimeType: "text/plain",
        data: Buffer.from("hello").toString("base64"),
      });
      const tracker = await trackView(world.core, conversation.id);
      // Busy first: the sleep starts a run the file message then queues behind.
      await world.core.conversations.send(conversation.id, {
        text: "bash sleep 30",
        requestId: "files-cancel-busy",
      });
      await waitUntil(() => tracker.view() !== null, "the watch to start");
      await world.core.conversations.send(conversation.id, {
        text: "read this",
        files: [ref],
        requestId: "files-cancel",
        whenBusy: "followUp",
      });
      await waitUntil(() => queuedItems(tracker).length === 1, "the queued message");
      const itemId = String(queuedItems(tracker)[0]?.id);
      const result = await world.core.conversations.cancelQueued(conversation.id, itemId);
      expect(result.cancelled).toBe(true);
      expect(result.restored).toHaveLength(1);
      expect(result.restored[0]?.text).toBe("read this");
      expect(result.restored[0]?.files).toMatchObject([{ name: "notes.txt", path: ref.path }]);
      await tracker.stop();
      await world.core.conversations.abort(conversation.id).catch(() => undefined);
    } finally {
      await world.core.close();
    }
  }, 60_000);

  it("sendNow preserves the file: chosen delivers, the other returns its refs", async () => {
    const world = await openFauxWorld(await mkdtemp(join(tmpdir(), "tau-sendnow-files-")));
    try {
      const { conversation } = await setUpConversation(world, "hello");
      const ref = await world.core.uploads.stage({
        name: "notes.txt",
        mimeType: "text/plain",
        data: Buffer.from("hello").toString("base64"),
      });
      const tracker = await trackView(world.core, conversation.id);
      await world.core.conversations.send(conversation.id, {
        text: "bash sleep 30",
        requestId: "files-sendnow-busy",
      });
      await waitUntil(() => tracker.view() !== null, "the watch to start");
      await world.core.conversations.send(conversation.id, {
        text: "first",
        requestId: "files-sendnow-first",
        whenBusy: "followUp",
      });
      await world.core.conversations.send(conversation.id, {
        text: "read this",
        files: [ref],
        requestId: "files-sendnow-second",
        whenBusy: "followUp",
      });
      await waitUntil(() => queuedItems(tracker).length === 2, "both to queue");
      const secondId = String(queuedItems(tracker).find((item) => textOf(item).startsWith("read this"))?.id);
      const result = await world.core.conversations.sendNow(conversation.id, secondId);
      expect(result.restored).toEqual([{ text: "first", files: [] }]);
      // The chosen item re-admits content as-is: the flattened file path survives with no protocol change.
      await waitUntil(
        () =>
          (tracker.view()?.entries ?? []).some(
            (entry: ConversationView["entries"][number]) =>
              entry.kind === "pi.user" && JSON.stringify(entry.model ?? []).includes(ref.path),
          ),
        "the file path to land in the transcript",
      );
      await tracker.stop();
      await world.core.conversations.abort(conversation.id).catch(() => undefined);
    } finally {
      await world.core.close();
    }
  }, 60_000);
});
