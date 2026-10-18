import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ConversationSummary, Core, Project } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  answerCount,
  type FauxWorld,
  isRunning,
  openFauxWorld,
  trackView,
  waitForAnswerAfter,
  waitUntil,
} from "../test-support/faux-core";
import { makeLocalRepo } from "../test-support/local-repo";
import { useTempDir } from "../test-support/temp-dir";
import { indexFileOf } from "./snapshot";

const run = promisify(execFile);
const tempDir = useTempDir();
let world: FauxWorld;
let repoPath: string;
let project: Project;

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
const refsOf = async (conversationId: string) =>
  (await run("git", ["-C", repoPath, "for-each-ref", `refs/tau/${conversationId}/`])).stdout;

async function settle(core: Core, id: string, action: () => Promise<unknown>) {
  const tracker = await trackView(core, id);
  const before = answerCount(tracker);
  await action();
  await waitForAnswerAfter(tracker, before);
  const entryIds = tracker
    .view()
    ?.entries.filter((entry) => entry.model?.[0]?.role === "user")
    .map((entry) => String(entry.id));
  await tracker.stop();
  return entryIds ?? [];
}

async function startThread(core: Core, text: string, requestId: string) {
  const thread = await core.conversations.start({
    projectId: project.id,
    text,
    requestId,
    workspace: "checkout",
  });
  const tracker = await trackView(core, thread.id);
  await waitUntil(() => answerCount(tracker) > 0 && !isRunning(tracker.view()), "the first answer");
  await tracker.stop();
  return thread;
}

async function twoTurnThread(core: Core) {
  const thread = await startThread(core, "write one.txt first", "t1");
  const entryIds = await settle(core, thread.id, () =>
    core.conversations.send(thread.id, { text: "write two.txt second", requestId: "t2" }),
  );
  return { thread, entryIds };
}

beforeEach(async () => {
  world = await openFauxWorld(await tempDir());
  const { core } = world;
  await core.providers.setApiKey("openrouter", "sk-test");
  const [model] = await core.models.list();
  await core.settings.setDefaultModel({ provider: model?.provider ?? "", modelId: model?.modelId ?? "" });
  repoPath = await makeLocalRepo(join(world.root, "projects"), "repo");
  project = await core.projects.add({ path: repoPath });
});

afterEach(() => world.core.close());

