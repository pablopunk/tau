import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_RESOURCE_SETTINGS } from "@tau/protocol";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeApiProvider } from "@/nodes/node-context";
import { SETTINGS_INDEX, searchSettings } from "../settings-index";
import { ResourcesGroup } from "./ResourcesGroup";

const mocks = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  setResources: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    settings: {
      get: async () => mocks.settings,
      setResources: mocks.setResources,
      resourceSupport: async () => ({
        platform: "macos",
        memoryEnforcement: "polled",
        prioritySupported: true,
        sameCgroupOnly: false,
        note: null,
      }),
    },
  },
}));

function setup(...args: [unknown?]) {
  mocks.settings = { resources: args.length > 0 ? args[0] : DEFAULT_RESOURCE_SETTINGS };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NodeApiProvider>
        <ResourcesGroup />
      </NodeApiProvider>
    </QueryClientProvider>,
  );
}

const group = async (name: string) => within(await screen.findByRole("radiogroup", { name: name }));

async function turnOn() {
  await userEvent.click(await screen.findByRole("switch", { name: "Resource control" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setResources.mockResolvedValue(undefined);
});

describe("<ResourcesGroup>", () => {
  it("renders one power row per scope", async () => {
    setup({
      ...DEFAULT_RESOURCE_SETTINGS,
      levels: { main: "off", worktree: "off", subagent: "balanced" },
    });
    for (const name of ["Main threads power", "Worktree threads power", "Subagents power"]) {
      expect(await screen.findByRole("radiogroup", { name })).toBeInTheDocument();
    }
    for (const id of ["levels-main", "levels-worktree", "levels-subagent"]) {
      expect(document.querySelector(`[data-setting-id="resources-${id}"]`)).not.toBeNull();
    }
  });

  it("toggles on with subagents balanced, off again to all off", async () => {
    setup();
    await turnOn();
    expect(mocks.setResources).toHaveBeenCalledWith({
      ...DEFAULT_RESOURCE_SETTINGS,
      levels: { main: "off", worktree: "off", subagent: "balanced" },
    });
  });

  it("saves a scope's level", async () => {
    setup({
      ...DEFAULT_RESOURCE_SETTINGS,
      levels: { main: "off", worktree: "off", subagent: "balanced" },
    });
    await userEvent.click((await group("Subagents power")).getByRole("radio", { name: "Background" }));
    expect(mocks.setResources).toHaveBeenCalledWith({
      ...DEFAULT_RESOURCE_SETTINGS,
      levels: { main: "off", worktree: "off", subagent: "background" },
    });
  });

  it("shows the current levels as pressed", async () => {
    setup({
      ...DEFAULT_RESOURCE_SETTINGS,
      levels: { main: "balanced", worktree: "off", subagent: "background" },
    });
    expect((await group("Main threads power")).getByRole("radio", { name: "Balanced" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("finds each row by search", () => {
    for (const id of ["levels-main", "levels-worktree", "levels-subagent"]) {
      const hits = searchSettings("resources", SETTINGS_INDEX).map((r) => r.id);
      expect(hits).toContain(`resources-${id}`);
    }
  });

  it("asks for a node update when resource settings are missing", async () => {
    setup(undefined);
    expect(await screen.findByText("This node needs an update")).toBeInTheDocument();
  });
});
