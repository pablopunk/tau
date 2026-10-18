import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  answerCount,
  entryKinds,
  type FauxWorld,
  openFauxWorld,
  trackView,
  waitForAnswerAfter,
} from "../test-support/faux-core";
import { useTempDir } from "../test-support/temp-dir";

const HAIKU = { provider: "claude-cli", modelId: "haiku" };
const tempDir = useTempDir();
let world: FauxWorld;

beforeEach(async () => {
  world = await openFauxWorld(await tempDir(), Date.now, { ...process.env, TAU_FAKE_CLAUDE_CLI: "1" });
});

afterEach(() => world.core.close());

const processCount = async () =>
  (await world.core.providers.list()).find((row) => row.id === "claude-cli")?.cli?.processCount;

async function startClaudeThread() {
  const { core } = world;
  await core.providers.acknowledgeClaudeCli();
  const project = await core.projects.add({ path: await world.makeFolder("claude") });
  const thread = await core.conversations.start({
    projectId: project.id,
    text: "bash echo from-claude",
    requestId: "claude-1",
    model: HAIKU,
  });
  const tracker = await trackView(core, thread.id);
  await waitForAnswerAfter(tracker, 0);
  return { thread, tracker, project };
}

describe("a thread on a Claude CLI model", () => {
  it("runs through the adapter and the fake Agent SDK, tool call included", async () => {
    const { tracker } = await startClaudeThread();
    expect(entryKinds(tracker.view())).toContain("pi.tool-result");
    expect(await processCount()).toBe(1);
    await tracker.stop();
  });

  it("closes its query on archive", async () => {
    const { thread, tracker } = await startClaudeThread();
    await world.core.conversations.archive(thread.id, true);
    expect(await processCount()).toBe(0);
    await tracker.stop();
  });

  it("closes its query on delete", async () => {
    const { thread, tracker } = await startClaudeThread();
    await tracker.stop();
    await world.core.conversations.remove(thread.id, { force: true });
    expect(await processCount()).toBe(0);
  });

  it("keeps working for a second message on the same query", async () => {
    const { thread, tracker } = await startClaudeThread();
    const before = answerCount(tracker);
    await world.core.conversations.send(thread.id, { text: "hello again", requestId: "claude-2" });
    await waitForAnswerAfter(tracker, before);
    expect(await processCount()).toBe(1);
    await tracker.stop();
  });
});
