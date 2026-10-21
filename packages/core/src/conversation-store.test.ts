import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversationDoc, INDEX_SEED, ProjectIndexDoc } from "./harness/conversation-docs";
import { readMeta, updateLiveConversation } from "./harness/conversation-index";
import { isBusy } from "./harness/live-state";
import { BACKGROUND } from "./harness/open";
import {
  type ConversationHarness,
  openConversationHarness,
  startRequest,
  waitForSummary,
  waitUntilTrue,
} from "./test-support/conversation-harness";
import { useTempDir } from "./test-support/temp-dir";

const tempDir = useTempDir();
let directory: string;
let world: ConversationHarness;
const open: ConversationHarness[] = [];

async function openWorld(options: Parameters<typeof openConversationHarness>[1] = {}) {
  const opened = await openConversationHarness(directory, options);
  open.push(opened);
  return opened;
}

beforeEach(async () => {
  directory = await tempDir();
  world = await openWorld();
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((opened) => opened.close().catch(() => undefined)));
});

const conversationIdOf = (id: string) => Number(id) as never;

async function reopen() {
  await world.close();
  world = await openWorld();
  await world.recover();
  return world;
}

describe("start", () => {
  it("resubmits a first message that a restart cut off, exactly once", async () => {
    const pending = await world.store.createPendingOnly(startRequest(world, "hello", "cut-off"));
    const id = String(pending.id);
    expect((await readMeta(world.harness, pending.id))?.pendingFirstInput?.requestId).toBe("cut-off");
    await reopen();
    await waitForSummary(
      world,
      id,
      (summary) => summary.status === "idle" && summary.lastRunEndedAt !== null,
      "the answer",
    );
    const meta = await readMeta(world.harness, pending.id);
    expect(meta?.pendingFirstInput).toBeUndefined();
    const context = await (await world.harness.conversation(pending.id, BACKGROUND))?.context(BACKGROUND);
    expect(context?.entries.filter((entry) => entry.kind === "pi.user")).toHaveLength(1);
    await reopen();
    const again = await (await world.harness.conversation(pending.id, BACKGROUND))?.context(BACKGROUND);
    expect(again?.entries.filter((entry) => entry.kind === "pi.user")).toHaveLength(1);
  });

  it("does not resubmit the first message of a deleted thread", async () => {
    const pending = await world.store.createPendingOnly(startRequest(world, "hello", "deleted"));
    await world.store.remove(String(pending.id), 5);
    await reopen();
    const context = await (await world.harness.conversation(pending.id, BACKGROUND))?.context(BACKGROUND);
    expect(context?.entries.filter((entry) => entry.kind === "pi.user")).toHaveLength(0);
  });

  it("returns the existing thread for a repeated requestId", async () => {
    const first = await world.store.start(startRequest(world, "hello", "same"));
    const again = await world.store.start(startRequest(world, "hello", "same"));
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.summary.id).toBe(first.summary.id);
    expect(await world.store.list(world.project.id)).toHaveLength(1);
  });
});

describe("status", () => {
  it("writes at most two index commits during a long streamed reply", async () => {
    await world.close();
    world = await openWorld({ tokensPerSecond: 60 });
    const { summary } = await world.store.start(startRequest(world, "hello", "long"));
    let indexCommits = 0;
    world.harness.subscribeCommits((publication) => {
      for (const change of publication.changes) {
        if (change.type === "document" && change.record.kind === "app.project-index") indexCommits++;
      }
    });
    await waitForSummary(
      world,
      summary.id,
      (item) => item.status === "idle" && item.lastRunEndedAt !== null,
      "the end",
    );
    expect(indexCommits).toBeLessThanOrEqual(2);
  });

  it("recomputes a status stored as running when no run exists after a restart", async () => {
    const { summary } = await world.store.start(startRequest(world, "hello", "stale"));
    const id = conversationIdOf(summary.id);
    await waitForSummary(world, summary.id, (item) => item.status === "idle", "the first answer");
    await updateLiveConversation(world.harness, id, world.project.id, (_meta, entry) => {
      entry.status = "running";
      return true;
    });
    await reopen();
    await waitForSummary(world, summary.id, (item) => item.status === "idle", "the recomputed status");
  });

  it("records the failure of a thread whose last answer failed", async () => {
    const { summary } = await world.store.start(startRequest(world, "fail", "fails"));
    await waitForSummary(world, summary.id, (item) => item.status === "error", "the error status");
  });

  it("keeps a run that is still going after a restart as running, then ends it", async () => {
    const { summary } = await world.store.start(startRequest(world, "bash sleep 30", "long-tool"));
    await waitForSummary(world, summary.id, (item) => item.status === "running", "running");
    await reopen();
    expect((await world.store.list(world.project.id))[0]?.status).toBe("running");
    await world.store.abort(summary.id);
    await waitForSummary(world, summary.id, (item) => item.status !== "running", "the end of the run");
  });
});

