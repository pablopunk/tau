import type { ConversationView } from "@tau/protocol";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { LiveClientProvider } from "./live-client-context";
import { createStubLiveClient } from "./test-utils";
import { useConversationView } from "./use-conversation-view";

const view = { conversation: { id: 2 }, entries: [], docs: {} } as unknown as ConversationView;

const wrap =
  (client: ReturnType<typeof createStubLiveClient>) =>
  ({ children }: { children: ReactNode }) => (
    <LiveClientProvider client={client}>{children}</LiveClientProvider>
  );

describe("useConversationView", () => {
  it("starts loading when the client holds nothing for the conversation", () => {
    const client = createStubLiveClient();
    const { result } = renderHook(() => useConversationView("2"), { wrapper: wrap(client) });
    expect(result.current).toEqual({ status: "loading" });
  });

  it("shows a held view on the very first render, with no loading state in between", () => {
    const client = createStubLiveClient();
    client.peek = vi.fn(() => view);
    const seen: string[] = [];
    renderHook(
      () => {
        const state = useConversationView("2");
        seen.push(state.status);
        return state;
      },
      { wrapper: wrap(client) },
    );
    expect(seen).not.toContain("loading");
    expect(seen[0]).toBe("ready");
  });

  it("switches to a held view of another conversation without a loading render", () => {
    const client = createStubLiveClient();
    client.peek = vi.fn((id: string) => (id === "3" ? view : undefined));
    const seen: string[] = [];
    const { rerender } = renderHook(
      ({ id }) => {
        const state = useConversationView(id);
        seen.push(`${id}:${state.status}`);
        return state;
      },
      { wrapper: wrap(client), initialProps: { id: "2" } },
    );
    seen.length = 0;
    rerender({ id: "3" });
    expect(seen.every((entry) => entry === "3:ready")).toBe(true);
  });
});
