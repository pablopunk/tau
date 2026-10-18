import { AppError } from "@tau/protocol";

const HOST = /^[A-Za-z0-9._-]+$/;
const FAILING_URL_MARKER = "fail";

function parseUrl(url: string): { host: string; path: string } | undefined {
  const scp = /^([A-Za-z0-9._-]+)@([A-Za-z0-9._-]+):(.+)$/.exec(url);
  if (scp?.[2] && scp[3]) return { host: scp[2], path: scp[3] };
  const standard = /^(?:https|ssh):\/\/(?:([^@/]+)@)?([^/:]+)(?::\d+)?\/(.+)$/.exec(url);
  if (!standard?.[2] || !standard[3]) return undefined;
  if (standard[1]?.includes(":")) return undefined;
  return { host: standard[2], path: standard[3] };
}

/** Throws `invalid_git_url`; returns the URL in the form used to detect duplicates. */
export function normalizeGitUrl(url: string): string {
  const parsed = url.includes("::") || url.startsWith("-") ? undefined : parseUrl(url);
  if (!parsed || !HOST.test(parsed.host) || parsed.host.startsWith("-") || parsed.path.includes("..")) {
    throw new AppError("invalid_git_url", "This is not a supported git URL.");
  }
  const path = parsed.path.replace(/\/+$/, "").replace(/\.git$/, "");
  return `ssh://${parsed.host.toLowerCase()}/${path}`;
}

export function folderNameFor(url: string): string {
  const last = normalizeGitUrl(url).split("/").pop() ?? "";
  const name = last.replace(/[^A-Za-z0-9._-]/g, "").replace(/^[.-]+/, "");
  return name === "" ? "repo" : name;
}

export const cloneWouldFail = (url: string): boolean => url.includes(FAILING_URL_MARKER);

const GITHUB_HOST = /^ssh:\/\/(?:ssh\.)?github\.com\//;

/** Duplicate detection key: GitHub repositories compare case-insensitively across URL forms. */
export function repositoryKeyOf(url: string): string {
  const normalized = normalizeGitUrl(url);
  return GITHUB_HOST.test(normalized)
    ? normalized.replace(/^ssh:\/\/ssh\./, "ssh://").toLowerCase()
    : normalized;
}
