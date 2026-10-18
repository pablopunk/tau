import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/models";
import { describe, expect, it } from "vitest";
import type { ClaudeSdkPort } from "../sdk-types";
import { createFakeClaudeSdk } from "../testing/fake-claude-sdk";
import { createClaudeCliModels } from "./claude-cli-models";

function modelsFor(options: { ready?: boolean; port?: Partial<ClaudeSdkPort> } = {}) {
  const fake = createFakeClaudeSdk();
  const state = { ready: options.ready ?? true, changes: 0 };
  const port: ClaudeSdkPort = { ...fake.port, ...options.port };
  const models = createClaudeCliModels({
    sdk: async () => port,
    isReady: () => state.ready,
    onChange: () => {
      state.changes += 1;
    },
  });
  return { models, state, fake };
}

const find = <T extends { id: string }>(list: readonly T[], id: string) =>
  list.find((model) => model.id === id);

describe("claude CLI models", () => {
  it("is empty before the first refresh", () => {
    expect(modelsFor().models.getModels()).toEqual([]);
  });

  it("lists the 14 SDK rows after a refresh", async () => {
    const { models } = modelsFor();
    await models.refresh();
    const list = models.getModels();
    expect(list).toHaveLength(14);
    expect(list.map((model) => model.id).slice(0, 4)).toEqual(["default", "opus", "fable", "sonnet"]);
    expect(find(list, "opus")).toMatchObject({ name: "Opus 5.5", provider: "claude-cli" });
  });

  it("is empty when not ready, even with a loaded list", async () => {
    const { models, state } = modelsFor();
    await models.refresh();
    state.ready = false;
    expect(models.getModels()).toEqual([]);
  });

  it("starts loading by itself when ready and never blocks", async () => {
    const { models, state } = modelsFor();
    expect(models.getModels()).toEqual([]);
    await models.refresh();
    expect(state.changes).toBeGreaterThan(0);
    expect(models.getModels()).toHaveLength(14);
  });

  it("maps effort levels and thinking off", async () => {
    const { models } = modelsFor();
    await models.refresh();
    const list = models.getModels();
    const opus = find(list, "opus") as Parameters<typeof getSupportedThinkingLevels>[0];
    const haiku = find(list, "haiku") as Parameters<typeof getSupportedThinkingLevels>[0];
    expect(getSupportedThinkingLevels(opus)).toEqual(
      expect.arrayContaining(["low", "medium", "high", "xhigh"]),
    );
    expect(getSupportedThinkingLevels(opus)).not.toContain("off");
    expect(getSupportedThinkingLevels(haiku)).toEqual(["off"]);
  });

  it("takes the context window from the last reported usage, then the catalog, then 200,000", async () => {
    const { models } = modelsFor();
    await models.refresh();
    const before = models.getModels();
    expect(find(before, "claude-mythos-5-1")).toMatchObject({ contextWindow: 200_000 });
    models.noteContextWindow("opus", 1_000_000);
    const after = models.getModels();
    expect(find(after, "opus")).toMatchObject({ contextWindow: 1_000_000 });
    expect(find(after, "claude-opus-4-7")?.contextWindow).toBeGreaterThan(0);
  });

  it("keeps the old list when a refresh fails", async () => {
    let failing = false;
    const { models, fake } = modelsFor({
      port: {
        supportedModels: async () => {
          if (failing) throw new Error("no");
          return fake.port.supportedModels();
        },
      },
    });
    await models.refresh();
    failing = true;
    await expect(models.refresh()).resolves.toBeUndefined();
    expect(models.getModels()).toHaveLength(14);
  });

  it("never throws when the SDK cannot load", async () => {
    const models = createClaudeCliModels({
      sdk: async () => {
        throw new Error("no sdk");
      },
      isReady: () => true,
      onChange: () => undefined,
    });
    expect(models.getModels()).toEqual([]);
    await expect(models.refresh()).resolves.toBeUndefined();
    expect(models.getModels()).toEqual([]);
  });
});
