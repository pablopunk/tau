import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { useOpenConversation } from "@/activity";
import { conversationPath, terminalPath } from "@/lib/paths";

const urls = [conversationPath("p1", "c1"), terminalPath("p1", "c1"), terminalPath("p1", "c1", "t1")];

describe("every consumer of useOpenConversation sees the ids on pane URLs", () => {
  it.each(urls)("%s", (url) => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
    );
    const { result } = renderHook(() => useOpenConversation(), { wrapper });
    expect(result.current).toEqual({ projectId: "p1", conversationId: "c1" });
  });
});
