import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cpus, release } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EnvironmentFingerprint } from "./report";

const SDK_NAME = "@anthropic-ai/claude-agent-sdk";

function packageVersionNear(entry: string): string {
  let directory = dirname(entry);
  for (;;) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string; version?: string };
      if (parsed.name === SDK_NAME) return parsed.version ?? "unknown";
    }
    const parent = dirname(directory);
    if (parent === directory) return "unknown";
    directory = parent;
  }
}

export function installedSdkVersion(): string {
  try {
    return packageVersionNear(fileURLToPath(import.meta.resolve(SDK_NAME)));
  } catch {
    return "unknown";
  }
}

function gitVersion(): string {
  try {
    return execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export function environmentFingerprint(configHash: string): EnvironmentFingerprint {
  const cpu = cpus();
  return {
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    nodeVersion: process.version,
    cpuModel: cpu[0]?.model ?? "unknown",
    cpuCount: cpu.length,
    sdkVersion: installedSdkVersion(),
    gitVersion: gitVersion(),
    configHash,
  };
}
