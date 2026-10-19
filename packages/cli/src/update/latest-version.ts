import { dirname, join } from "node:path";
import { isPlainVersion } from "@tau/protocol";
import type { RunCommand } from "./command-runner";

export const PACKAGE_NAME = "@pablopunk/tau";
const SCOPE_KEY = "@pablopunk:registry";
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const NPM_TIMEOUT_MS = 15_000;
const HTTP_TIMEOUT_MS = 15_000;
const PACKUMENT_ACCEPT = "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8";

export const npmOf = (execPath: string): string => join(dirname(execPath), "npm");

export type FetchLike = typeof fetch;

async function configValue(run: RunCommand, execPath: string, key: string): Promise<string | undefined> {
  const result = await run(npmOf(execPath), ["config", "get", key], {
    stdio: "capture",
    timeoutMs: NPM_TIMEOUT_MS,
  });
  const value = result.stdout.trim();
  if (result.code !== 0 || value === "" || value === "undefined" || value === "null") return undefined;
  return value;
}

/** The registry npm would use for the package: the scoped one, else the default one, without a trailing slash. */
export async function registryOf(run: RunCommand, execPath: string): Promise<string> {
  const value =
    (await configValue(run, execPath, SCOPE_KEY)) ??
    (await configValue(run, execPath, "registry")) ??
    DEFAULT_REGISTRY;
  return value.replace(/\/+$/, "");
}

const unavailable = (what: string) =>
  new Error(`Could not read the latest version from the npm registry (${what}).`);

async function request(fetchImpl: FetchLike, url: string, method: "GET" | "HEAD", accept?: string) {
  try {
    return await fetchImpl(url, {
      method,
      headers: accept ? { accept } : undefined,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    throw unavailable(error instanceof Error ? error.message : String(error));
  }
}

async function jsonOf(response: Response, what: string): Promise<Record<string, unknown>> {
  if (response.status !== 200) throw unavailable(`${what}: HTTP ${response.status}`);
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw unavailable(`${what}: not JSON`);
  }
}

/**
 * The registry's `latest` as plain `x.y.z`, only when `npm i` could install it right now: the version document
 * answers 200 and so does its tarball. Anything else throws, so callers keep their previous value.
 */
export async function fetchLatestVersion(
  run: RunCommand,
  execPath: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const base = `${await registryOf(run, execPath)}/${PACKAGE_NAME.replace("/", "%2f")}`;
  const packument = await jsonOf(await request(fetchImpl, base, "GET", PACKUMENT_ACCEPT), "package");
  const latest = (packument["dist-tags"] as { latest?: unknown } | undefined)?.latest;
  if (typeof latest !== "string" || !isPlainVersion(latest)) {
    throw new Error(`The registry returned an unexpected version: ${String(latest)}`);
  }
  const document = await jsonOf(await request(fetchImpl, `${base}/${latest}`, "GET"), `version ${latest}`);
  const tarball = (document.dist as { tarball?: unknown } | undefined)?.tarball;
  if (typeof tarball !== "string") throw unavailable(`version ${latest} has no tarball`);
  const head = await request(fetchImpl, tarball, "HEAD");
  if (head.status !== 200) throw unavailable(`tarball of ${latest}: HTTP ${head.status}`);
  return latest;
}