describe("checkpoints on the real core", () => {
  it("lists a before and an after per turn with the files that turn changed", async () => {
    const { core } = world;
    const { thread, entryIds } = await twoTurnThread(core);
    const checkpoints = await core.conversations.checkpoints(thread.id);
    expect(checkpoints.map((item) => item.kind)).toEqual(["before", "after", "before", "after"]);
    expect(checkpoints.map((item) => item.entryId)).toEqual([
      entryIds[0],
      entryIds[0],
      entryIds[1],
      entryIds[1],
    ]);
    expect(checkpoints[1]?.files).toEqual([{ path: "one.txt", added: 1, removed: 0, status: "A" }]);
    expect(checkpoints[3]?.files).toEqual([{ path: "two.txt", added: 1, removed: 0, status: "A" }]);
  });

  it("shows one file's diff for a turn", async () => {
    const { core } = world;
    const { thread } = await twoTurnThread(core);
    const second = (await core.conversations.checkpoints(thread.id))[3];
    const diff = await core.conversations.checkpointDiff(thread.id, second?.id ?? "", "two.txt");
    expect(diff).toContain("+second");
    expect(await core.conversations.checkpointDiff(thread.id, second?.id ?? "", "one.txt")).toBe("");
  });

  it("previews and performs a rewind: files return, the thread forks before the message", async () => {
    const { core } = world;
    const { thread, entryIds } = await twoTurnThread(core);
    const preview = await core.conversations.rewindPreview(thread.id, entryIds[1] ?? "");
    expect(preview.changes).toEqual([{ path: "two.txt", action: "delete" }]);
    const { conversation, draft } = await core.conversations.rewind(thread.id, entryIds[1] ?? "");
    expect(draft).toBe("write two.txt second");
    expect(await exists(join(repoPath, "two.txt"))).toBe(false);
    expect(await readFile(join(repoPath, "one.txt"), "utf8")).toBe("first");
    expect(conversation.title).toMatch(/^Fork of /);
    expect(conversation.forkOf).toEqual({ conversationId: thread.id, entryId: entryIds[1] });
    const tracker = await trackView(core, conversation.id);
    expect(tracker.view()?.entries.filter((entry) => entry.model?.[0]?.role === "user")).toHaveLength(1);
    await tracker.stop();
    expect((await core.conversations.list(project.id)).map((item) => item.id)).toContain(conversation.id);
  });

  it("rewinds the very first message into an empty thread", async () => {
    const { core } = world;
    const { thread, entryIds } = await twoTurnThread(core);
    const { conversation, draft } = await core.conversations.rewind(thread.id, entryIds[0] ?? "");
    expect(draft).toBe("write one.txt first");
    expect(await exists(join(repoPath, "one.txt"))).toBe(false);
    const tracker = await trackView(core, conversation.id);
    expect(tracker.view()?.entries.filter((entry) => entry.model?.[0]?.role === "user")).toHaveLength(0);
    await tracker.stop();
  });

  it("keeps the checkpoint history in a fork, with refs of its own", async () => {
    const { core } = world;
    const { thread, entryIds } = await twoTurnThread(core);
    const fork = await core.conversations.fork(thread.id, entryIds[0] ?? "");
    const inherited = await core.conversations.checkpoints(fork.id);
    expect(inherited.map((item) => item.requestId)).toEqual(["t1", "t1"]);
    expect(await refsOf(fork.id)).not.toBe("");
    const index = indexFileOf(join(world.home), fork.id);
    await core.conversations.remove(fork.id);
    expect(await refsOf(fork.id)).toBe("");
    expect(await exists(index)).toBe(false);
    expect(await refsOf(thread.id)).not.toBe("");
  });

  it("deletes a thread's refs and index file when the thread is removed", async () => {
    const { core } = world;
    const { thread } = await twoTurnThread(core);
    expect(await exists(indexFileOf(world.home, thread.id))).toBe(true);
    await core.conversations.remove(thread.id);
    expect(await refsOf(thread.id)).toBe("");
    expect(await exists(indexFileOf(world.home, thread.id))).toBe(false);
  });

  it("refuses to rewind while another thread in the same folder runs", async () => {
    const { core } = world;
    const { thread, entryIds } = await twoTurnThread(core);
    const other = await core.conversations.start({
      projectId: project.id,
      text: "bash sleep 30",
      requestId: "busy",
      workspace: "checkout",
    });
    const tracker = await trackView(core, other.id);
    await waitUntil(() => isRunning(tracker.view()), "the other thread to run");
    await expect(core.conversations.rewind(thread.id, entryIds[1] ?? "")).rejects.toMatchObject({
      code: "thread_busy",
    });
    await core.conversations.abort(other.id);
    await tracker.stop();
  });

  it("gives a folder that is not a git repository no checkpoints, and still forks on rewind", async () => {
    const { core } = world;
    const plain: Project = await core.projects.add({ path: await world.makeFolder("plain") });
    const thread: ConversationSummary = await core.conversations.start({
      projectId: plain.id,
      text: "write a.txt hi",
      requestId: "plain",
      workspace: "checkout",
    });
    const tracker = await trackView(core, thread.id);
    await waitUntil(() => answerCount(tracker) > 0 && !isRunning(tracker.view()), "the answer");
    const entryId = String(tracker.view()?.entries.find((entry) => entry.model?.[0]?.role === "user")?.id);
    await tracker.stop();
    expect(await core.conversations.checkpoints(thread.id)).toEqual([]);
    expect((await core.conversations.rewindPreview(thread.id, entryId)).changes).toEqual([]);
    expect((await core.conversations.rewind(thread.id, entryId)).draft).toBe("write a.txt hi");
  });
});
