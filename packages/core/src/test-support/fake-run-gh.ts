import type { GhResult, RunGh } from "../github/run-gh";
import type { FakeGhConfig, FakeGhStatus } from "./fake-gh";
import { GH_REPOS_ARGV, GH_STATUS_ARGV } from "./gh-argv";

export type GhReply = GhResult | Error;

export interface RecordingRunGh {
  readonly run: RunGh;
  readonly calls: string[][];
}

export const ghOk = (stdout: string): GhResult => ({ stdout, stderr: "", exitCode: 0 });

export const ghFailure = (stderr: string, exitCode = 1): GhResult => ({ stdout: "", stderr, exitCode });

export const spawnError = (code: string): Error => Object.assign(new Error(`spawn gh ${code}`), { code });

const hostEntry = (status: Extract<FakeGhStatus, { state: "connected" }>) => ({
  state: "success",
  active: true,
  host: "github.com",
  login: status.login,
  tokenSource: status.tokenSource,
  scopes: "repo",
  gitProtocol: status.gitProtocol,
});

export const statusJson = (hosts: Record<string, unknown[]>) => ghOk(JSON.stringify({ hosts }));

export function statusReply(status: FakeGhStatus): GhReply {
  if (status.state === "connected") return statusJson({ "github.com": [hostEntry(status)] });
  if (status.state === "not_logged_in") return statusJson({});
  return ghFailure(status.message);
}

const sameArgs = (expected: readonly string[], args: readonly string[]) =>
  expected.length === args.length && expected.every((arg, index) => arg === args[index]);

/** Records every call and answers through `answer`; a returned `Error` rejects like a spawn failure. */
export function recordingRunGh(
  answer: (args: readonly string[]) => GhReply | Promise<GhReply>,
): RecordingRunGh {
  const calls: string[][] = [];
  const run: RunGh = async (args) => {
    calls.push([...args]);
    const reply = await answer(args);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { run, calls };
}

/** The same answers as the fake `gh` script, in process. */
export function runGhFromConfig(config: () => FakeGhConfig): RecordingRunGh {
  return recordingRunGh((args) => {
    if (sameArgs(GH_STATUS_ARGV, args)) return statusReply(config().status);
    if (sameArgs(GH_REPOS_ARGV, args)) return ghOk(JSON.stringify(config().repos));
    if (args[0] === "pr" && args[1] === "create") return ghOk("https://github.com/fake/repo/pull/1\n");
    return ghFailure("fake gh: unexpected arguments", 2);
  });
}
