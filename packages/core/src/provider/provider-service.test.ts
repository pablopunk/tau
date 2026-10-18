import { join } from "node:path";
import type { Change } from "@tau/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileCredentialStore } from "../auth/file-credential-store";
import { createChangeEmitter } from "../change-emitter";
import { openRouterCatalogIds, stubOpenRouter } from "../test-support/stub-openrouter";
import { useTempDir } from "../test-support/temp-dir";
import { createProviderService, type ProviderService } from "./provider-service";

const tempDir = useTempDir();
afterEach(() => vi.unstubAllGlobals());

const catalogIds = openRouterCatalogIds();

async function serviceWith(options: { faux?: boolean; env?: Record<string, string> } = {}) {
  const credentialsFile = join(await tempDir(), "credentials.json");
  const changes: Change[] = [];
  const emitter = createChangeEmitter();
  emitter.subscribe((change) => changes.push(change));
  const service: ProviderService = createProviderService({
    credentialsFile,
    faux: options.faux ?? false,
    env: options.env ?? {},
    changes: emitter,
  });
  const store = new FileCredentialStore(credentialsFile);
  const connectionOf = async (id: string) =>
    (await service.list()).find((entry) => entry.id === id)?.connection;
  return { service, store, changes, connectionOf };
}

describe("provider service (OpenRouter)", () => {
  it("lists every provider unconnected, and has no models", async () => {
    const { service } = await serviceWith();
    const providers = await service.list();
    expect(providers.map((provider) => provider.id)).toEqual([
      "openrouter",
      "openai",
      "anthropic",
      "google",
      "opencode",
    ]);
    expect(providers.every((provider) => provider.connection === null)).toBe(true);
    expect(await service.listModels()).toEqual([]);
    expect(await service.isConfigured()).toBe(false);
  });

  it("validates a key before storing it, and stores nothing when it is rejected", async () => {
    stubOpenRouter({ keyStatus: 401 });
    const { service, store, connectionOf } = await serviceWith();
    await expect(service.setApiKey("openrouter", "sk-bad")).rejects.toMatchObject({ code: "invalid_key" });
    expect(await store.read("openrouter")).toBeUndefined();
    expect(await connectionOf("openrouter")).toBeNull();
  });

  it("stores a valid key (trimmed), announces it and reports it connected", async () => {
    stubOpenRouter();
    const { service, store, changes } = await serviceWith();
    const info = await service.setApiKey("openrouter", "  sk-good \n");
    expect(await store.read("openrouter")).toEqual({ type: "api_key", key: "sk-good" });
    expect(info.connection).toEqual({ method: "api_key", source: "file", valid: true });
    expect(changes).toEqual([{ resource: "providers" }]);
  });

  it("keeps a key it could not check and reports its validity as unknown", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    const { service, connectionOf } = await serviceWith();
    const info = await service.setApiKey("openrouter", "sk-offline");
    expect(info.connection).toEqual({ method: "api_key", source: "file", valid: null });
    expect(await connectionOf("openrouter")).toEqual({ method: "api_key", source: "file", valid: null });
  });

  it("rejects an empty key without asking OpenRouter", async () => {
    const stub = stubOpenRouter();
    const { service } = await serviceWith();
    await expect(service.setApiKey("openrouter", "   ")).rejects.toMatchObject({ code: "invalid_key" });
    expect(stub.requests).toEqual([]);
  });

  it("lists only the models the key can use, under the provider name", async () => {
    const allowed = catalogIds.slice(0, 2);
    const stub = stubOpenRouter({ allowedModelIds: allowed });
    const { service } = await serviceWith();
    await service.setApiKey("openrouter", "sk-good");
    const models = await service.listModels();
    expect(models.map((model) => model.modelId).sort()).toEqual([...allowed].sort());
    expect(models[0]).toMatchObject({
      provider: "openrouter",
      providerName: "OpenRouter",
      name: expect.any(String),
      contextWindow: expect.any(Number),
    });
    expect(stub.requests.at(-1)?.authorization).toBe("Bearer sk-good");
    expect(await service.lists({ provider: "openrouter", modelId: allowed[0] ?? "" })).toBe(true);
    expect(await service.lists({ provider: "openrouter", modelId: "nope/nothing" })).toBe(false);
  });

  it("reports a failing model list as internal", async () => {
    stubOpenRouter({ userModelsStatus: 500 });
    const { service } = await serviceWith();
    await service.setApiKey("openrouter", "sk-good");
    await expect(service.listModels()).rejects.toMatchObject({ code: "internal" });
  });

  it("uses OPENROUTER_API_KEY when no key is stored, and checks it once", async () => {
    const stub = stubOpenRouter({ keyStatus: 401 });
    const { service, connectionOf } = await serviceWith({ env: { OPENROUTER_API_KEY: "sk-env" } });
    const expected = { method: "api_key", source: "env", valid: false };
    expect(await connectionOf("openrouter")).toEqual(expected);
    expect(await connectionOf("openrouter")).toEqual(expected);
    expect(stub.requests).toHaveLength(1);
    expect(await service.isConfigured()).toBe(true);
  });

  it("prefers a stored key over the environment, and falls back to it after disconnect", async () => {
    stubOpenRouter();
    const { service, connectionOf } = await serviceWith({ env: { OPENROUTER_API_KEY: "sk-env" } });
    await service.setApiKey("openrouter", "sk-file");
    expect((await connectionOf("openrouter"))?.source).toBe("file");
    await service.disconnect("openrouter");
    expect((await connectionOf("openrouter"))?.source).toBe("env");
  });

  it("reports an unknown validity when the environment key cannot be checked", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    const { connectionOf } = await serviceWith({ env: { OPENROUTER_API_KEY: "sk-env" } });
    expect(await connectionOf("openrouter")).toMatchObject({ source: "env", valid: null });
  });
});

