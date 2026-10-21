import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderInfo } from "@tau/protocol";
import {
  clearVoiceModelCache,
  fetchOpenRouterVoiceModels,
  listProviderOptions,
  OPENROUTER_API_BASE,
} from "./voice-models";
import type { ProviderService } from "./provider-service";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
beforeEach(() => clearVoiceModelCache());

interface CapturedRequest {
  url: string;
  authorization: string | null;
}

function stubFetch(handler: (url: string) => Response): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      requests.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      return handler(url);
    }),
  );
  return requests;
}

const catalogBody = {
  data: [
    {
      id: "openai/whisper-large-v3",
      name: "Whisper Large v3",
      architecture: { input_modalities: ["audio"], output_modalities: ["transcription"] },
    },
    {
      id: "openai/gpt-4o",
      name: "GPT-4o",
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
    },
    {
      id: "no-arch-model",
      name: "No Arch",
    },
    {
      id: "audio-in-text-out",
      name: "Audio In Text Out",
      architecture: { input_modalities: ["audio"], output_modalities: ["text"] },
    },
    { id: 42, name: "Bad Id" },
  ],
};

describe("fetchOpenRouterVoiceModels", () => {
  it("queries the filtered catalog with the key and keeps audio-in/transcription-out rows", async () => {
    const requests = stubFetch(() => new Response(JSON.stringify(catalogBody), { status: 200 }));
    const result = await fetchOpenRouterVoiceModels("sk-test");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      `${OPENROUTER_API_BASE}/models?input_modalities=audio&output_modalities=transcription`,
    );
    expect(requests[0]?.authorization).toBe("Bearer sk-test");
    expect(result).toEqual({ models: [{ modelId: "openai/whisper-large-v3", name: "Whisper Large v3" }] });
  });

  it("falls back to the id when the name is missing", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "voxtral-mini",
                architecture: { input_modalities: ["audio"], output_modalities: ["transcription"] },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    expect(await fetchOpenRouterVoiceModels("sk-test")).toEqual({
      models: [{ modelId: "voxtral-mini", name: "voxtral-mini" }],
    });
  });

  it("returns an error string instead of throwing on HTTP failures", async () => {
    stubFetch(() => new Response("oops", { status: 503 }));
    const result = await fetchOpenRouterVoiceModels("sk-test");
    expect(result).toEqual({ error: expect.stringContaining("503") });
  });

  it("returns an error string instead of throwing when unreachable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const result = await fetchOpenRouterVoiceModels("sk-test");
    expect(result).toEqual({ error: expect.stringContaining("Could not reach OpenRouter") });
  });

  it("returns an error string on a malformed body", async () => {
    stubFetch(() => new Response(JSON.stringify({ data: "nope" }), { status: 200 }));
    const result = await fetchOpenRouterVoiceModels("sk-test");
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("caches per key for 15 minutes and refetches after expiry", async () => {
    const requests = stubFetch(() => new Response(JSON.stringify(catalogBody), { status: 200 }));
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    await fetchOpenRouterVoiceModels("sk-a");
    await fetchOpenRouterVoiceModels("sk-a");
    expect(requests).toHaveLength(1);
    await fetchOpenRouterVoiceModels("sk-b");
    expect(requests).toHaveLength(2);
    now.mockReturnValue(1_000_000 + 15 * 60 * 1000 + 1);
    await fetchOpenRouterVoiceModels("sk-a");
    expect(requests).toHaveLength(3);
  });
});

function openrouterInfo(): ProviderInfo {
  return {
    id: "openrouter",
    name: "OpenRouter",
    methods: ["api_key"],
    keyUrl: "https://openrouter.ai/keys",
    connection: { method: "api_key", source: "file", valid: true },
    cli: null,
  };
}

function sourceOf(info: ProviderInfo | null, apiKey?: string) {
  return {
    list: async () => (info ? [info] : []),
    models: { getAuth: async () => (apiKey ? { auth: { apiKey } } : undefined) },
  } as unknown as Pick<ProviderService, "list" | "models">;
}

describe("listProviderOptions", () => {
  it("returns no rows when OpenRouter is not connected and never fetches", async () => {
    const requests = stubFetch(() => new Response(JSON.stringify(catalogBody), { status: 200 }));
    expect(await listProviderOptions(sourceOf(null, "sk-test"))).toEqual([]);
    expect(await listProviderOptions(sourceOf({ ...openrouterInfo(), connection: null }, "sk-test"))).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("returns the OpenRouter row when connected", async () => {
    stubFetch(() => new Response(JSON.stringify(catalogBody), { status: 200 }));
    expect(await listProviderOptions(sourceOf(openrouterInfo(), "sk-test"))).toEqual([
      {
        provider: "openrouter",
        providerName: "OpenRouter",
        models: [{ modelId: "openai/whisper-large-v3", name: "Whisper Large v3" }],
      },
    ]);
  });

  it("returns a row with error instead of throwing when the catalog fails", async () => {
    stubFetch(() => new Response("oops", { status: 429 }));
    expect(await listProviderOptions(sourceOf(openrouterInfo(), "sk-test"))).toEqual([
      {
        provider: "openrouter",
        providerName: "OpenRouter",
        models: [],
        error: expect.stringContaining("429"),
      },
    ]);
  });

  it("returns no rows when connected but no key resolves", async () => {
    const requests = stubFetch(() => new Response(JSON.stringify(catalogBody), { status: 200 }));
    expect(await listProviderOptions(sourceOf(openrouterInfo()))).toEqual([]);
    expect(requests).toHaveLength(0);
  });
});
