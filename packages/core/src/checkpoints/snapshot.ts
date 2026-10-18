import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Repo } from "./repo";
import { type GitRun, runGit } from "./run-git";

const checkpointsFolder = (home: string) => join(home, "checkpoints");

export const indexFileOf = (home: string, conversationId: string) =>
  join(checkpointsFolder(home), `${conversationId}.index`);

export const refPrefixOf = (conversationId: string) => `refs/tau/${conversationId}/`;

export const refOf = (conversationId: string, name: string | number) =>
  `${refPrefixOf(conversationId)}${name}`;

export type SnapshotTarget = {
  readonly home: string;
  readonly conversationId: string;
  readonly repo: Repo;
};

const UNINDEXABLE = "unable to index file";

/** An empty nested repository cannot be indexed; the rest is still added, so that failure is not one. */
async function addEverything(run: GitRun): Promise<void> {
  try {
    await runGit(run, ["add", "-A", "--ignore-errors", "--", ":/"]);
  } catch (error) {
    if (!(error instanceof Error && error.message.includes(UNINDEXABLE))) throw error;
  }
}

/** The tree of the whole work tree (ignored files excluded), through the thread's own index file. */
export async function takeTree({ home, conversationId, repo }: SnapshotTarget): Promise<string> {
  await mkdir(checkpointsFolder(home), { recursive: true });
  const run = { cwd: repo.root, indexFile: indexFileOf(home, conversationId) };
  await addEverything(run);
  return (await runGit(run, ["write-tree"])).trim();
}

export async function commitTree(target: SnapshotTarget, tree: string, ref: string): Promise<string> {
  const run = { cwd: target.repo.root };
  const sha = (await runGit(run, ["commit-tree", tree, "-m", "tau checkpoint"])).trim();
  await runGit(run, ["update-ref", ref, sha]);
  return sha;
}

export async function takeSnapshot(target: SnapshotTarget, ref: string): Promise<string> {
  return commitTree(target, await takeTree(target), ref);
}

export async function pointRefAt(repo: Repo, ref: string, sha: string): Promise<void> {
  await runGit({ cwd: repo.root }, ["update-ref", ref, sha]);
}

export async function deleteRefsOf(commonDir: string, conversationId: string): Promise<void> {
  const run = { cwd: commonDir };
  const gitDir = `--git-dir=${commonDir}`;
  const listed = await runGit(run, [
    gitDir,
    "for-each-ref",
    "--format=%(refname)",
    refPrefixOf(conversationId),
  ]);
  for (const ref of listed.split("\n").filter(Boolean)) await runGit(run, [gitDir, "update-ref", "-d", ref]);
}

export async function deleteIndexFile(home: string, conversationId: string): Promise<void> {
  await rm(indexFileOf(home, conversationId), { force: true });
}
