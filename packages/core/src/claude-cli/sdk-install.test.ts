import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createChangeEmitter } from "../change-emitter";
import { createSettingsStore } from "../home/settings-store";
import { createProviderService } from "../provider/provider-service";
import { useTempDir } from "../test-support/temp-dir";
import { bundledSdkHomeOf, type ClaudeSdkInstaller, sdkHomeOf } from "./sdk-install";
import { ClaudeSdkMissingError } from "./sdk-missing";
import { createClaudeCliService } from "./service";
import { createFakeClaudeSdk } from "./testing/fake-claude-sdk";

const tempDir = useTempDir();

function installerThat(onInstall: () => void | Promise<void>): ClaudeSdkInstaller & { calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    async install() {
      calls += 1;
      await onInstall();
    },
  };
}

function serviceWithMissingSdk(
  installer: ClaudeSdkInstaller,
  noticeAt: () => Promise<number | null> = async () => 1,
) {
  const fake = createFakeClaudeSdk();
  let installed = false;
  const service = createClaudeCliService({
    env: {},
    faux: false,
    onChange: () => undefined,
    noticeAt,
    recordNotice: async () => undefined,
    sdk: async () => {
      if (!installed) throw new ClaudeSdkMissingError();
      return fake.load();
    },
    installer: {
      install: async () => {
        await installer.install();
        installed = true;
      },
    },
  });
  return service;
}

describe("Claude Agent SDK install", () => {
  it("looks in the tau home for dev and in the version folder for a compiled install", () => {
    expect(sdkHomeOf("/tau-home")).toBe("/tau-home/claude-sdk");
    expect(bundledSdkHomeOf("/tau/versions/1.0.0")).toBe("/tau/versions/1.0.0/claude-sdk");
  });

  it("reports sdk_missing, installs once for two clicks, then refreshes", async () => {
    const installer = installerThat(() => new Promise((resolve) => setTimeout(resolve, 10)));
    const service = serviceWithMissingSdk(installer);
    expect((await service.refresh()).state).toBe("sdk_missing");
    const [first, second] = await Promise.all([service.installSdk(), service.installSdk()]);
    expect(installer.calls()).toBe(1);
    expect(first.state).toBe("ready");
    expect(second.state).toBe("ready");
    await service.close();
  });

  it("installs the SDK by itself when the notice was acknowledged", async () => {
    const installer = installerThat(() => undefined);
    const service = serviceWithMissingSdk(installer);
    await service.refresh();
    await vi.waitFor(() => expect(service.status()?.state).toBe("ready"));
    expect(installer.calls()).toBe(1);
    await service.close();
  });

  it("waits for the user when the notice was not acknowledged", async () => {
    const installer = installerThat(() => undefined);
    const service = serviceWithMissingSdk(installer, async () => null);
    await service.refresh();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(installer.calls()).toBe(0);
    expect(service.status()?.state).toBe("sdk_missing");
    await service.close();
  });

  it("keeps sdk_missing when the install fails and lets the next try load the SDK", async () => {
    const installer = installerThat(() => {
      throw new Error("npm exploded");
    });
    const service = serviceWithMissingSdk(installer);
    await service.refresh();
    await expect(service.installSdk()).rejects.toThrow("npm exploded");
    expect(service.status()?.state).toBe("sdk_missing");
    await service.close();
  });

  it("is a core method that answers with the refreshed row and turns a failure into internal", async () => {
    const directory = await tempDir();
    const make = (installer: ClaudeSdkInstaller) =>
      createProviderService({
        credentialsFile: join(directory, "credentials.json"),
        faux: true,
        env: { TAU_FAKE_CLAUDE_CLI: "1" },
        changes: createChangeEmitter(),
        settings: createSettingsStore(join(directory, "settings.json"), directory),
        claudeSdkInstaller: installer,
      });
    const working = installerThat(() => undefined);
    const info = await make(working).installClaudeCliSdk();
    expect(working.calls()).toBe(1);
    expect(info).toMatchObject({ id: "claude-cli", cli: { state: "needs_notice" } });
    const broken = installerThat(() => {
      throw new Error("offline");
    });
    await expect(make(broken).installClaudeCliSdk()).rejects.toMatchObject({ code: "internal" });
  });
});
