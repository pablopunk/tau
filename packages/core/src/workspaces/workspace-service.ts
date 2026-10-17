import type {
  ConversationSummary,
  Core,
  Project,
  ThreadWorkspace,
  WorkspaceMode,
} from "@pi-everywhere/protocol";
import { legacyWorkspace } from "../harness/conversation-index";
import type { ConversationStore } from "../harness/conversation-store";
import { notImplemented } from "../not-implemented";

export interface CreateWorkspaceRequest {
  readonly project: Project;
  readonly mode: WorkspaceMode;
  /** Idempotency key: a retried start must reuse the worktree it already made. */
  readonly requestId: string;
  readonly firstMessage: string;
}

export interface WorkspaceOperations {
  /** Checkout mode (and any project that is not inside a git repo) answers `legacyWorkspace(project.path)`. */
  create(request: CreateWorkspaceRequest): Promise<ThreadWorkspace>;
  /** Uncommitted files and unmerged commits that deleting the thread would lose; empty for checkouts. */
  unmergedWork(conversation: ConversationSummary): Promise<string[]>;
  /** Removes the worktree and branch of a deleted thread (the guard already ran). */
  onConversationRemoved(conversation: ConversationSummary): Promise<void>;
  onProjectRemoved(projectId: string): Promise<void>;
}

export type WorkspaceService = Core["workspaces"] & WorkspaceOperations;

export interface WorkspaceDeps {
  readonly home: string;
  readonly conversations: ConversationStore;
}

const reject = (what: string) => async (): Promise<never> => {
  throw notImplemented(what);
};

export function createWorkspaceService(_deps: WorkspaceDeps): WorkspaceService {
  return {
    create: async ({ project }) => legacyWorkspace(project.path),
    unmergedWork: async () => [],
    onConversationRemoved: async () => undefined,
    onProjectRemoved: async () => undefined,
    status: reject("workspaces.status"),
    merge: reject("workspaces.merge"),
    createPullRequest: reject("workspaces.createPullRequest"),
    remove: reject("workspaces.remove"),
  };
}