describe("delete", () => {
  it("makes every writer treat a deleted thread as gone", async () => {
    const { summary } = await world.store.start(startRequest(world, "hello", "doomed"));
    await world.store.remove(summary.id, 10);
    await expect(world.store.archive(summary.id, true, 11)).rejects.toMatchObject({ code: "not_found" });
    await expect(world.store.rename(summary.id, "x")).rejects.toMatchObject({ code: "not_found" });
    const applied = await updateLiveConversation(
      world.harness,
      conversationIdOf(summary.id),
      world.project.id,
      () => true,
    );
    expect(applied).toBe(false);
    const entry = await world.harness.snapshot(ProjectIndexDoc, world.project.id, BACKGROUND);
    expect(entry?.conversations[0]?.deletedAt).toBe(10);
    expect((await readMeta(world.harness, conversationIdOf(summary.id)))?.deletedAt).toBe(10);
  });

  it("aborts the live run of a tombstoned thread at startup", async () => {
    const { summary } = await world.store.start(startRequest(world, "bash sleep 30", "crashed"));
    const id = conversationIdOf(summary.id);
    await waitForSummary(world, summary.id, (item) => item.status === "running", "running");
    await world.harness.commit(async (tx) => {
      (await tx.doc(ConversationDoc, id)).deletedAt = 1;
      const index = await tx.doc(ProjectIndexDoc, world.project.id, INDEX_SEED);
      const entry = index.conversations.find((candidate) => candidate.conversationId === Number(id));
      if (entry) entry.deletedAt = 1;
    }, BACKGROUND);
    await reopen();
    await waitUntilTrue(async () => !(await isBusy(world.harness, id)), "the tombstoned run to stop");
  });

  it("tombstones every thread of a removed project and stops a running one", async () => {
    const running = await world.store.start(startRequest(world, "bash sleep 30", "r1"));
    const idle = await world.store.start(startRequest(world, "fail", "r2"));
    await waitForSummary(world, running.summary.id, (item) => item.status === "running", "running");
    await world.store.removeAllOfProject(world.project.id, 20);
    expect(await world.store.list(world.project.id)).toEqual([]);
    await waitUntilTrue(
      async () => !(await isBusy(world.harness, conversationIdOf(running.summary.id))),
      "the run to stop",
    );
    expect((await readMeta(world.harness, conversationIdOf(idle.summary.id)))?.deletedAt).toBe(20);
  });
});

describe("retry", () => {
  it("continues after a stop during a tool, once per requestId", async () => {
    const { summary } = await world.store.start(startRequest(world, "bash sleep 30", "stopped"));
    await waitForSummary(world, summary.id, (item) => item.status === "running", "running");
    await world.store.abort(summary.id);
    await waitForSummary(world, summary.id, (item) => item.status !== "running", "the stop");
    await world.store.retry(summary.id, { requestId: "retry-1" }, 100);
    await world.store.retry(summary.id, { requestId: "retry-1" }, 101);
    const conversation = await world.harness.conversation(conversationIdOf(summary.id), BACKGROUND);
    const kinds = async () =>
      (await conversation?.context(BACKGROUND))?.entries.map((entry) => entry.kind) ?? [];
    await waitUntilTrue(async () => (await kinds()).includes("app.retry"), "the retry entry");
    expect((await kinds()).filter((kind) => kind === "app.retry")).toHaveLength(1);
  });

  it("rejects a retry while the thread is busy", async () => {
    const { summary } = await world.store.start(startRequest(world, "bash sleep 30", "busy"));
    await waitForSummary(world, summary.id, (item) => item.status === "running", "running");
    await expect(world.store.retry(summary.id, { requestId: "too-early" }, 1)).rejects.toMatchObject({
      code: "invalid_request",
    });
    await world.store.abort(summary.id);
  });
});

