import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeApiProvider } from "@/nodes/node-context";
import { SETTINGS_INDEX, searchSettings } from "../settings-index";
import { SandboxGroup } from "./SandboxGroup";
import { SANDBOX_ALL_OFF, SANDBOX_ON_DEFAULT } from "./sandbox-text";

const mocks = vi.hoisted(() => ({
  sandbox: { main: false, worktree: false, subagent: false } as
    | { main: boolean; worktree: boolean; subagent: boolean }
    | undefined,
  capability: { enforced: true, mechanism: "seatbelt", tested: true, note: null } as
    | { enforced: boolean; mechanism: string; tested: boolean; note: string | null }
    | undefined,
  setSandbox: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    settings: {
      get: async () => ({ sandbox: mocks.sandbox ? { ...mocks.sandbox } : undefined }),
      setSandbox: mocks.setSandbox,
      resourceSupport: async () => ({
        platform: "macos",
        memoryEnforcement: "polled",
        prioritySupported: true,
        sameCgroupOnly: false,
        note: null,
        sandbox: mocks.capability ? { ...mocks.capability } : undefined,
      }),
    },
  },
}));

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NodeApiProvider>
        <SandboxGroup />
      </NodeApiProvider>
    </QueryClientProvider>,
  );
}

/** The whole setting row (control plus status line), waited into existence via its control. */
const row = async (rowId: string, name: string) => {
  await screen.findByRole("radiogroup", { name });
  const el = document.querySelector(`[data-setting-id="${rowId}"]`);
  if (!el) throw new Error(`missing row ${rowId}`);
  return within(el as HTMLElement);
};
const mainRow = () => row("sandbox-main", "Main threads sandbox");
const worktreeRow = () => row("sandbox-worktree", "Worktree threads sandbox");
const subagentRow = () => row("sandbox-subagent", "Subagents sandbox");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.sandbox = { main: false, worktree: false, subagent: false };
  mocks.capability = { enforced: true, mechanism: "seatbelt", tested: true, note: null };
  mocks.setSandbox.mockImplementation(async (value: unknown) => {
    mocks.sandbox = { ...(value as typeof SANDBOX_ALL_OFF) };
  });
});

describe("<SandboxGroup>", () => {
  it("renders one sandbox row per scope, even while off", async () => {
    setup();
    for (const name of ["Main threads sandbox", "Worktree threads sandbox", "Subagents sandbox"]) {
      expect(await screen.findByRole("radiogroup", { name })).toBeInTheDocument();
    }
    for (const id of ["sandbox-main", "sandbox-worktree", "sandbox-subagent"]) {
      expect(document.querySelector(`[data-setting-id="${id}"]`)).not.toBeNull();
    }
  });

  it("toggles on with worktrees and subagents, off again to all off", async () => {
    setup();
    await userEvent.click(await screen.findByRole("switch", { name: "Sandbox" }));
    expect(mocks.setSandbox).toHaveBeenCalledWith(SANDBOX_ON_DEFAULT);
    expect(await screen.findByRole("switch", { name: "Sandbox" })).toBeChecked();
    await userEvent.click(screen.getByRole("switch", { name: "Sandbox" }));
    expect(mocks.setSandbox).toHaveBeenLastCalledWith(SANDBOX_ALL_OFF);
  });

  it("saves a scope's flag alone", async () => {
    setup();
    await userEvent.click((await mainRow()).getByRole("radio", { name: "On" }));
    expect(mocks.setSandbox).toHaveBeenCalledWith({ ...SANDBOX_ALL_OFF, main: true });
  });

  it("shows staged while off and confined while on and enforced", async () => {
    setup();
    expect((await mainRow()).getByText("Staged")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("switch", { name: "Sandbox" }));
    expect((await worktreeRow()).getByText("Confined")).toBeInTheDocument();
    expect((await subagentRow()).getByText("Confined")).toBeInTheDocument();
  });

  it("says unenforced, never silent, when the mechanism is none", async () => {
    mocks.capability = { enforced: false, mechanism: "none", tested: true, note: null };
    setup();
    expect(await screen.findByText(/unenforced on this node/i)).toBeInTheDocument();
    expect(await screen.findByRole("switch", { name: "Sandbox" })).toBeDisabled();
    expect((await mainRow()).getByText("Unenforced")).toBeInTheDocument();
  });

  it("finds each row by search", () => {
    const hits = searchSettings("sandbox", SETTINGS_INDEX).map((r) => r.id);
    for (const id of ["sandbox-main", "sandbox-worktree", "sandbox-subagent"]) {
      expect(hits).toContain(id);
    }
  });

  it("asks for a node update when sandbox settings are missing", async () => {
    mocks.sandbox = undefined;
    setup();
    expect(await screen.findByText("This node needs an update")).toBeInTheDocument();
    expect(await screen.findByRole("switch", { name: "Sandbox" })).toBeDisabled();
  });
});
