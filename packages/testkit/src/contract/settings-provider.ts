import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { FAST_MODEL, hasConnectedProvider, rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function settingsAndProviderCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("settings and provider", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("starts without a key, models or default model", async () => {
      const { core } = target;
      expect(await core.settings.get()).toEqual({
        defaultModel: null,
        fastModel: null,
        projectsFolder: expect.any(String),
      });
      expect(await hasConnectedProvider(core)).toBe(false);
      expect(await core.models.list()).toEqual([]);
    });

    test("stores a key, then lists models and accepts one as the default", async () => {
      const { core } = target;
      await core.providers.setApiKey("openrouter", "sk-contract-test");
      const openrouter = (await core.providers.list()).find((provider) => provider.id === "openrouter");
      expect(openrouter?.connection).toMatchObject({ method: "api_key", source: "file", valid: true });
      const models = await core.models.list();
      expect(models.length).toBeGreaterThan(0);
      expect(models[0]).toMatchObject({
        provider: expect.any(String),
        modelId: expect.any(String),
        name: expect.any(String),
        providerName: expect.any(String),
        images: expect.any(Boolean),
        thinkingLevels: expect.arrayContaining(["off"]),
      });
      expect(models.find((model) => model.modelId === "faux-text")?.images).toBe(false);
      expect(models.find((model) => model.modelId === "faux-2")?.thinkingLevels).toEqual(["off"]);
      expect(models.find((model) => model.modelId === "faux-1")?.thinkingLevels).toContain("medium");
      const ref = { provider: models[0]?.provider ?? "", modelId: models[0]?.modelId ?? "" };
      await core.settings.setDefaultModel(ref);
      expect(await core.settings.get()).toMatchObject({ defaultModel: ref });
    });

    test("rejects a default model the provider does not list", async () => {
      const { core } = target;
      await core.providers.setApiKey("openrouter", "sk-contract-test");
      await rejectsWithCode(
        core.settings.setDefaultModel({ provider: "nope", modelId: "nothing" }),
        "invalid_request",
      );
    });

    test("[settings] stores a fast model, clears it, and rejects an unlisted one", async () => {
      const { core } = target;
      await core.providers.setApiKey("openrouter", "sk-contract-test");
      await core.settings.setFastModel(FAST_MODEL);
      expect((await core.settings.get()).fastModel).toEqual(FAST_MODEL);
      await core.settings.setFastModel(null);
      expect((await core.settings.get()).fastModel).toBeNull();
      await rejectsWithCode(
        core.settings.setFastModel({ provider: "nope", modelId: "nothing" }),
        "invalid_request",
      );
    });

    test("[settings] stores the projects folder and rejects a relative path or a file", async () => {
      const { core, paths } = target;
      const folder = await paths.directory("projects-root");
      await core.settings.setProjectsFolder(folder);
      expect((await core.settings.get()).projectsFolder).toBe(folder);
      await rejectsWithCode(core.settings.setProjectsFolder("relative/path"), "invalid_request");
      await rejectsWithCode(
        core.settings.setProjectsFolder(await paths.file("a-file.txt")),
        "not_a_directory",
      );
    });
  });
}
