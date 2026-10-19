import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BACKGROUND } from "./harness/open";
import {
  type ConversationHarness,
  type LateModels,
  openConversationHarness,
  startRequest,
  waitForSummary,
  waitUntilTrue,
} from "./test-support/conversation-harness";
import { useTempDir } from "./test-support/temp-dir";

const tempDir = useTempDir();
let directory: string;
const open: ConversationHarness[] = [];

beforeEach(async () => {
  directory = await tempDir();
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((world) => world.close().catch(() => undefined)));
});

async function openWorld(modelsLoad?: LateModels) {
  const world = await openConversationHarness(directory, { tokensPerSecond: 20, modelsLoad });
  open.push(world);
  return world;
}

const assistantStops = async (world: ConversationHarness, id: string) => {
  const conversation = await world.harness.conversation(Number(id) as never, BACKGROUND);
  const entries = (await conversation?.context(BACKGROUND))?.entries ?? [];
  return entries
    .flatMap((entry) => (entry.kind === "pi.assistant" ? [entry.model?.[0]] : []))
    .map((message) => (message?.role === "assistant" ? message.stopReason : undefined));
};

async function interruptARun() {
  const first = await openWorld();
  const { summary } = await first.store.start(startRequest(first, "write a long answer", "r1"));
  await waitForSummary(first, summary.id, (item) => item.status === "running", "running");
  await new Promise((resolve) => setTimeout(resolve, 600));
  await first.close();
  return summary.id;
}

describe("a restart while models load late", () => {
  it("finishes the interrupted run when the models are ready before resume", async () => {
    const id = await interruptARun();
    const world = await openWorld({ before: true, afterMs: 300 });
    await waitUntilTrue(async () => (await assistantStops(world, id)).includes("stop"), "the resumed answer");
  });

  it("ends the run aborted when the models only load after resume", async () => {
    const id = await interruptARun();
    const world = await openWorld({ before: false, afterMs: 300 });
    await waitForSummary(world, id, (item) => item.status === "idle", "the failed resume");
    expect(await assistantStops(world, id)).not.toContain("stop");
  });
});
