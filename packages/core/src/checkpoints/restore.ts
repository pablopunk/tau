import { chmod, lstat, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import type { RestorePreview } from "@pi-everywhere/protocol";
import type { Repo } from "./repo";
import { runGitBuffer } from "./run-git";
import { type RawChange, rawChanges } from "./tree-diff";
import { requireRepoRelative } from "./validate-path";

const GITLINK = "160000";
const SYMLINK = "120000";
const EXECUTABLE = "100755";

export type RestoreStep = {
  readonly path: string;
  readonly action: "write" | "delete";
  readonly mode: string;
  readonly oid: string;
};

const touchesNestedRepo = (change: RawChange) => change.fromMode === GITLINK || change.toMode === GITLINK;

const stepOf = (change: RawChange): RestoreStep => ({
  path: change.path,
  action: change.status === "A" ? "delete" : "write",
  mode: change.fromMode,
  oid: change.fromOid,
});

/** What takes the work tree (as `current` holds it) back to `target`. Nested repos are never touched. */
export async function planRestore(repo: Repo, target: string, current: string): Promise<RestoreStep[]> {
  const changes = await rawChanges(repo, target, current);
  return changes.filter((change) => !touchesNestedRepo(change)).map(stepOf);
}

export const previewOf = (checkpointId: string, steps: readonly RestoreStep[]): RestorePreview => ({
  checkpointId,
  changes: steps.map(({ path, action }) => ({ path, action })),
});

async function requireInsideRepo(realRoot: string, target: string): Promise<void> {
  const parent = await realpath(dirname(target));
  if (parent !== realRoot && !parent.startsWith(realRoot + sep)) {
    throw new Error(`Refusing to write outside the repository: ${target}`);
  }
}

const parentExists = (target: string) =>
  lstat(dirname(target)).then(
    () => true,
    () => false,
  );

async function removeExisting(target: string): Promise<void> {
  const existing = await lstat(target).catch(() => undefined);
  if (existing) await rm(target, { recursive: existing.isDirectory(), force: true });
}

async function writeStep(repo: Repo, realRoot: string, step: RestoreStep): Promise<void> {
  if (step.mode === GITLINK) return;
  const target = join(repo.root, step.path);
  await mkdir(dirname(target), { recursive: true });
  await requireInsideRepo(realRoot, target);
  const blob = await runGitBuffer({ cwd: repo.root }, ["cat-file", "blob", step.oid]);
  await removeExisting(target);
  if (step.mode === SYMLINK) {
    await symlink(blob.toString("utf8"), target);
    return;
  }
  await writeFile(target, blob);
  await chmod(target, step.mode === EXECUTABLE ? 0o755 : 0o644);
}

async function deleteStep(repo: Repo, realRoot: string, step: RestoreStep): Promise<void> {
  const target = join(repo.root, step.path);
  if (!(await parentExists(target))) return;
  await requireInsideRepo(realRoot, target);
  const existing = await lstat(target).catch(() => undefined);
  if (existing && !existing.isDirectory()) await rm(target, { force: true });
}

export async function applyRestore(repo: Repo, steps: readonly RestoreStep[]): Promise<void> {
  for (const step of steps) requireRepoRelative(step.path);
  const realRoot = await realpath(repo.root);
  for (const step of steps.filter((candidate) => candidate.action === "delete")) {
    await deleteStep(repo, realRoot, step);
  }
  for (const step of steps.filter((candidate) => candidate.action === "write")) {
    await writeStep(repo, realRoot, step);
  }
}
