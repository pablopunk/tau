import type { ThreadWorkspace } from "@pi-everywhere/protocol";

const SLUG_MAX_LENGTH = 40;
const SLUG_WORDS = 4;
export const FAKE_BASE_BRANCH = "main";
export const FAKE_MERGED_SHA = "0123456789abcdef0123456789abcdef01234567";
export const FAKE_PULL_REQUEST_URL = "https://github.com/demo/repo/pull/1";
export const FAKE_EDITED_FILE = "hello.txt";

export interface WorktreeChanges {
  dirtyFiles: string[];
  unmergedCommits: number;
}

export const checkoutWorkspace = (path: string): ThreadWorkspace => ({
  mode: "checkout",
  path,
  branch: null,
  base: null,
  state: "ready",
  mergedSha: null,
  pullRequestUrl: null,
});

export function slugOf(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .slice(0, SLUG_WORDS);
  return words.join("-").slice(0, SLUG_MAX_LENGTH).replace(/-$/, "") || "thread";
}

export function uniqueSlug(text: string, taken: ReadonlySet<string>): string {
  const base = slugOf(text);
  let slug = base;
  for (let suffix = 2; taken.has(slug); suffix++) slug = `${base}-${suffix}`;
  return slug;
}

export function worktreeWorkspace(
  worktreesFolder: string,
  projectName: string,
  slug: string,
): ThreadWorkspace {
  return {
    mode: "worktree",
    path: `${worktreesFolder}/${projectName}/${slug}`,
    branch: `pi/${slug}`,
    base: FAKE_BASE_BRANCH,
    state: "ready",
    mergedSha: null,
    pullRequestUrl: null,
  };
}

export type MessageEffect = "edit" | "commit" | null;

export function effectOf(text: string): MessageEffect {
  const command = text.trim().split(/\s+/)[0] ?? "";
  if (command === "write" || command === "edit") return "edit";
  return command === "commit" ? "commit" : null;
}

export function applyEffect(changes: WorktreeChanges, effect: MessageEffect): void {
  if (effect === "edit" && !changes.dirtyFiles.includes(FAKE_EDITED_FILE)) {
    changes.dirtyFiles.push(FAKE_EDITED_FILE);
  }
  if (effect === "commit" && changes.dirtyFiles.length > 0) {
    changes.dirtyFiles = [];
    changes.unmergedCommits++;
  }
}

export const unmergedKindsOfChanges = ({ dirtyFiles, unmergedCommits }: WorktreeChanges) => ({
  uncommitted: dirtyFiles.length > 0,
  commits: unmergedCommits > 0,
});