describe("uploads", () => {
  const toBase64 = (text: string): string => Buffer.from(text).toString("base64");
  const missing = { name: "gone.txt", path: "uploads/00000000-0000-4000-8000-000000000000", size: 1 };

  async function userTexts(id: string): Promise<string[]> {
    const conversation = await world.harness.conversation(conversationIdOf(id), BACKGROUND);
    const entries = (await conversation?.context(BACKGROUND))?.entries ?? [];
    return entries.flatMap((entry) => {
      const message = (entry as { model?: { role?: string; content?: unknown }[] }).model?.[0];
      if (entry.kind !== "pi.user" || message?.role !== "user") return [];
      const content = message.content;
      if (typeof content === "string") return [content];
      if (!Array.isArray(content)) return [];
      return content.flatMap((part) =>
        typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text"
          ? [(part as { text?: unknown }).text].flatMap((text) => (typeof text === "string" ? [text] : []))
          : [],
      );
    });
  }

  it("admits staged files as quoted path-only context, never bytes", async () => {
    const ref = await world.uploads.stage({ name: "notes.txt", mimeType: "text/plain", data: toBase64("hello") });
    const started = startRequest(world, "read this", "with-file");
    const { summary } = await world.store.start({ ...started, input: { ...started.input, files: [ref] } });
    await waitForSummary(world, summary.id, (item) => item.status === "idle", "the answer");
    const texts = (await userTexts(summary.id)).join("\n");
    expect(texts).toContain(`Attached file: "${ref.path}"`);
    expect(texts).toContain("Read it from:");
    expect(texts).not.toContain(toBase64("hello"));
    expect(summary.title).toBe("read this");
  });

  it("titles a file-only start by the safe file name", async () => {
    const ref = await world.uploads.stage({ name: "plan.md", mimeType: "text/plain", data: toBase64("x") });
    const started = startRequest(world, "  ", "file-only");
    const { summary } = await world.store.start({ ...started, input: { ...started.input, files: [ref] } });
    expect(summary.title).toBe("plan.md");
  });

  it("rejects expired refs on send without admitting anything", async () => {
    const { summary } = await world.store.start(startRequest(world, "hello", "no-file"));
    await waitForSummary(world, summary.id, (item) => item.status === "idle", "the answer");
    const before = await userTexts(summary.id);
    await expect(world.store.send(summary.id, { text: "read this", files: [missing], requestId: "bad-file" }, 2)).rejects.toMatchObject({
      code: "file_expired",
    });
    expect(await userTexts(summary.id)).toEqual(before);
  });

  it("clears a pending start whose uploads expired instead of retrying forever", async () => {
    const started = startRequest(world, "read this", "expired-pending");
    const pending = await world.store.createPendingOnly({
      ...started,
      input: { ...started.input, files: [missing] },
    });
    await reopen();
    await reopen();
    const meta = await readMeta(world.harness, pending.id);
    expect(meta?.pendingFirstInput).toBeUndefined();
    const conversation = await world.harness.conversation(pending.id, BACKGROUND);
    const entries = (await conversation?.context(BACKGROUND))?.entries ?? [];
    expect(entries.filter((entry) => entry.kind === "pi.user")).toHaveLength(0);
  });
});

describe("migration", () => {
  it("gives a version 1 conversation document its title source", async () => {
    const { defineDoc } = await import("@earendil-works/pi-durable");
    const V1 = defineDoc<{ projectId: string; title: string }>({
      kind: "app.conversation",
      version: 1,
      scope: "conversation",
      history: "latest",
      fork: "current",
      initial: () => ({ projectId: "", title: "" }),
    });
    const titled = await world.harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        init: async (tx, id) => {
          Object.assign(await tx.doc(V1, id), { projectId: "p1", title: "Old title" });
        },
      },
      BACKGROUND,
    );
    const untitled = await world.harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        init: async (tx, id) => {
          (await tx.doc(V1, id)).projectId = "p1";
        },
      },
      BACKGROUND,
    );
    await reopen();
    expect(await readMeta(world.harness, titled.id)).toMatchObject({
      title: "Old title",
      titleSource: "user",
    });
    expect(await readMeta(world.harness, untitled.id)).toMatchObject({
      title: "",
      titleSource: "first-message",
    });
  });
});
