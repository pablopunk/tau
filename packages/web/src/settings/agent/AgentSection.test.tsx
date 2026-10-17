import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSection } from "./AgentSection";

const mocks = vi.hoisted(() => ({
  setMessageMode: vi.fn(),
  setWorkspaceDefault: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    settings: {
      get: async () => ({ messageMode: "steer", workspaceDefault: "worktree" }),
      setMessageMode: mocks.setMessageMode,
      setWorkspaceDefault: mocks.setWorkspaceDefault,
    },
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setMessageMode.mockResolvedValue(undefined);
  mocks.setWorkspaceDefault.mockResolvedValue(undefined);
});

describe("<AgentSection>", () => {
  it("saves the message mode and the workspace default", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AgentSection />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole("radio", { name: "Queue" }));
    expect(mocks.setMessageMode).toHaveBeenCalledWith("queue");
    await userEvent.click(screen.getByRole("radio", { name: "Main checkout" }));
    expect(mocks.setWorkspaceDefault).toHaveBeenCalledWith("checkout");
  });
});
