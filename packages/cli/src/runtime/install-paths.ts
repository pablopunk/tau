import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

declare const TAU_VERSION: string | undefined;

const BUN_FS = "/$bunfs/";

/** What the process knows about itself; tests pass their own. */
export interface RuntimeProbe {
  readonly execPath: string;
  readonly metaUrl: string;
  readonly bunMain: string | undefined;
}

export function currentProbe(): RuntimeProbe {
  const bun = (globalThis as { Bun?: { main?: string } }).Bun;
  return { execPath: process.execPath, metaUrl: import.meta.url, bunMain: bun?.main };
}

/** True inside a `bun build --compile` executable (verified by pin P8: both values start with `/$bunfs/`). */
export function compiled(probe: RuntimeProbe = currentProbe()): boolean {
  return probe.metaUrl.includes(BUN_FS) || (probe.bunMain?.includes(BUN_FS) ?? false);
}

const realOf = (probe: RuntimeProbe): string => realpathSync(probe.execPath);

/** `<root>/versions/<v>/tau` gives `<root>`; any other place gives `undefined` (a hand-placed binary). */
export function installRootOf(realBinary: string): string | undefined {
  const versionDirectory = dirname(realBinary);
  const versions = dirname(versionDirectory);
  return basename(versions) === "versions" ? dirname(versions) : undefined;
}

/** The path that survives updates: `<root>/current/tau`, or the binary itself when it is not in a `versions/` dir. */
export function stableBinaryOf(realBinary: string): string {
  const root = installRootOf(realBinary);
  return root === undefined ? realBinary : join(root, "current", basename(realBinary));
}

/** The folder this exact version runs from: web assets, skills, `pi-env` and `claude-sdk/` live here. */
export function versionDirOf(realBinary: string): string {
  return dirname(realBinary);
}

function requireCompiled(probe: RuntimeProbe): string {
  if (!compiled(probe)) throw new Error("Not running as a compiled tau binary");
  return realOf(probe);
}

export function stableBinary(probe: RuntimeProbe = currentProbe()): string {
  return stableBinaryOf(requireCompiled(probe));
}

export function versionDir(probe: RuntimeProbe = currentProbe()): string {
  return versionDirOf(requireCompiled(probe));
}

/** `TAU_VERSION` is a build define of `bun build --compile`; the dev build reads it from `package.json` (see `version.ts`). */
export function definedVersion(): string | undefined {
  return typeof TAU_VERSION === "string" ? TAU_VERSION : undefined;
}
