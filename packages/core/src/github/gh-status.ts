import type { GithubStatus } from "@tau/protocol";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { STATUS_ARGS } from "./gh-commands";
import type { GhResult, RunGh } from "./run-gh";

export const MINIMUM_GH_VERSION = "2.81.0";

const HostEntrySchema = Type.Object({
  state: Type.String(),
  active: Type.Optional(Type.Boolean()),
  login: Type.Optional(Type.String()),
  gitProtocol: Type.Optional(Type.String()),
  tokenSource: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
});

const StatusJsonSchema = Type.Object({ hosts: Type.Record(Type.String(), Type.Array(HostEntrySchema)) });

type HostEntry = Type.Static<typeof HostEntrySchema>;

const lastLine = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const notLoggedIn = (hint: string): GithubStatus => ({ state: "not_logged_in", hint });

const fromHost = (host: HostEntry): GithubStatus => {
  if (host.state === "success") {
    return {
      state: "connected",
      login: host.login ?? "",
      gitProtocol: host.gitProtocol === "ssh" ? "ssh" : "https",
      tokenSource: host.tokenSource ?? "",
    };
  }
  const message = host.error ?? "GitHub CLI reported an error.";
  return message.includes("401") ? notLoggedIn("Run `gh auth refresh`.") : { state: "error", message };
};

const fromHosts = (hosts: Record<string, HostEntry[]>): GithubStatus => {
  const entries = hosts["github.com"] ?? [];
  const host = entries.find((entry) => entry.active) ?? entries[0];
  return host ? fromHost(host) : notLoggedIn("Run `gh auth login`.");
};

export function statusFromResult({ stdout, stderr }: GhResult): GithubStatus {
  const json = parseJson(stdout);
  if (Value.Check(StatusJsonSchema, json)) return fromHosts(json.hosts);
  if (stderr.includes("unknown flag")) {
    return { state: "error", message: `Update gh to ${MINIMUM_GH_VERSION} or later.` };
  }
  return { state: "error", message: lastLine(stderr) ?? "GitHub CLI answered something unexpected." };
}

export function statusFromFailure(error: unknown): GithubStatus {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return { state: "not_installed" };
  if (code === "ETIMEDOUT") return { state: "error", message: "GitHub CLI timed out." };
  return { state: "error", message: error instanceof Error ? error.message : "GitHub CLI failed." };
}

export async function readGithubStatus(runGh: RunGh): Promise<GithubStatus> {
  try {
    return statusFromResult(await runGh(STATUS_ARGS));
  } catch (error) {
    return statusFromFailure(error);
  }
}
