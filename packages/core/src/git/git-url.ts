import { AppError } from "@tau/protocol";

const SAFE_NAME = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;
const SCP_FORM = /^([^@/:\s]+)@([^@/:\s]+):(.+)$/;
const WHITESPACE_OR_BACKSLASH = /[\s\\]/;
const hasControlCharacter = (text: string) => [...text].some((char) => char.charCodeAt(0) < 32);
const hasForbiddenCharacter = (text: string) =>
  WHITESPACE_OR_BACKSLASH.test(text) || hasControlCharacter(text);

const invalid = () => new AppError("invalid_git_url", "This is not a supported git URL.");

type ParsedUrl = {
  scheme: "https" | "ssh" | "file";
  user?: string;
  host?: string;
  port?: string;
  path: string;
};

const hasParentSegment = (path: string) => path.split("/").includes("..");
const stripSuffixes = (path: string) =>
  path
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");

function parseWithScheme(url: string, scheme: "https" | "ssh"): ParsedUrl | undefined {
  const rest = url.slice(`${scheme}://`.length);
  const authority = rest.split("/", 1)[0] ?? "";
  const rawPath = rest.slice(authority.length);
  const userinfo = authority.includes("@") ? authority.slice(0, authority.lastIndexOf("@")) : undefined;
  if (userinfo?.includes(":") || hasParentSegment(rawPath)) return undefined;
  if (!URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  if (parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") return undefined;
  return { scheme, user: userinfo, host: parsed.hostname, port: parsed.port, path: rawPath };
}

function parseScpForm(url: string): ParsedUrl | undefined {
  const match = SCP_FORM.exec(url);
  if (!match || hasParentSegment(match[3] ?? "")) return undefined;
  const path = (match[3] ?? "").startsWith("/") ? (match[3] ?? "") : `/${match[3]}`;
  return { scheme: "ssh", user: match[1], host: match[2], path };
}

function parse(url: string, allowLocalPaths: boolean): ParsedUrl | undefined {
  if (url === "" || url.includes("::") || hasForbiddenCharacter(url)) return undefined;
  if (url.startsWith("https://")) return parseWithScheme(url, "https");
  if (url.startsWith("ssh://")) return parseWithScheme(url, "ssh");
  if (allowLocalPaths && url.startsWith("/")) {
    return hasParentSegment(url) ? undefined : { scheme: "file", path: url };
  }
  return SCP_FORM.test(url) ? parseScpForm(url) : undefined;
}

const hasSafeAuthority = ({ host, user, scheme }: ParsedUrl) =>
  scheme === "file" ||
  (host !== undefined && SAFE_NAME.test(host) && (user === undefined || SAFE_NAME.test(user)));

const normalizeParsed = ({ scheme, user, host, port, path }: ParsedUrl): string => {
  const cleanPath = stripSuffixes(path);
  if (scheme === "file") return cleanPath;
  const userPart = scheme === "ssh" && user ? `${user}@` : "";
  const portPart = port ? `:${port}` : "";
  return `${scheme}://${userPart}${(host ?? "").toLowerCase()}${portPart}${cleanPath}`;
};

/** Returns the normalized URL, or rejects `invalid_git_url`. Local paths pass only with `allowLocalPaths`. */
export function checkGitUrl(url: string, allowLocalPaths: boolean): string {
  const parsed = parse(url, allowLocalPaths);
  if (!parsed || !hasSafeAuthority(parsed) || stripSuffixes(parsed.path) === "") throw invalid();
  return normalizeParsed(parsed);
}

/** For comparing stored URLs: the same repository normalizes to the same string. */
export function normalizeGitUrl(url: string): string {
  const parsed = parse(url, true);
  return parsed ? normalizeParsed(parsed) : url;
}

const sanitizeFolderName = (segment: string) =>
  segment.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[.-]+/, "");

/** The default folder (and project) name of a normalized URL. */
export function folderNameOf(normalizedUrl: string): string {
  const segment = normalizedUrl.split("/").filter(Boolean).at(-1) ?? "";
  return sanitizeFolderName(segment) || "repo";
}