describe("provider service (other providers)", () => {
  it("writes the OpenCode key under Zen and Go, and removes both on disconnect", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    const { service, store, connectionOf } = await serviceWith();
    await service.setApiKey("opencode", "sk-oc");
    expect(await store.read("opencode")).toEqual({ type: "api_key", key: "sk-oc" });
    expect(await store.read("opencode-go")).toEqual({ type: "api_key", key: "sk-oc" });
    expect(await connectionOf("opencode")).toMatchObject({ method: "api_key", source: "file" });
    await service.disconnect("opencode");
    expect(await store.read("opencode")).toBeUndefined();
    expect(await store.read("opencode-go")).toBeUndefined();
  });

  it("labels OpenCode models Zen and Go", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    const { service } = await serviceWith();
    await service.setApiKey("opencode", "sk-oc");
    const names = new Set((await service.listModels()).map((model) => model.providerName));
    expect(names).toEqual(new Set(["OpenCode Zen", "OpenCode Go"]));
  });

  it("rejects a key the provider refuses, and stores nothing", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    const { service, store } = await serviceWith();
    await expect(service.setApiKey("anthropic", "sk-bad")).rejects.toMatchObject({ code: "invalid_key" });
    expect(await store.read("anthropic")).toBeUndefined();
  });

  it("uses the environment variable of each provider", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    const { connectionOf } = await serviceWith({
      env: { OPENAI_API_KEY: "a", ANTHROPIC_API_KEY: "b", GEMINI_API_KEY: "c", OPENCODE_API_KEY: "d" },
    });
    for (const id of ["openai", "anthropic", "google", "opencode"]) {
      expect(await connectionOf(id)).toEqual({ method: "api_key", source: "env", valid: true });
    }
  });
});

describe("provider service (faux)", () => {
  it("accepts any key without a network call and lists the faux models", async () => {
    const stub = stubOpenRouter();
    const { service, connectionOf } = await serviceWith({
      faux: true,
      env: { OPENROUTER_API_KEY: "ignored" },
    });
    expect(await service.isConfigured()).toBe(false);
    expect(await service.listModels()).toEqual([]);
    await service.setApiKey("openrouter", "anything");
    expect(await connectionOf("openrouter")).toEqual({ method: "api_key", source: "file", valid: true });
    const models = await service.listModels();
    expect(models.map((model) => model.modelId)).toEqual(["faux-1", "faux-2", "faux-fast", "faux-text"]);
    expect(models.every((model) => model.provider === "faux" && model.providerName === "Faux")).toBe(true);
    expect(stub.requests).toEqual([]);
  });
});
