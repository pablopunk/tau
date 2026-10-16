import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileCredentialStore } from "../auth/file-credential-store";
import { openRouterCatalogIds, stubOpenRouter } from "../test-support/stub-openrouter";
import { useTempDir } from "../test-support/temp-dir";
import { createProviderService, KEY_PROVIDER_ID, type ProviderService } from "./provider-service";

const tempDir = useTempDir();
afterEach(() => vi.unstubAllGlobals());

const catalogIds = openRouterCatalogIds();

async function serviceWith(options: { faux?: boolean; env?: Record<string, string> } = {}) {
  const credentialsFile = join(await tempDir(), "credentials.json");
  const service: ProviderService = createProviderService({
    credentialsFile,
    faux: options.faux ?? false,
    env: options.env ?? {},
  });
  return { service, credentialsFile };
}

describe("provider service (OpenRouter)", () => {
  it("is unconfigured without a key", async () => {
    const { service } = await serviceWith();
    expect(await service.status()).toEqual({
      provider: "openrouter",
      configured: false,
      source: null,
      valid: null,
    });
    await expect(service.listModels()).rejects.toMatchObject({ code: "no_provider" });
  });

  it("validates a key before storing it, and stores nothing when it is rejected", async () => {
    stubOpenRouter({ keyStatus: 401 });
    const { service, credentialsFile } = await serviceWith();
    await expect(service.setApiKey("sk-bad")).rejects.toMatchObject({ code: "invalid_key" });
    expect(await new FileCredentialStore(credentialsFile).read(KEY_PROVIDER_ID)).toBeUndefined();
    expect((await service.status()).configured).toBe(false);
  });

  it("stores a valid key (trimmed) in the credentials file", async () => {
    stubOpenRouter();
    const { service, credentialsFile } = await serviceWith();
    await service.setApiKey("  sk-good \n");
    expect(await new FileCredentialStore(credentialsFile).read(KEY_PROVIDER_ID)).toEqual({
      type: "api_key",
      key: "sk-good",
    });
    expect(await service.status()).toEqual({
      provider: "openrouter",
      configured: true,
      source: "file",
      valid: true,
    });
  });

  it("rejects an empty key without asking OpenRouter", async () => {
    const stub = stubOpenRouter();
    const { service } = await serviceWith();
    await expect(service.setApiKey("   ")).rejects.toMatchObject({ code: "invalid_key" });
    expect(stub.requests).toEqual([]);
  });

  it("lists only the models the key can use", async () => {
    const allowed = catalogIds.slice(0, 2);
    const stub = stubOpenRouter({ allowedModelIds: allowed });
    const { service } = await serviceWith();
    await service.setApiKey("sk-good");
    const models = await service.listModels();
    expect(models.map((model) => model.modelId).sort()).toEqual([...allowed].sort());
    expect(models[0]).toMatchObject({
      provider: "openrouter",
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
    await service.setApiKey("sk-good");
    await expect(service.listModels()).rejects.toMatchObject({ code: "internal" });
  });

  it("uses OPENROUTER_API_KEY when no key is stored, and checks it once", async () => {
    const stub = stubOpenRouter({ keyStatus: 401 });
    const { service } = await serviceWith({ env: { OPENROUTER_API_KEY: "sk-env" } });
    const expected = { provider: "openrouter", configured: true, source: "env", valid: false };
    expect(await service.status()).toEqual(expected);
    expect(await service.status()).toEqual(expected);
    expect(stub.requests).toHaveLength(1);
  });

  it("prefers a stored key over the environment", async () => {
    stubOpenRouter();
    const { service } = await serviceWith({ env: { OPENROUTER_API_KEY: "sk-env" } });
    await service.setApiKey("sk-file");
    expect((await service.status()).source).toBe("file");
  });

  it("reports an unknown validity when the environment key cannot be checked", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    const { service } = await serviceWith({ env: { OPENROUTER_API_KEY: "sk-env" } });
    expect(await service.status()).toMatchObject({ source: "env", valid: null });
  });
});

describe("provider service (faux)", () => {
  it("accepts any key without a network call and lists the faux models", async () => {
    const stub = stubOpenRouter();
    const { service } = await serviceWith({ faux: true, env: { OPENROUTER_API_KEY: "ignored" } });
    expect((await service.status()).configured).toBe(false);
    await service.setApiKey("anything");
    expect(await service.status()).toMatchObject({ configured: true, source: "file", valid: true });
    const models = await service.listModels();
    expect(models.map((model) => model.modelId)).toEqual(["faux-1", "faux-2"]);
    expect(models.every((model) => model.provider === "faux")).toBe(true);
    expect(stub.requests).toEqual([]);
  });
});
