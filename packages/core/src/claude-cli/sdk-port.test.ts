import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import { bundledClaudeBinary } from "./bundled-claude";
import { loadClaudeSdkPort, sdkEntryIn } from "./sdk-port";

const tempDir = useTempDir();

describe("bundled Claude SDK", () => {
  it("is imported by its file path from <versionDir>/claude-sdk, with no module resolution", async () => {
    const sdkHome = join(await tempDir(), "claude-sdk");
    const entry = sdkEntryIn(sdkHome);
    expect(entry).toBe(join(sdkHome, "node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs"));
    await mkdir(join(entry, ".."), { recursive: true });
    await writeFile(
      entry,
      "export const query = () => {}; export const createSdkMcpServer = () => {}; export const deleteSession = async () => {};\n",
    );
    await writeFile(join(entry, "..", "package.json"), JSON.stringify({ claudeCodeVersion: "9.9.9" }));
    const port = await loadClaudeSdkPort(sdkHome);
    expect(await port.bundledCliVersion()).toBe("9.9.9");
  });

  it("finds the native claude of the SDK for auth status, and none when absent", async () => {
    const sdkHome = join(await tempDir(), "claude-sdk");
    expect(bundledClaudeBinary(sdkHome)).toBeUndefined();
    const native = join(sdkHome, "node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude");
    await mkdir(join(native, ".."), { recursive: true });
    await writeFile(native, "");
    expect(bundledClaudeBinary(sdkHome)).toBe(native);
  });
});
