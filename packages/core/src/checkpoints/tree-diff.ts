import type { Checkpoint } from "@tau/protocol";
import type { Repo } from "./repo";
import { runGit } from "./run-git";

export type FileChange = Checkpoint["files"][number];

export type RawChange = {
  readonly path: string;
  readonly status: string;
  readonly fromMode: string;
  readonly toMode: string;
  readonly fromOid: string;
};

const DIFF_FLAGS = ["--no-renames", "--no-ext-diff", "--no-color"];

/** `git diff --raw -z`: records `:<fromMode> <toMode> <fromOid> <toOid> <status>`, then the path. */
export async function rawChanges(repo: Repo, from: string, to: string): Promise<RawChange[]> {
  const out = await runGit({ cwd: repo.root }, [
    "diff",
    "--raw",
    "-z",
    "--no-abbrev",
    ...DIFF_FLAGS,
    from,
    to,
  ]);
  const tokens = out.split("\0");
  const changes: RawChange[] = [];
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const [fromMode = "", toMode = "", fromOid = "", , status = ""] = (tokens[index] ?? "")
      .slice(1)
      .split(" ");
    changes.push({ path: tokens[index + 1] ?? "", status, fromMode, toMode, fromOid });
  }
  return changes;
}

async function lineCounts(repo: Repo, from: string, to: string): Promise<Map<string, [number, number]>> {
  const out = await runGit({ cwd: repo.root }, ["diff", "--numstat", "-z", ...DIFF_FLAGS, from, to]);
  const counts = new Map<string, [number, number]>();
  for (const record of out.split("\0").filter(Boolean)) {
    const [added = "0", removed = "0", ...path] = record.split("\t");
    counts.set(path.join("\t"), [Number(added) || 0, Number(removed) || 0]);
  }
  return counts;
}

const statusOf = (raw: string): FileChange["status"] => (raw === "A" || raw === "D" ? raw : "M");

export async function changedFiles(repo: Repo, from: string, to: string): Promise<FileChange[]> {
  const [raw, counts] = await Promise.all([rawChanges(repo, from, to), lineCounts(repo, from, to)]);
  return raw.map(({ path, status }) => {
    const [added, removed] = counts.get(path) ?? [0, 0];
    return { path, added, removed, status: statusOf(status) };
  });
}

export function fileDiff(repo: Repo, from: string, to: string, path: string): Promise<string> {
  return runGit({ cwd: repo.root }, ["--literal-pathspecs", "diff", ...DIFF_FLAGS, from, to, "--", path]);
}
