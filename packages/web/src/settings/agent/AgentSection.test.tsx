import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeApiProvider } from "@/nodes/node-context";
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
        <NodeApiProvider>
          <AgentSection />
        </NodeApiProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole("radio", { name: "Queue" }));
    expect(mocks.setMessageMode).toHaveBeenCalledWith("queue");
    await userEvent.click(screen.getByRole("radio", { name: "Main checkout" }));
    expect(mocks.setWorkspaceDefault).toHaveBeenCalledWith("checkout");
  });

  const renderSection = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NodeApiProvider>
          <AgentSection />
        </NodeApiProvider>
      </QueryClientProvider>,
    );

  it("moves the control at once, before the server has answered", async () => {
    mocks.setMessageMode.mockReturnValue(new Promise(() => {}));
    renderSection();
    expect(await screen.findByRole("radio", { name: "Steer" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Queue" }));
    expect(screen.getByRole("radio", { name: "Queue" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Steer" })).not.toBeChecked();
  });

  it("moves it back and shows the error when the server refuses", async () => {
    let refuse: (error: Error) => void = () => {};
    mocks.setMessageMode.mockReturnValue(new Promise((_, reject) => (refuse = reject)));
    renderSection();
    await userEvent.click(await screen.findByRole("radio", { name: "Queue" }));
    expect(screen.getByRole("radio", { name: "Queue" })).toBeChecked();
    await act(async () => refuse(new Error("Could not save")));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Steer" })).toBeChecked());
    expect(await screen.findByText("Could not save")).toBeInTheDocument();
  });
});
