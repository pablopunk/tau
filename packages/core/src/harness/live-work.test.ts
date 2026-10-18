import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ConversationHarness,
  openConversationHarness,
  startRequest,
} from "../test-support/conversation-harness";
import { useTempDir } from "../test-support/temp-dir";
import { createLiveWork } from "./live-work";

const tempDir = useTempDir();
let world: ConversationHarness;
let running = false;

beforeEach(async () => {
  world = await openConversationHarness(await tempDir());
  running = false;
});

afterEach(() => world.close());

describe("hasLiveWork", () => {
  it("is false for a thread without children or processes, true while a process runs", async () => {
    const { summary } = await world.store.start(startRequest(world, "hello", "r1"));
    const liveWork = createLiveWork({ harness: world.harness, processes: { hasRunning: () => running } });
    expect(await liveWork.hasLiveWork(summary.id)).toBe(false);
    running = true;
    expect(await liveWork.hasLiveWork(summary.id)).toBe(true);
  });

  it("is true while an approval is pending", async () => {
    let pending = false;
    const liveWork = createLiveWork({
      harness: world.harness,
      processes: { hasRunning: () => false },
      approvals: { hasPending: () => pending },
    });
    expect(await liveWork.hasLiveWork("98765")).toBe(false);
    pending = true;
    expect(await liveWork.hasLiveWork("98765")).toBe(true);
  });

  it("is false for an unknown thread", async () => {
    const liveWork = createLiveWork({ harness: world.harness, processes: { hasRunning: () => false } });
    expect(await liveWork.hasLiveWork("98765")).toBe(false);
  });
});
