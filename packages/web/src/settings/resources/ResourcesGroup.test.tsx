import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_RESOURCE_SETTINGS, type ResourceSupport } from "@tau/protocol";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeApiProvider } from "@/nodes/node-context";
import { SETTINGS_INDEX, searchSettings } from "../settings-index";
import { ResourcesGroup } from "./ResourcesGroup";

const mocks = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  support: null as unknown,
  activity: null as unknown,
  setResources: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    settings: {
      get: async () => mocks.settings,
      resourceSupport: async () => mocks.support,
      resourceActivity: async () => mocks.activity,
      setResources: mocks.setResources,
      stopResourceCommand: mocks.stop,
    },
  },
}));

const linux: ResourceSupport = {
  platform: "linux",
  memoryEnforcement: "kernel",
  prioritySupported: true,
  sameCgroupOnly: true,
  note: null,
};
const mac: ResourceSupport = {
  ...linux,
  platform: "macos",
  memoryEnforcement: "polled",
  sameCgroupOnly: false,
};
const other: ResourceSupport = { ...mac, platform: "other", memoryEnforcement: "none" };

const command = {
  entryId: "e1",
  conversationId: "c1",
  conversationTitle: "Fix tests",
  command: "pnpm test",
  since: 0,
};

function setup(resources: unknown = DEFAULT_RESOURCE_SETTINGS, support: unknown = linux) {
  mocks.settings = { resources };
  mocks.support = support;
  mocks.activity = support ? { holders: [command], waiting: [] } : null;
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NodeApiProvider>
        <ResourcesGroup />
      </NodeApiProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setResources.mockResolvedValue(undefined);
  mocks.stop.mockResolvedValue(undefined);
});

describe("<ResourcesGroup>", () => {
  it("renders every row", async () => {
    setup();
    await screen.findByText("Heavy commands");
    for (const id of ["priority", "heavy-slots", "memory-limit", "applies-to"]) {
      expect(document.querySelector(`[data-setting-id="resources-${id}"]`)).not.toBeNull();
    }
  });

  it("saves priority", async () => {
    setup();
    await userEvent.click(await screen.findByRole("radio", { name: "Background" }));
    expect(mocks.setResources).toHaveBeenCalledWith({ ...DEFAULT_RESOURCE_SETTINGS, priority: "background" });
  });

  it("saves slots and memory", async () => {
    setup();
    await userEvent.click(await screen.findByRole("switch", { name: "Limit: Heavy command slots" }));
    expect(mocks.setResources).toHaveBeenCalledWith({ ...DEFAULT_RESOURCE_SETTINGS, heavySlots: 2 });
    await userEvent.click(screen.getByRole("switch", { name: "Limit: Memory limit per command" }));
    expect(mocks.setResources).toHaveBeenCalledWith({ ...DEFAULT_RESOURCE_SETTINGS, memoryLimitMb: 4096 });
  });

  it("saves a typed slot count", async () => {
    setup({ ...DEFAULT_RESOURCE_SETTINGS, heavySlots: 2 });
    const field = await screen.findByLabelText("Heavy command slots (slots)");
    await userEvent.clear(field);
    await userEvent.type(field, "4{Enter}");
    expect(mocks.setResources).toHaveBeenCalledWith({ ...DEFAULT_RESOURCE_SETTINGS, heavySlots: 4 });
  });

  it("saves apply to, disabled while every control is off", async () => {
    setup();
    expect(await screen.findByRole("checkbox", { name: "Worktree threads" })).toBeDisabled();
  });

  it("saves apply to when a control is on, and hints when nothing is ticked", async () => {
    setup({ ...DEFAULT_RESOURCE_SETTINGS, priority: "balanced" });
    await userEvent.click(await screen.findByRole("checkbox", { name: "Worktree threads" }));
    expect(mocks.setResources).toHaveBeenCalledWith({
      ...DEFAULT_RESOURCE_SETTINGS,
      priority: "balanced",
      appliesTo: { main: false, worktrees: true, subagents: true },
    });
  });

  it("says nothing is governed", async () => {
    setup({
      ...DEFAULT_RESOURCE_SETTINGS,
      priority: "balanced",
      appliesTo: { main: false, worktrees: false, subagents: false },
    });
    expect(await screen.findByText("Nothing is governed")).toBeInTheDocument();
  });

  it("finds each row by search", () => {
    for (const id of ["priority", "heavy-slots", "memory-limit", "applies-to"]) {
      const hits = searchSettings("resources", SETTINGS_INDEX).map((r) => r.id);
      expect(hits).toContain(`resources-${id}`);
    }
  });

  it.each([
    [linux, "Kernel memory limits"],
    [mac, "Best effort, checked every 2 s"],
    [other, "Basic"],
  ])("shows the support line", async (support, text) => {
    setup(DEFAULT_RESOURCE_SETTINGS, support);
    expect(await screen.findByTestId("resources-support")).toHaveTextContent(text);
  });

  it("explains the shared group on Linux only", async () => {
    setup(DEFAULT_RESOURCE_SETTINGS, linux);
    expect(await screen.findByTestId("resources-support")).toHaveTextContent("same group as tau");
  });

  it("disables rows on a node without resource control", async () => {
    setup(undefined, null);
    expect(await screen.findByText("This node needs an update")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Limit: Heavy command slots" })).toBeDisabled();
  });

  it("stops a running command", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Stop pnpm test" }));
    expect(mocks.stop).toHaveBeenCalledWith("e1");
  });
});
