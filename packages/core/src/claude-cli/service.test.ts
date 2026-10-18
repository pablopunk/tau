import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Change } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { createChangeEmitter } from "../change-emitter";
import { createSettingsStore } from "../home/settings-store";
import { createProviderService } from "../provider/provider-service";
import { useTempDir } from "../test-support/temp-dir";
import { createClaudeCliService, KILL_SWITCH_VARIABLE } from "./service";
import { createFakeClaudeSdk } from "./testing/fake-claude-sdk";

const tempDir = useTempDir();

async function providerWith(env: Record<string, string>) {
  const directory = await tempDir();
  return createProviderService({
    credentialsFile: join(directory, "credentials.json"),
    faux: true,
    env,
    changes: createChangeEmitter(),
    settings: createSettingsStore(join(directory, "settings.json"), directory),
  });
}

describe("Claude CLI kill switch", () => {
  it("hides the row and its models and never loads the SDK", async () => {
    const fake = createFakeClaudeSdk();
    const service = createClaudeCliService({
      env: { [KILL_SWITCH_VARIABLE]: "1" },
      faux: false,
      onChange: () => undefined,
      noticeAt: async () => null,
      recordNotice: async () => undefined,
      sdk: fake.load,
    });
    expect(service.provider).toBeNull();
    expect(service.status()).toBeNull();
    expect(fake.loadCount()).toBe(0);
    const provider = await providerWith({ [KILL_SWITCH_VARIABLE]: "1" });
    expect((await provider.list()).map((entry) => entry.id)).not.toContain("claude-cli");
    expect(await provider.listModels()).toEqual([]);
    await expect(provider.acknowledgeClaudeCli()).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("lists the row last when it is on, without loading the SDK for a plain listing", async () => {
    const provider = await providerWith({});
    const providers = await provider.list();
    expect(providers.at(-1)).toMatchObject({ id: "claude-cli", methods: ["claude_cli"], keyUrl: "" });
    expect(providers.at(-1)?.cli).not.toBeNull();
    expect(providers.slice(0, -1).every((entry) => entry.cli === null)).toBe(true);
  });
});

describe("Claude CLI provider entry", () => {
  it("refuses a key and a disconnect with invalid_request", async () => {
    const provider = await providerWith({});
    await expect(provider.setApiKey("claude-cli", "sk-x")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(provider.disconnect("claude-cli")).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("announces a providers change when the status moves", async () => {
    const changes: Change[] = [];
    const emitter = createChangeEmitter();
    emitter.subscribe((change) => changes.push(change));
    const directory = await tempDir();
    const provider = createProviderService({
      credentialsFile: join(directory, "credentials.json"),
      faux: true,
      env: {},
      changes: emitter,
      settings: createSettingsStore(join(directory, "settings.json"), directory),
    });
    await provider.refreshClaudeCli();
    expect(changes).toContainEqual({ resource: "providers" });
  });
});

describe("Claude Agent SDK pin", () => {
  it("is an exact version with no range", async () => {
    const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    expect(manifest.dependencies["@anthropic-ai/claude-agent-sdk"]).toBe("0.3.302");
  });

  it("bundles the CLI version the plan was written against", async () => {
    const { loadClaudeSdkPort } = await import("./sdk-port");
    expect(await (await loadClaudeSdkPort()).bundledCliVersion()).toBe("2.1.302");
  });
});
