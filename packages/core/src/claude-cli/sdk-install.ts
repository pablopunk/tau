import { execFile } from "node:child_process";
import { join } from "node:path";

export const SDK_PACKAGE_NAME = "@anthropic-ai/claude-agent-sdk";
export const SDK_PINNED_VERSION = "0.3.302";

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

export interface ClaudeSdkInstaller {
  install(): Promise<void>;
}

export const sdkHomeOf = (tauHome: string): string => join(tauHome, "claude-sdk");

export const sdkInstallArguments = (sdkHome: string): string[] => [
  "install",
  "--prefix",
  sdkHome,
  `${SDK_PACKAGE_NAME}@${SDK_PINNED_VERSION}`,
];

export function createNpmSdkInstaller(sdkHome: string): ClaudeSdkInstaller {
  return {
    install: () =>
      new Promise((resolve, reject) => {
        execFile(
          "npm",
          sdkInstallArguments(sdkHome),
          { timeout: INSTALL_TIMEOUT_MS },
          (error, _out, stderr) => {
            if (error) reject(new Error(stderr.trim() || error.message));
            else resolve();
          },
        );
      }),
  };
}

export const noopSdkInstaller: ClaudeSdkInstaller = { install: async () => undefined };
