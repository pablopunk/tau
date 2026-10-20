import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { RunCommand } from "./command-runner";
import { swapCurrent, versionDirIn, versionsDirOf } from "./install-layout";
import type { FetchLike, Release } from "./latest-version";
import { HttpStatusError, type Sleep, withRetries } from "./retry";

const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const VERSION_TIMEOUT_MS = 30_000;
const EXTRACT_TIMEOUT_MS = 5 * 60_000;

export interface InstallDeps {
  readonly fetch: FetchLike;
  readonly run: RunCommand;
  /** Backoff between download attempts; default real timers. */
  readonly sleep?: Sleep;
}

const headers = { "user-agent": "tau-updater" };

async function get(deps: InstallDeps, url: string): Promise<Response> {
  const response = await deps.fetch(url, { headers, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok || response.body === null)
    throw new HttpStatusError(response.status, `Download failed: ${url} (HTTP ${response.status}).`);
  return response;
}

/** Streams to disk and hashes on the way: the archive is 100 MB or more. */
async function download(deps: InstallDeps, url: string, file: string): Promise<string> {
  const hash = createHash("sha256");
  const body = Readable.fromWeb((await get(deps, url)).body as Parameters<typeof Readable.fromWeb>[0]);
  body.on("data", (chunk: Buffer) => hash.update(chunk));
  try {
    await pipeline(body, createWriteStream(file));
  } catch (error) {
    await rm(file, { force: true });
    throw error;
  }
  return hash.digest("hex");
}

export function expectedHashOf(sums: string, archiveName: string): string | undefined {
  for (const line of sums.split("\n")) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (match?.[2] === archiveName) return match[1]?.toLowerCase();
  }
  return undefined;
}

/** The folder that holds `tau`: the extraction dir itself, or its single sub-folder. */
async function payloadDirOf(extracted: string): Promise<string> {
  const entries = await readdir(extracted, { withFileTypes: true });
  const only = entries.length === 1 ? entries[0] : undefined;
  return only?.isDirectory() ? join(extracted, only.name) : extracted;
}

async function requireVersion(deps: InstallDeps, binary: string, version: string): Promise<void> {
  const result = await deps.run(binary, ["--version"], { stdio: "capture", timeoutMs: VERSION_TIMEOUT_MS });
  const printed = result.stdout.trim().split(/\s+/).pop();
  if (result.code !== 0 || printed !== version) {
    throw new Error(
      `The new tau does not run (exit ${result.code}, printed ${JSON.stringify(result.stdout.trim())}): ${result.stderr.trim().slice(0, 300)}`,
    );
  }
}

/** Downloads, verifies the SHA-256, extracts into `versions/<v>` and requires `<v>/tau --version`. Does not swap. */
export async function stageRelease(deps: InstallDeps, release: Release, root: string): Promise<string> {
  await mkdir(versionsDirOf(root), { recursive: true });
  const work = await mkdtemp(join(root, ".update-"));
  try {
    const archive = join(work, release.archiveName);
    const actual = await withRetries(() => download(deps, release.archiveUrl, archive), deps.sleep);
    const sums = await withRetries(async () => (await get(deps, release.sumsUrl)).text(), deps.sleep);
    const expected = expectedHashOf(sums, release.archiveName);
    if (expected === undefined) throw new Error(`SHA256SUMS has no line for ${release.archiveName}.`);
    if (expected !== actual) {
      await rm(archive, { force: true });
      throw new Error(`The download of ${release.archiveName} does not match SHA256SUMS.`);
    }
    const extracted = join(work, "extracted");
    await mkdir(extracted);
    const untar = await deps.run("tar", ["-xzf", archive, "-C", extracted], {
      stdio: "capture",
      timeoutMs: EXTRACT_TIMEOUT_MS,
    });
    if (untar.code !== 0)
      throw new Error(`Could not extract the archive: ${untar.stderr.trim().slice(0, 300)}`);
    const payload = await payloadDirOf(extracted);
    await chmod(join(payload, "tau"), 0o755);
    const target = versionDirIn(root, release.version);
    await rm(target, { recursive: true, force: true });
    await rename(payload, target);
    try {
      await requireVersion(deps, join(target, "tau"), release.version);
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      throw error;
    }
    return target;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Stage, then swap `current`. The running server is untouched until it restarts. */
export async function installRelease(deps: InstallDeps, release: Release, root: string): Promise<void> {
  await stageRelease(deps, release, root);
  swapCurrent(root, release.version);
}
