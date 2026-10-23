import type { ConversationSummary } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import {
  type ConversationRemovedParts,
  conversationRemovedInOrder,
  runConversationRemoved,
} from "./removal-hooks";

const NAMES = [
  "terminals",
  "claudeCliThread",
  "processes",
  "workspace",
  "checkpoints",
  "goals",
  "timers",
] as const;

function recordingParts(calls: string[]): ConversationRemovedParts {
  const part = (name: string) => async () => {
    calls.push(name);
  };
  return Object.fromEntries(NAMES.map((name) => [name, part(name)])) as unknown as ConversationRemovedParts;
}

async function removedOrder(): Promise<string[]> {
  const calls: string[] = [];
  const hooks = {
    unmergedWork: async () => [],
    onConversationRemoved: conversationRemovedInOrder(recordingParts(calls)),
    onProjectRemoved: [],
  };
  await runConversationRemoved(hooks, { id: "1" } as ConversationSummary);
  return calls;
}

describe("conversation removal order", () => {
  it("runs every hook exactly once", async () => {
    expect([...(await removedOrder())].sort()).toEqual([...NAMES].sort());
  });

  it.each(["terminals", "claudeCliThread", "processes"])(
    "stops %s before the workspace is removed",
    async (stopper) => {
      const order = await removedOrder();
      expect(order.indexOf(stopper)).toBeLessThan(order.indexOf("workspace"));
    },
  );

  it("stops processes before checkpoint refs are removed", async () => {
    const order = await removedOrder();
    expect(order.indexOf("processes")).toBeLessThan(order.indexOf("checkpoints"));
  });
});
