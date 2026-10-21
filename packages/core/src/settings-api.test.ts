import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderInfo, VoiceModelSetting } from "@tau/protocol";
import type { SettingsStore } from "./home/settings-store";
import type { CodeFolderDeps } from "./github/code-folder";
import type { ProviderService } from "./provider/provider-service";
import { clearVoiceModelCache } from "./provider/voice-models";
import { createSettingsApi } from "./settings-api";

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => clearVoiceModelCache());

function stubCatalog(data: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(data), { status })),
  );
}

const catalog = {
  data: [
    {
      id: "openai/whisper-large-v3",
      name: "Whisper Large v3",
      architecture: { input_modalities: ["audio"], output_modalities: ["transcription"] },
    },
  ],
};

const openrouterInfo: ProviderInfo = {
  id: "openrouter",
  name: "OpenRouter",
  methods: ["api_key"],
  keyUrl: "https://openrouter.ai/keys",
  connection: { method: "api_key", source: "file", valid: true },
  cli: null,
};

function apiOf(options: { configured: boolean; connected: boolean; apiKey?: string }) {
  const setVoiceModel = vi.fn(async (_setting: VoiceModelSetting) => {});
  const settings = { setVoiceModel } as unknown as SettingsStore;
  const provider = {
    isConfigured: async () => options.configured,
    list: async () => (options.connected ? [openrouterInfo] : []),
    models: { getAuth: async () => (options.apiKey ? { auth: { apiKey: options.apiKey } } : undefined) },
  } as unknown as ProviderService;
  const api = createSettingsApi({
    settings,
    provider,
    codeFolder: {} as unknown as CodeFolderDeps,
    onProjectsFolderChanged: () => {},
  });
  return { api, setVoiceModel };
}

describe("setVoiceModel", () => {
  it("accepts null and local without touching the network", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requests.push(String(input instanceof Request ? input.url : input));
        return new Response("{}");
      }),
    );
    const { api, setVoiceModel } = apiOf({ configured: false, connected: false });
    await api.setVoiceModel(null);
    await api.setVoiceModel({ kind: "local" });
    expect(setVoiceModel).toHaveBeenNthCalledWith(1, null);
    expect(setVoiceModel).toHaveBeenNthCalledWith(2, { kind: "local" });
    expect(requests).toHaveLength(0);
  });

  it("rejects shapes outside the schema", async () => {
    const { api, setVoiceModel } = apiOf({ configured: true, connected: true, apiKey: "sk" });
    await expect(api.setVoiceModel({ kind: "provider" } as unknown as VoiceModelSetting)).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(setVoiceModel).not.toHaveBeenCalled();
  });

  it("rejects the provider flavor with no provider connected", async () => {
    const { api, setVoiceModel } = apiOf({ configured: false, connected: false });
    await expect(
      api.setVoiceModel({ kind: "provider", provider: "openrouter", modelId: "openai/whisper-large-v3" }),
    ).rejects.toMatchObject({ code: "no_provider" });
    expect(setVoiceModel).not.toHaveBeenCalled();
  });

  it("rejects the provider flavor when OpenRouter is not connected", async () => {
    stubCatalog(catalog);
    const { api, setVoiceModel } = apiOf({ configured: true, connected: false, apiKey: "sk" });
    await expect(
      api.setVoiceModel({ kind: "provider", provider: "openrouter", modelId: "openai/whisper-large-v3" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(setVoiceModel).not.toHaveBeenCalled();
  });

  it("accepts a model in the live OpenRouter catalog", async () => {
    stubCatalog(catalog);
    const { api, setVoiceModel } = apiOf({ configured: true, connected: true, apiKey: "sk" });
    const setting = { kind: "provider", provider: "openrouter", modelId: "openai/whisper-large-v3" } as const;
    await api.setVoiceModel(setting);
    expect(setVoiceModel).toHaveBeenCalledWith(setting);
  });

  it("rejects a model missing from the catalog and an unknown provider", async () => {
    stubCatalog(catalog);
    const { api, setVoiceModel } = apiOf({ configured: true, connected: true, apiKey: "sk" });
    await expect(
      api.setVoiceModel({ kind: "provider", provider: "openrouter", modelId: "other/model" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      api.setVoiceModel({ kind: "provider", provider: "openai", modelId: "whisper-1" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(setVoiceModel).not.toHaveBeenCalled();
  });

  it("rejects the provider flavor when the catalog cannot load", async () => {
    stubCatalog({ error: "down" }, 503);
    const { api, setVoiceModel } = apiOf({ configured: true, connected: true, apiKey: "sk" });
    await expect(
      api.setVoiceModel({ kind: "provider", provider: "openrouter", modelId: "openai/whisper-large-v3" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(setVoiceModel).not.toHaveBeenCalled();
  });
});
