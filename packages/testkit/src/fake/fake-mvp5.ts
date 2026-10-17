import { AppError, type Change, type Project, type WorkspaceMode } from "@pi-everywhere/protocol";
import type { FakeConversation } from "./fake-conversation";
import { createFakeMcp } from "./fake-mcp";
import { createFakeProcesses } from "./fake-processes";
import { createFakeThreadOps, type SpawnParams } from "./fake-thread-ops";
import { checkoutWorkspace, uniqueSlug, worktreeWorkspace } from "./fake-workspace";
import { createFakeWorkspaces, hasUnmergedWork } from "./fake-workspaces";

export const FAKE_WORKTREES_FOLDER = "/fake/home/.pi-everywhere/worktrees";
const SUBAGENT_TRIGGER = "task ";
const PROCESS_TRIGGER = "bg ";

export interface Mvp5Context {
  readonly emit: (change: Change) => void;
  readonly now: () => number;
  readonly requireConversation: (id: string) => FakeConversation;
  readonly liveConversations: () => FakeConversation[];
  readonly requireProject: (id: string) => Project;
  readonly spawn: (params: SpawnParams) => FakeConversation;
  readonly githubConnected: () => Promise<boolean>;
}

export function createFakeMvp5(ctx: Mvp5Context) {
  const processes = createFakeProcesses(ctx);
  const takenSlugs = new Set<string>();
  let subagentCount = 0;

  const projectPath = (projectId: string) => ctx.requireProject(projectId).path;
  const supportsWorktrees = (project: Project) => project.kind !== "home";

  return {
    processes: processes.api,
    mcp: createFakeMcp(ctx),
    workspaces: createFakeWorkspaces({
      require: ctx.requireConversation,
      projectPath,
      githubConnected: ctx.githubConnected,
      changed: (conversation) => ctx.emit({ resource: "conversations", projectId: conversation.projectId }),
    }),
    threadOps: createFakeThreadOps({
      require: ctx.requireConversation,
      live: ctx.liveConversations,
      spawn: ctx.spawn,
    }),

    workspaceFor(project: Project, mode: WorkspaceMode, text: string) {
      if (mode === "checkout" || !supportsWorktrees(project)) return checkoutWorkspace(project.path);
      const slug = uniqueSlug(text, takenSlugs);
      takenSlugs.add(slug);
      return worktreeWorkspace(FAKE_WORKTREES_FOLDER, project.name, slug);
    },

    afterMessage(conversation: FakeConversation, text: string): void {
      if (text.startsWith(SUBAGENT_TRIGGER)) {
        const description = text.slice(SUBAGENT_TRIGGER.length).trim();
        const child = ctx.spawn({
          source: conversation,
          title: description,
          forkOf: null,
          parentId: conversation.id,
        });
        child.send(`subagent-${++subagentCount}`, { text: description });
      }
      if (text.startsWith(PROCESS_TRIGGER))
        processes.start(conversation.id, text.slice(PROCESS_TRIGGER.length).trim());
    },

    childrenOf(conversation: FakeConversation): FakeConversation[] {
      return ctx.liveConversations().filter((item) => item.parentId === conversation.id);
    },

    guardRemoval(conversation: FakeConversation, force: boolean): void {
      if (!force && hasUnmergedWork(conversation)) {
        throw new AppError("has_unmerged_work", "The worktree has unmerged work.");
      }
    },

    release(conversation: FakeConversation): void {
      processes.killAll(conversation.id);
    },
  };
}

export type FakeMvp5 = ReturnType<typeof createFakeMvp5>;
