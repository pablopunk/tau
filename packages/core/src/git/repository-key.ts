import { normalizeGitUrl } from "./git-url";

const GITHUB_HOSTS = new Set(["github.com", "ssh.github.com"]);
const GITHUB_PORTS = new Set(["", "22", "443"]);

const githubKeyOf = (normalized: string): string | undefined => {
  if (!URL.canParse(normalized)) return undefined;
  const { hostname, port, pathname } = new URL(normalized);
  if (!GITHUB_HOSTS.has(hostname) || !GITHUB_PORTS.has(port)) return undefined;
  return `github.com/${pathname.replace(/^\/+|\/+$/g, "").toLowerCase()}`;
};

/** The same GitHub repository gets the same key whatever its scheme, user, port or case; other hosts keep `normalizeGitUrl`. */
export function repositoryKey(url: string): string {
  const normalized = normalizeGitUrl(url);
  return githubKeyOf(normalized) ?? normalized;
}
