import { join } from "node:path";

export const SDK_PACKAGE_NAME = "@anthropic-ai/claude-agent-sdk";

/** The SDK ships inside the release archive (`<versionDir>/claude-sdk`); tau never installs it. */
export interface ClaudeSdkInstaller {
  install(): Promise<void>;
}

/** Where a dev checkout or an old npm install kept the SDK; compiled builds use `<versionDir>/claude-sdk` instead. */
export const sdkHomeOf = (tauHome: string): string => join(tauHome, "claude-sdk");

export const bundledSdkHomeOf = (versionDir: string): string => join(versionDir, "claude-sdk");

export const noopSdkInstaller: ClaudeSdkInstaller = { install: async () => undefined };
