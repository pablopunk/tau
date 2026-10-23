import { describe, expect, it } from "vitest";
import { RETAINED_REASON } from "./runtimes/native/native-mode";
import { NATIVE_SHELL_CAPABILITIES } from "./runtimes/native/native-shell-executor";
import { createRuntimesApi } from "./runtimes-api";

const claudeCodeOf = async (native: Parameters<typeof createRuntimesApi>[0]) =>
  (await createRuntimesApi(native).list()).executors.find((entry) => entry.executor === "claude-code");

describe("createRuntimesApi", () => {
  it("lists claude-code disabled with the generic reason when there is no native service", async () => {
    expect(await claudeCodeOf(undefined)).toMatchObject({
      enabled: false,
      reason: "native Claude is not enabled on this node",
    });
  });

  it("lists claude-code enabled with its capabilities while creation is enabled", async () => {
    const listed = await claudeCodeOf({ capabilities: NATIVE_SHELL_CAPABILITIES, creationEnabled: true });

    expect(listed).toMatchObject({ enabled: true, capabilities: NATIVE_SHELL_CAPABILITIES });
    expect(listed?.reason).toBeUndefined();
  });

  it("lists claude-code disabled as read-only in retained mode, and Pi stays enabled", async () => {
    const native = { capabilities: NATIVE_SHELL_CAPABILITIES, creationEnabled: false };

    expect(await claudeCodeOf(native)).toMatchObject({ enabled: false, reason: RETAINED_REASON });
    const pi = (await createRuntimesApi(native).list()).executors.find((entry) => entry.executor === "pi");
    expect(pi).toMatchObject({ enabled: true });
  });
});
