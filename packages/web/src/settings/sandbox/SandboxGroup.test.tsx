import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeApiProvider } from "@/nodes/node-context";
import { SETTINGS_INDEX, searchSettings } from "../settings-index";
import { SandboxGroup } from "./SandboxGroup";

const ALL_OFF = { main: false, worktree: false, subagent: false };
const WORKTREES = { main: false, worktree: true, subagent: true };
const ALL_ON = { main: true, worktree: true, subagent: true };

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

/** The single preset row (control plus status line), waited into existence via its control. */
const presetRow = async () => {
  const group = within(await screen.findByRole("radiogroup", { name: "Sandbox" }));
  const el = document.querySelector('[data-setting-id="sandbox"]');
  if (!el) throw new Error("missing row sandbox");
  return { group, row: within(el as HTMLElement) };
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.sandbox = { ...ALL_OFF };
  mocks.capability = { enforced: true, mechanism: "seatbelt", tested: true, note: null };
  mocks.setSandbox.mockImplementation(async (value: unknown) => {
    mocks.sandbox = { ...(value as typeof ALL_OFF) };
  });
});

describe("<SandboxGroup>", () => {
  it("renders one No/Worktrees/All preset", async () => {
    setup();
    const { group } = await presetRow();
    for (const name of ["No", "Worktrees", "All"]) {
      expect(group.getByRole("radio", { name })).toBeInTheDocument();
    }
    expect(document.querySelector('[data-setting-id="sandbox"]')).not.toBeNull();
  });

  it("saves the Worktrees preset, confining worktrees and their subagents", async () => {
    setup();
    await userEvent.click((await presetRow()).group.getByRole("radio", { name: "Worktrees" }));
    expect(mocks.setSandbox).toHaveBeenCalledWith(WORKTREES);
  });

  it("saves All and back to No", async () => {
    mocks.sandbox = { ...WORKTREES };
    setup();
    await userEvent.click((await presetRow()).group.getByRole("radio", { name: "All" }));
    expect(mocks.setSandbox).toHaveBeenCalledWith(ALL_ON);
  });

  it("shows the current preset as pressed", async () => {
    mocks.sandbox = { ...ALL_ON };
    setup();
    expect((await presetRow()).group.getByRole("radio", { name: "All" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("collapses a legacy main-only combo to All", async () => {
    mocks.sandbox = { main: true, worktree: false, subagent: false };
    setup();
    expect((await presetRow()).group.getByRole("radio", { name: "All" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("shows staged while off", async () => {
    setup();
    expect((await presetRow()).row.getByText("Staged")).toBeInTheDocument();
  });

  it("shows confined while on and enforced", async () => {
    mocks.sandbox = { ...WORKTREES };
    setup();
    expect((await presetRow()).row.getByText("Confined")).toBeInTheDocument();
  });

  it("says unenforced, never silent, when the mechanism is none", async () => {
    mocks.capability = { enforced: false, mechanism: "none", tested: true, note: null };
    setup();
    expect(await screen.findByText(/unenforced on this node/i)).toBeInTheDocument();
    expect((await presetRow()).row.getByText("Unenforced")).toBeInTheDocument();
  });

  it("finds the row by search", () => {
    const hits = searchSettings("sandbox", SETTINGS_INDEX).map((r) => r.id);
    expect(hits).toContain("sandbox");
  });

  it("asks for a node update when sandbox settings are missing", async () => {
    mocks.sandbox = undefined;
    setup();
    expect(await screen.findByText("This node needs an update")).toBeInTheDocument();
  });
});
