import { isPlainVersion } from "@tau/protocol";
import { archiveNameOf, SUMS_NAME } from "./platform";

export const REPO = "pablopunk/tau";
export const RELEASES_API = `https://api.github.com/repos/${REPO}`;
const HTTP_TIMEOUT_MS = 15_000;

export type FetchLike = typeof fetch;

/** A release that can be installed here: this platform's archive and `SHA256SUMS` are both assets. */
export interface Release {
  readonly version: string;
  readonly archiveUrl: string;
  readonly archiveName: string;
  readonly sumsUrl: string;
}

const unavailable = (what: string) => new Error(`Could not read the latest release from GitHub (${what}).`);

function limitedText(response: Response): string {
  const retry = response.headers.get("retry-after");
  return `HTTP ${response.status}${retry ? `, retry after ${retry}s` : ""}`;
}

async function releaseJson(fetchImpl: FetchLike, url: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { "user-agent": "tau-updater", accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    throw unavailable(error instanceof Error ? error.message : String(error));
  }
  if (response.status !== 200) throw unavailable(limitedText(response));
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw unavailable("not JSON");
  }
}

function assetUrls(release: Record<string, unknown>): Map<string, string> {
  const urls = new Map<string, string>();
  const assets = Array.isArray(release.assets) ? (release.assets as unknown[]) : [];
  for (const asset of assets) {
    const { name, browser_download_url: url } = (asset ?? {}) as { name?: unknown; browser_download_url?: unknown };
    if (typeof name === "string" && typeof url === "string") urls.set(name, url);
  }
  return urls;
}

/**
 * The release `tag` ("latest" or `v1.2.3`) as `Release`, only when it can be installed right now. Anything else
 * throws, so callers keep their previous `latest` (a 403 or 429 included: the next check is hours away).
 */
export async function fetchRelease(
  fetchImpl: FetchLike,
  platformKey: string | undefined,
  tag: "latest" | string = "latest",
  api: string = RELEASES_API,
): Promise<Release> {
  if (platformKey === undefined) throw new Error("tau ships no binary for this platform.");
  const path = tag === "latest" ? "releases/latest" : `releases/tags/${tag}`;
  const body = await releaseJson(fetchImpl, `${api}/${path}`);
  if (body.draft === true || body.prerelease === true) throw unavailable("the release is not published");
  const version = String(body.tag_name ?? "").replace(/^v/, "");
  if (!isPlainVersion(version)) throw new Error(`GitHub returned an unexpected version: ${version}`);
  const urls = assetUrls(body);
  const archiveName = archiveNameOf(version, platformKey);
  const archiveUrl = urls.get(archiveName);
  const sumsUrl = urls.get(SUMS_NAME);
  if (archiveUrl === undefined || sumsUrl === undefined) {
    throw unavailable(`release ${version} has no ${archiveUrl === undefined ? archiveName : SUMS_NAME} yet`);
  }
  return { version, archiveUrl, archiveName, sumsUrl };
}

export async function fetchLatestVersion(
  platformKey: string | undefined,
  fetchImpl: FetchLike = fetch,
  api: string = RELEASES_API,
): Promise<string> {
  return (await fetchRelease(fetchImpl, platformKey, "latest", api)).version;
}
