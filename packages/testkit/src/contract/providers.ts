import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { collectChanges, rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const PROVIDER_IDS = ["openrouter", "openai", "anthropic", "google", "opencode"];

export function providerCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("providers", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    const connectionOf = async (id: string) =>
      (await target.core.providers.list()).find((provider) => provider.id === id)?.connection;

    test("[providers] lists every provider, none connected, with its methods and key url", async () => {
      const providers = await target.core.providers.list();
      expect(providers.map((provider) => provider.id)).toEqual(PROVIDER_IDS);
      for (const provider of providers) {
        expect(provider.connection).toBeNull();
        expect(provider.name).not.toBe("");
        expect(provider.keyUrl).toMatch(/^https:\/\//);
      }
      expect(providers.find((provider) => provider.id === "openai")?.methods).toEqual(["api_key", "chatgpt"]);
      expect(providers.find((provider) => provider.id === "anthropic")?.methods).toEqual(["api_key"]);
    });

    test("[providers] stores a key, announces it and lists models with their provider name", async () => {
      const { core } = target;
      const { changes, stop } = collectChanges(core);
      const info = await core.providers.setApiKey("anthropic", "sk-contract-test");
      stop();
      expect(info).toMatchObject({ id: "anthropic", connection: { method: "api_key", source: "file" } });
      expect(changes).toContainEqual({ resource: "providers" });
      const models = await core.models.list();
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((model) => model.providerName !== "")).toBe(true);
    });

    test("[providers] rejects an empty key and stores nothing", async () => {
      const { core } = target;
      await rejectsWithCode(core.providers.setApiKey("openrouter", "   "), "invalid_key");
      expect(await connectionOf("openrouter")).toBeNull();
      expect(await core.models.list()).toEqual([]);
    });

    test("[providers] disconnects, announces it and drops the models", async () => {
      const { core } = target;
      await core.providers.setApiKey("google", "sk-contract-test");
      const { changes, stop } = collectChanges(core);
      const info = await core.providers.disconnect("google");
      stop();
      expect(info).toMatchObject({ id: "google", connection: null });
      expect(changes).toContainEqual({ resource: "providers" });
      expect(await core.models.list()).toEqual([]);
    });

    test("[providers] keeps a connection after the data home is reopened", async () => {
      const { core, reopen } = target;
      if (!reopen) return;
      await core.providers.setApiKey("opencode", "sk-contract-test");
      const reopened = await reopen();
      expect((await reopened.providers.list()).find((provider) => provider.id === "opencode")).toMatchObject({
        connection: { method: "api_key", source: "file" },
      });
    });
  });
}
