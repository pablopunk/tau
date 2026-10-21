import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeCore } from "@tau/testkit";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Api, createApi } from "@/lib/api";
import { createFakeTransport } from "@/lib/transport/fake";
import { NodeApiProvider } from "@/nodes/node-context";
import { SettingsModels } from "./SettingsModels";

const mocks = vi.hoisted(() => ({ api: null as unknown as Api }));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: new Proxy({}, { get: (_, key) => (mocks.api as unknown as Record<string, unknown>)[key as string] }),
  };
});

function installFakeBackend(configured: boolean) {
  mocks.api = createApi(createFakeTransport(createFakeCore({ configured })));
}

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NodeApiProvider>{ui}</NodeApiProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => window.localStorage.clear());

describe("Settings models", () => {
  it("shows a thinking picker only for a reasoning model and saves the chosen level", async () => {
    installFakeBackend(true);
    const user = userEvent.setup();
    wrap(<SettingsModels />);
    const pickers = await screen.findAllByRole("combobox", { name: "Thinking level" });
    expect(pickers).toHaveLength(1);
    await user.click(pickers[0] as HTMLElement);
    await user.click(await screen.findByRole("option", { name: "high" }));
    expect((await mocks.api.settings.get()).defaultThinkingLevel).toBe("high");
  });

  it("hides the voice row on a node without the voiceModel setting", async () => {
    installFakeBackend(true);
    const settings = mocks.api.settings;
    mocks.api = {
      ...mocks.api,
      settings: {
        ...settings,
        get: async () => {
          const { voiceModel: _dropped, ...rest } = await settings.get();
          return rest;
        },
      },
    } as Api;
    wrap(<SettingsModels />);
    await screen.findByText(/fast model names new threads/i);
    expect(screen.queryByText("Voice model")).not.toBeInTheDocument();
  });

  it("hides the voice row when the options route 404s", async () => {
    installFakeBackend(true);
    const voice = mocks.api.voice;
    mocks.api = { ...mocks.api, voice: { ...voice, options: async () => null } } as Api;
    wrap(<SettingsModels />);
    await screen.findByText(/fast model names new threads/i);
    expect(screen.queryByText("Voice model")).not.toBeInTheDocument();
  });

  it("disables provider choice with no key and saves local, then browser fallback", async () => {
    installFakeBackend(false);
    const user = userEvent.setup();
    wrap(<SettingsModels />);
    await screen.findByText("Voice model");
    expect(screen.getByRole("radio", { name: /provider/i })).toBeDisabled();
    expect(screen.queryByRole("combobox", { name: "Provider voice model" })).not.toBeInTheDocument();
    expect(screen.getByText("No connected provider offers speech-to-text.")).toBeInTheDocument();

    const warm = vi.spyOn(mocks.api.voice, "warm");
    await user.click(screen.getByRole("radio", { name: /local/i }));
    expect(
      await screen.findByText("Not downloaded yet — starts downloading when picked."),
    ).toBeInTheDocument();
    expect((await mocks.api.settings.get()).voiceModel).toEqual({ kind: "local" });
    expect(warm).toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: /browser/i }));
    await vi.waitFor(async () => {
      expect((await mocks.api.settings.get()).voiceModel).toBeNull();
    });
  });

  it("shows download progress while the local model downloads", async () => {
    installFakeBackend(false);
    const voice = mocks.api.voice;
    mocks.api = {
      ...mocks.api,
      voice: {
        ...voice,
        options: async () => ({
          local: {
            available: true,
            state: "downloading",
            progress: { file: "encoder.int8.onnx", downloaded: 326_107_376, total: 652_214_752 },
          },
          providers: [],
        }),
      },
    } as Api;
    wrap(<SettingsModels />);
    await screen.findByText("Voice model");
    await userEvent.click(await screen.findByRole("radio", { name: /local/i }));
    expect(await screen.findByText(/Downloading encoder\.int8\.onnx/)).toBeInTheDocument();
    expect(screen.getByText(/50% \(311 MB of 622 MB\)/)).toBeInTheDocument();
  });

  it("lists catalog models with an OpenRouter key and saves the chosen provider model", async () => {
    installFakeBackend(true);
    const user = userEvent.setup();
    wrap(<SettingsModels />);
    await screen.findByText("Voice model");
    await user.click(await screen.findByRole("radio", { name: /provider/i }));
    const picker = await screen.findByRole("combobox", { name: "Provider voice model" });
    expect(picker).not.toBeDisabled();
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: /voxtral small/i }));
    await vi.waitFor(async () => {
      expect((await mocks.api.settings.get()).voiceModel).toEqual({
        kind: "provider",
        provider: "openrouter",
        modelId: "voxtral-small-latest",
      });
    });
    // The fake seeds a second catalog model too.
    await user.click(screen.getByRole("combobox", { name: "Provider voice model" }));
    expect(await screen.findByRole("option", { name: /parakeet/i })).toBeInTheDocument();
  });
});
