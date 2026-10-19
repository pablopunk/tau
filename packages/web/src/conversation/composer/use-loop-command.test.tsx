import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiOfNode } from "@/nodes/node-apis";
import { ComposerTestWrapper } from "./test-wrapper";
import { useThreadCommands } from "./use-thread-commands";

const api = apiOfNode();

vi.mock("@/lib/api", () => ({ api: { timers: { loop: vi.fn(), stopLoop: vi.fn() } } }));

const loop = vi.mocked(api.timers.loop);
const stopLoop = vi.mocked(api.timers.stopLoop);

function setup() {
  return renderHook(
    () => useThreadCommands({ conversationId: "c1", projectId: "p1", pickers: { current: null } }),
    {
      wrapper: ComposerTestWrapper,
    },
  ).result.current;
}

beforeEach(() => {
  loop.mockReset().mockResolvedValue(undefined);
  stopLoop.mockReset().mockResolvedValue(undefined);
});

describe("the /loop command", () => {
  it("calls core with the interval and the prompt", async () => {
    await setup().commands.loop?.("5m check the build");
    expect(loop).toHaveBeenCalledWith("c1", { every: "5m", prompt: "check the build" });
  });

  it("without an interval calls core with the prompt only", async () => {
    await setup().commands.loop?.("watch the deploy");
    expect(loop).toHaveBeenCalledWith("c1", { prompt: "watch the deploy" });
  });

  it("stop calls stopLoop", async () => {
    await setup().commands.loop?.("stop");
    expect(stopLoop).toHaveBeenCalledWith("c1");
    expect(loop).not.toHaveBeenCalled();
  });

  it("rejects with the usage when there is no prompt", async () => {
    await expect(setup().commands.loop?.("")).rejects.toThrow("Usage: /loop");
    expect(loop).not.toHaveBeenCalled();
  });
});
