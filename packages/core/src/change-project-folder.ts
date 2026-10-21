import { isAbsolute, join, relative } from "node:path";
import { AppError, type ConversationSummary, type Project } from "@tau/protocol";
import type { ChangeEmitter } from "./change-emitter";
import type { ConversationStore } from "./harness/conversation-store";
import { HOME_PROJECT_ID, type ProjectStore } from "./harness/project-store";
import { resolveProjectFolder } from "./resolve-project-folder";
import { liveWorktreeThreads, repairWorktrees } from "./workspaces/repair-worktrees";
import { requireSameRepository } from "./workspaces/same-repository";

export interface ChangeFolderDeps {
  readonly projects: ProjectStore;
  readonly conversations: ConversationStore;
  readonly changes: ChangeEmitter;
  readonly relocateCheckpoints: (conversationId: string, oldRoot: string, newRoot: string) => Promise<void>;
}

async function moveCheckpoints(
  deps: ChangeFolderDeps,
  threads: readonly ConversationSummary[],
  oldPath: string,
  newPath: string,
) {
  for (const thread of threads) await deps.relocateCheckpoints(thread.id, oldPath, newPath);
}

const requireNotHome = (project: Project) => {
  if (project.id === HOME_PROJECT_ID) {
    throw new AppError("invalid_request", "The Home project's folder cannot be changed.");
  }
};

const busyMessage = (busy: number) =>
  `${busy} thread${busy === 1 ? " is" : "s are"} running in this project. Stop ${busy === 1 ? "it" : "them"} before changing the folder.`;

const requireNoBusyThread = (threads: readonly ConversationSummary[]) => {
  const busy = threads.filter((thread) => thread.status === "running").length;
  if (busy > 0) throw new AppError("thread_busy", busyMessage(busy));
};

const isInside = (root: string, path: string) => {
  const rel = relative(root, path);
  return !rel.startsWith("..") && !isAbsolute(rel);
};

const threadsStillInOldFolder = (threads: readonly ConversationSummary[], oldPath: string) =>
  threads.filter(
    (thread) => thread.workspace.mode === "checkout" && isInside(oldPath, thread.workspace.path),
  );

const movedPath = (oldRoot: string, newRoot: string, path: string) => join(newRoot, relative(oldRoot, path));

async function moveCheckoutThreads(
  conversations: ConversationStore,
  threads: readonly ConversationSummary[],
  oldPath: string,
  newPath: string,
) {
  for (const thread of threadsStillInOldFolder(threads, oldPath)) {
    const path = movedPath(oldPath, newPath, thread.workspace.path);
    await conversations.setWorkspace(thread.id, { ...thread.workspace, path });
  }
}

async function failingStep<T>(step: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AppError(
      "internal",
      `Changing the folder failed while ${step}: ${reason}. Run it again to finish.`,
    );
  }
}

export async function changeProjectFolder(deps: ChangeFolderDeps, id: string, typedPath: string) {
  const { projects, conversations, changes } = deps;
  const project = await projects.require(id);
  requireNotHome(project);
  const newPath = await resolveProjectFolder(typedPath);
  if (newPath === project.path) return project;
  const threads = await conversations.list(id);
  requireNoBusyThread(threads);
  await requireSameRepository(project, newPath, liveWorktreeThreads(threads));
  await failingStep("repairing worktrees", () => repairWorktrees(newPath, threads));
  await failingStep("moving threads", () =>
    moveCheckoutThreads(conversations, threads, project.path, newPath),
  );
  await failingStep("moving checkpoints", () => moveCheckpoints(deps, threads, project.path, newPath));
  await projects.setPath(id, newPath);
  changes.emit({ resource: "projects" });
  changes.emit({ resource: "conversations", projectId: id });
  return projects.require(id);
}
