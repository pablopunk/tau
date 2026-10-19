import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MachineApiProvider } from "@/machines/machine-context";
import { SettingsModels } from "./SettingsModels";

const model = (modelId: string, thinkingLevels: string[]) => ({
  provider: "faux",
  modelId,
  name: modelId,
  contextWindow: 1,
  reasoning: thinkingLevels.length > 1,
  images: false,
  thinkingLevels,
  providerName: "Faux",
});

const mocks = vi.hoisted(() => ({
  setDefaultThinkingLevel: vi.fn(),
  setFastThinkingLevel: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    models: { list: async () => [model("faux-1", ["off", "low", "high"]), model("faux-2", ["off"])] },
    settings: {
      get: async () => ({
        defaultModel: { provider: "faux", modelId: "faux-1" },
        defaultThinkingLevel: "low",
        fastModel: { provider: "faux", modelId: "faux-2" },
        fastThinkingLevel: null,
        projectsFolder: "/p",
      }),
      setDefaultThinkingLevel: mocks.setDefaultThinkingLevel,
      setFastThinkingLevel: mocks.setFastThinkingLevel,
    },
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.setDefaultThinkingLevel.mockResolvedValue(undefined);
});

describe("Settings models", () => {
  it("shows a thinking picker only for a reasoning model and saves the chosen level", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MachineApiProvider>
          <SettingsModels />
        </MachineApiProvider>
      </QueryClientProvider>,
    );
    const pickers = await screen.findAllByRole("combobox", { name: "Thinking level" });
    expect(pickers).toHaveLength(1);
    const user = userEvent.setup();
    await user.click(pickers[0] as HTMLElement);
    await user.click(await screen.findByRole("option", { name: "high" }));
    expect(mocks.setDefaultThinkingLevel).toHaveBeenCalledWith("high");
    expect(mocks.setFastThinkingLevel).not.toHaveBeenCalled();
  });
});
