import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ThreadWorkspace } from "@pi-everywhere/protocol";
import { legacyWorkspace } from "../harness/conversation-index";
import {
  branchExists,
  currentBranch,
  hasCommits,
  inWorktree,
  localRef,
  locateRepo,
  type RepoLocation,
} from "./repo-facts";
import { git } from "./run-repo-command";
import { firstFreeSlug, slugFrom } from "./slug";
import type { CreateWorkspaceRequest } from "./workspace-service";

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const requestRecordPath = (folder: string, requestId: string) =>
  join(folder, ".requests", `${createHash("sha256").update(requestId).digest("hex").slice(0, 32)}.json`);

async function rememberedWorkspace(folder: string, requestId: string): Promise<ThreadWorkspace | undefined> {
  try {
    const saved = JSON.parse(await readFile(requestRecordPath(folder, requestId), "utf8")) as ThreadWorkspace;
    return (await exists(saved.path)) ? saved : undefined;
  } catch {
    return undefined;
  }
}

async function remember(folder: string, requestId: string, workspace: ThreadWorkspace): Promise<void> {
  const file = requestRecordPath(folder, requestId);
  await mkdir(join(folder, ".requests"), { recursive: true });
  await writeFile(file, JSON.stringify(workspace));
}

async function addWorktree(repo: RepoLocation, folder: string, base: string, message: string) {
  const slug = await firstFreeSlug(
    slugFrom(message),
    async (candidate) =>
      (await branchExists(repo.root, `pi/${candidate}`)) || (await exists(join(folder, candidate))),
  );
  const worktree = join(folder, slug);
  await mkdir(folder, { recursive: true });
  await git(repo.root, ["worktree", "add", "-b", `pi/${slug}`, "--", worktree, localRef(base)]);
  return { slug, worktree };
}

export const repoFolderIn = (home: string, root: string) => join(home, "worktrees", basename(root));

export async function createWorktreeWorkspace(
  home: string,
  { project, requestId, firstMessage }: CreateWorkspaceRequest,
): Promise<ThreadWorkspace> {
  const repo = await locateRepo(project.path);
  const base = repo && (await hasCommits(repo.root)) ? await currentBranch(repo.root) : undefined;
  if (!repo || base === undefined) return legacyWorkspace(project.path);
  const folder = repoFolderIn(home, repo.root);
  const earlier = await rememberedWorkspace(folder, requestId);
  if (earlier) return earlier;
  const { slug, worktree } = await addWorktree(repo, folder, base, firstMessage);
  const path = inWorktree(worktree, repo.subpath);
  await mkdir(path, { recursive: true });
  const workspace: ThreadWorkspace = {
    mode: "worktree",
    path,
    branch: `pi/${slug}`,
    base,
    state: "ready",
    mergedSha: null,
    pullRequestUrl: null,
  };
  await remember(folder, requestId, workspace);
  return workspace;
}
