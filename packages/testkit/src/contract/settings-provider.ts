import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function settingsAndProviderCases(make: MakeContractTarget): void {
  describe("settings and provider", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    it("starts without a key, models or default model", async () => {
      const { core } = target;
      expect(await core.settings.get()).toEqual({ defaultModel: null });
      const status = await core.provider.status();
      expect(status.configured).toBe(false);
      expect(status.source).toBeNull();
      await rejectsWithCode(core.provider.listModels(), "no_provider");
    });

    it("stores a key, then lists models and accepts one as the default", async () => {
      const { core } = target;
      await core.provider.setApiKey("sk-contract-test");
      const status = await core.provider.status();
      expect(status).toMatchObject({ configured: true, source: "file", valid: true });
      const models = await core.provider.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models[0]).toMatchObject({
        provider: expect.any(String),
        modelId: expect.any(String),
        name: expect.any(String),
      });
      const ref = { provider: models[0]?.provider ?? "", modelId: models[0]?.modelId ?? "" };
      await core.settings.setDefaultModel(ref);
      expect(await core.settings.get()).toEqual({ defaultModel: ref });
    });

    it("rejects a default model the provider does not list", async () => {
      const { core } = target;
      await core.provider.setApiKey("sk-contract-test");
      await rejectsWithCode(
        core.settings.setDefaultModel({ provider: "nope", modelId: "nothing" }),
        "invalid_request",
      );
    });
  });
}
