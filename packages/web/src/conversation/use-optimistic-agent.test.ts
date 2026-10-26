import type { AgentInfo } from "@tau/protocol";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOptimisticAgent } from "./use-optimistic-agent";

const agent = { provider: "a", modelId: "one", thinkingLevel: "medium" } as AgentInfo;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(send = vi.fn().mockResolvedValue(undefined)) {
  const onError = vi.fn();
  const hook = renderHook(({ current }) => useOptimisticAgent(current, send, onError), {
    initialProps: { current: agent },
  });
  return { ...hook, send, onError };
}

describe("useOptimisticAgent", () => {
  it("shows the chosen model at once and sends it", () => {
    const { result, send } = setup(vi.fn(() => new Promise(() => {})));
    act(() => result.current.configure({ model: { provider: "b", modelId: "two" } }));
    expect(result.current.agent).toMatchObject({ provider: "b", modelId: "two", thinkingLevel: "medium" });
    expect(send).toHaveBeenCalledWith({ model: { provider: "b", modelId: "two" } });
  });

  it("shows the chosen thinking level at once", () => {
    const { result } = setup(vi.fn(() => new Promise(() => {})));
    act(() => result.current.configure({ thinkingLevel: "high" }));
    expect(result.current.agent.thinkingLevel).toBe("high");
    expect(result.current.agent.modelId).toBe("one");
  });

  it("goes back to the real value and reports the error when the server refuses", async () => {
    const failure = new Error("nope");
    const { result, onError } = setup(vi.fn().mockRejectedValue(failure));
    await act(async () => result.current.configure({ thinkingLevel: "high" }));
    expect(result.current.agent.thinkingLevel).toBe("medium");
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("keeps the chosen value until the view shows it, then follows the view", async () => {
    const { result, rerender } = setup();
    await act(async () => result.current.configure({ thinkingLevel: "high" }));
    expect(result.current.agent.thinkingLevel).toBe("high");
    rerender({ current: { ...agent, thinkingLevel: "high" } as AgentInfo });
    rerender({ current: { ...agent, thinkingLevel: "low" } as AgentInfo });
    expect(result.current.agent.thinkingLevel).toBe("low");
  });

  it("stops showing an accepted value the view never reflects", async () => {
    const { result } = setup();
    await act(async () => result.current.configure({ thinkingLevel: "high" }));
    expect(result.current.agent.thinkingLevel).toBe("high");
    act(() => void vi.advanceTimersByTime(3000));
    expect(result.current.agent.thinkingLevel).toBe("medium");
  });
});
