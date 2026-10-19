import { describe, expect, it } from "vitest";
import { conversation } from "@/sidebar/test-support";
import { adjacentThread, threadOrder } from "./adjacent-thread";

const node = (nodeId: string | undefined, ...threads: Parameters<typeof conversation>[0][]) => ({
  nodeId,
  name: nodeId ?? "local",
  local: nodeId === undefined,
  os: "linux x64",
  status: "online" as const,
  projects: [],
  conversations: threads.map(conversation),
});

describe("threadOrder", () => {
  it("merges nodes by recent activity and skips archived threads", () => {
    const order = threadOrder([
      node(undefined, { id: "a", lastActivityAt: 1 }, { id: "gone", archivedAt: 5, lastActivityAt: 9 }),
      node("m", { id: "b", lastActivityAt: 3 }),
    ]);
    expect(order.map((thread) => thread.id)).toEqual(["b", "a"]);
  });
});

describe("adjacentThread", () => {
  const order = ["a", "b", "c"].map((id) => ({ nodeId: undefined, projectId: "p1", id }));

  it("steps and wraps around", () => {
    expect(adjacentThread(order, order[2], 1)?.id).toBe("a");
    expect(adjacentThread(order, order[0], -1)?.id).toBe("c");
    expect(adjacentThread(order, order[1], 1)?.id).toBe("c");
  });

  it("starts at an end when no thread is open", () => {
    expect(adjacentThread(order, undefined, 1)?.id).toBe("a");
    expect(adjacentThread(order, undefined, -1)?.id).toBe("c");
  });
});
