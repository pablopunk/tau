import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Change } from "@pi-everywhere/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  entryKinds,
  type FauxWorld,
  isRunning,
  openFauxWorld,
  setUpConversation,
  trackView,
  waitForAnswer,
  waitUntil,
} from "./test-support/faux-core";
import { useTempDir } from "./test-support/temp-dir";

const tempDir = useTempDir();
let clock: number;
let world: FauxWorld;

beforeEach(async () => {
  clock = 1_000;
  world = await openFauxWorld(await tempDir(), () => ++clock);
});

afterEach(() => world.core.close());

describe("chat on the real core", () => {
  it("runs the agent's write tool inside the project folder", async () => {
    const { project, conversation } = await setUpConversation(world);
    const tracker = await trackView(world.core, conversation.id);
    await world.core.conversations.send(conversation.id, {
      text: "write hello.txt hi there",
      requestId: "r1",
    });
    await waitForAnswer(tracker);
    expect(await readFile(join(project.path, "hello.txt"), "utf8")).toBe("hi there");
    await tracker.stop();
  });

  it("titles the conversation from its first message only, and bumps updatedAt on every send", async () => {
    const { project, conversation } = await setUpConversation(world);
    const { core } = world;
    await core.conversations.send(conversation.id, { text: "  First\n\nmessage   here ", requestId: "r1" });
    const [afterFirst] = await core.conversations.list(project.id);
    expect(afterFirst?.title).toBe("First message here");
    expect(afterFirst?.updatedAt).toBeGreaterThan(conversation.updatedAt);
    await core.conversations.send(conversation.id, { text: "Second message", requestId: "r2" });
    const [afterSecond] = await core.conversations.list(project.id);
    expect(afterSecond?.title).toBe("First message here");
    expect(afterSecond?.updatedAt).toBeGreaterThan(afterFirst?.updatedAt ?? Infinity);
  });

  it("shortens a long first message in the title", async () => {
    const { project, conversation } = await setUpConversation(world);
    await world.core.conversations.send(conversation.id, { text: "word ".repeat(60), requestId: "r1" });
    const [summary] = await world.core.conversations.list(project.id);
    expect(summary?.title.length).toBeLessThanOrEqual(80);
    expect(summary?.title.endsWith("…")).toBe(true);
  });

  it("keeps a title the user chose", async () => {
    const { project, conversation } = await setUpConversation(world);
    await world.core.conversations.rename(conversation.id, "Mine");
    await world.core.conversations.send(conversation.id, { text: "hello", requestId: "r1" });
    expect((await world.core.conversations.list(project.id))[0]?.title).toBe("Mine");
  });

  it("lists the most recently updated conversation first", async () => {
    const { project, conversation } = await setUpConversation(world);
    const newer = await world.core.conversations.create(project.id);
    await world.core.conversations.send(conversation.id, { text: "hello", requestId: "r1" });
    expect((await world.core.conversations.list(project.id)).map((item) => item.id)).toEqual([
      conversation.id,
      newer.id,
    ]);
  });

  it("does not touch the conversation again for a repeated requestId", async () => {
    const { project, conversation } = await setUpConversation(world);
    await world.core.conversations.send(conversation.id, { text: "hello", requestId: "same" });
    const [first] = await world.core.conversations.list(project.id);
    await world.core.conversations.send(conversation.id, { text: "hello", requestId: "same" });
    expect((await world.core.conversations.list(project.id))[0]?.updatedAt).toBe(first?.updatedAt);
  });

  it("resumes an unfinished run after a restart", async () => {
    const { conversation } = await setUpConversation(world);
    await world.core.conversations.send(conversation.id, { text: "hello", requestId: "r1" });
    const reopened = await world.reopen();
    const tracker = await trackView(reopened, conversation.id);
    await waitForAnswer(tracker);
    await tracker.stop();
  });

  it("stops a busy conversation when its project is removed", async () => {
    const { project, conversation } = await setUpConversation(world);
    const tracker = await trackView(world.core, conversation.id);
    await world.core.conversations.send(conversation.id, { text: "bash sleep 30", requestId: "r1" });
    await waitUntil(() => isRunning(tracker.view()), "the run to start");
    await world.core.projects.remove(project.id);
    await waitUntil(() => !isRunning(tracker.view()), "the run to stop");
    expect(await world.core.projects.list()).toEqual([]);
    await tracker.stop();
  });

  it("queues a message sent while busy and answers both", async () => {
    const { conversation } = await setUpConversation(world);
    const tracker = await trackView(world.core, conversation.id);
    await world.core.conversations.send(conversation.id, { text: "bash sleep 1", requestId: "r1" });
    await waitUntil(() => isRunning(tracker.view()), "the run to start");
    await world.core.conversations.send(conversation.id, { text: "write steered.txt ok", requestId: "r2" });
    await waitUntil(
      () =>
        !isRunning(tracker.view()) &&
        entryKinds(tracker.view()).filter((kind) => kind === "pi.user").length === 2,
      "both messages to be answered",
    );
    await tracker.stop();
  });
});

describe("change notifications", () => {
  it("announces a send as a conversation index change, until unsubscribed", async () => {
    const { project, conversation } = await setUpConversation(world);
    const changes: Change[] = [];
    const unsubscribe = world.core.onChange((change) => changes.push(change));
    await world.core.conversations.send(conversation.id, { text: "hello", requestId: "r1" });
    expect(changes).toEqual([{ resource: "conversations", projectId: project.id }]);
    unsubscribe();
    await world.core.conversations.send(conversation.id, { text: "again", requestId: "r2" });
    expect(changes).toHaveLength(1);
  });

  it("does not announce a failed operation", async () => {
    const changes: Change[] = [];
    world.core.onChange((change) => changes.push(change));
    await expect(world.core.projects.add({ path: join(world.root, "nope") })).rejects.toMatchObject({
      code: "path_not_found",
    });
    expect(changes).toEqual([]);
  });

  it("keeps notifying after a listener throws", async () => {
    const { project } = await setUpConversation(world);
    const seen: Change[] = [];
    world.core.onChange(() => {
      throw new Error("listener bug");
    });
    world.core.onChange((change) => seen.push(change));
    await world.core.projects.rename(project.id, "Renamed");
    expect(seen).toEqual([{ resource: "projects" }]);
  });
});

describe("conversation ids", () => {
  it.each(["abc", "0", "-1", "1.5", "999999", ""])("rejects %j as not_found", async (id) => {
    await expect(world.core.conversations.rename(id, "x")).rejects.toMatchObject({ code: "not_found" });
    await expect(world.core.conversations.abort(id)).rejects.toMatchObject({ code: "not_found" });
  });
});
