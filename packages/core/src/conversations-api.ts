import { clampThinkingLevel } from "@earendil-works/pi-ai/models";
import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import {
  AppError,
  type ConfigureConversationInput,
  type ConversationSummary,
  type ConversationView,
  type Core,
  diffTodos,
  latestTodos,
  type ModelRef,
  type SendMessageInput,
  type StartConversationInput,
  type ThinkingLevel,
  TODOS_UPDATED_KIND,
  type TodoItem,
  todosUpdatedText,
  type UpdateTodosInput,
  UpdateTodosInputSchema,
  type WorkspaceMode,
} from "@tau/protocol";
import { Value } from "typebox/value";
import type { UploadStore } from "./upload-store";
import type { ArchivedCleanup } from "./archived-cleanup";
import { type BangCommandDeps, entryOfThread, parseBangCommand, runBangCommand } from "./bang-command";
import type { ChangeEmitter } from "./change-emitter";
import type { CheckpointService } from "./checkpoints/checkpoint-service";
import { requireContent, requireImageBytesMatchTheirType, requireImagesAllowed } from "./conversation-input";
import type { ConversationRemoval } from "./conversation-removal";
import { createConversationsMvp5Api } from "./conversations-mvp5-api";
import type { ConversationForker } from "./harness/conversation-fork";
import type { ConversationStore } from "./harness/conversation-store";
import type { NotificationSubmitter } from "./harness/notification-submitter";
import { ThreadGoneError } from "./harness/notification-submitter";
import { BACKGROUND } from "./harness/open";
import type { ProjectStore } from "./harness/project-store";
import { createSubagentStopper } from "./harness/subagent-stop";
import type { SettingsStore } from "./home/settings-store";
import type { ProviderService } from "./provider/provider-service";
import { requireName } from "./require-name";
import type { StatusTracker } from "./status/status-tracker";
import { cwdOf } from "./terminals/cwd-of";
import type { TitleService } from "./titles/title-service";
import type { WorkspaceService } from "./workspaces/workspace-service";

const FALLBACK_THINKING_LEVEL = "medium";

export function createConversationsApi(deps: {
  conversations: ConversationStore;
  projects: ProjectStore;
  provider: ProviderService;
  settings: SettingsStore;
  titles: TitleService;
  status: StatusTracker;
  workspaces: WorkspaceService;
  checkpoints: CheckpointService;
  forker: ConversationForker;
  harness: Harness;
  removal: ConversationRemoval;
  archivedCleanup: ArchivedCleanup;
  closeClaudeCliThread: (id: string) => Promise<void>;
  /** Closes the thread's terminals; called before an archive and never blocks it. */
  closeTerminalsOf?: (conversationId: string) => Promise<void>;
  /** Staged file refs validate through this before any side effect (workspace, checkpoint, exec). */
  uploads?: Pick<UploadStore, "resolveRefs">;
  /** What a `!` bang command spawns with: the process service, the home, and the notifier. */
  bang: {
    readonly processes: BangCommandDeps["processes"];
    readonly notifications: NotificationSubmitter;
    readonly home: string | undefined;
  };
  changes: ChangeEmitter;
  notifications: NotificationSubmitter;
  now: () => number;
}): Core["conversations"] {
  const { conversations, projects, provider, settings, titles, workspaces, checkpoints, changes, now } = deps;
  const { notifications } = deps;
  const announce = (projectId: string) => changes.emit({ resource: "conversations", projectId });
  const { removal, archivedCleanup } = deps;
  const reportCheckpointFailure = (error: unknown) =>
    console.error("tau: could not take a checkpoint", error);
  const startsInFlight = new Map<string, Promise<ConversationSummary>>();
  const sendsInFlight = new Map<string, Promise<void>>();

  const nameTheThread = (id: string, text: string) => void titles.generateFor(id, text);
  const lookUp = (ref: ModelRef) => provider.models.getModel(ref.provider, ref.modelId);

  async function defaultLevel(): Promise<ThinkingLevel> {
    return (await settings.get()).defaultThinkingLevel ?? FALLBACK_THINKING_LEVEL;
  }

  async function chooseModel(requested: ModelRef | undefined): Promise<ModelRef> {
    if (!(await provider.isConfigured())) throw new AppError("no_provider", "Connect a provider first.");
    const chosen = requested ?? (await settings.get()).defaultModel;
    if (!chosen) throw new AppError("no_default_model", "Choose a default model first.");
    return chosen;
  }

  async function validateMessage(input: SendMessageInput, ref: ModelRef) {
    requireContent(input);
    requireImagesAllowed(input, lookUp(ref));
    requireImageBytesMatchTheirType(input);
    // Files ride path-only context, so even a text-only model accepts them once staged.
    if ((input.files ?? []).length > 0) await deps.uploads?.resolveRefs(input.files ?? []);
  }

  async function sendOnce(id: string, input: SendMessageInput): Promise<void> {
    await validateMessage(input, await modelOfThread(id));
    const bang = parseBangCommand(input.text);
    // The server strips one `!`; web sends verbatim so every client behaves the same.
    const effective = bang.kind === "escaped" ? { ...input, text: bang.text } : input;
    // A bang command resolves its workspace before admission: no exec without a folder.
    if (bang.kind === "command") await cwdOf(conversations, id);
    await checkpoints.snapshotBefore(id, input.requestId).catch(reportCheckpointFailure);
    const { projectId, titleText, admitted } = await conversations.send(
      id,
      effective,
      now(),
      await whenBusyFor(input),
    );
    announce(projectId);
    if (titleText !== undefined) nameTheThread(id, titleText);
    // Only the admitted winner spawns: losers deduped by `requestId` never exec. The exit is never awaited.
    if (admitted && bang.kind === "command") {
      await runBangCommand(
        {
          threads: conversations,
          processes: deps.bang.processes,
          notifications: deps.bang.notifications,
          home: deps.bang.home,
          entryOf: (conversationId) => entryOfThread(deps.harness, conversationId),
        },
        id,
        bang.command,
      );
    }
  }

  async function workspaceModeFor(projectId: string, requested: WorkspaceMode | undefined) {
    if (requested) {
      await settings.setLastWorkspaceMode(projectId, requested);
      return requested;
    }
    const { workspaceDefault } = await settings.get();
    if (workspaceDefault !== "per-project") return workspaceDefault;
    return (await settings.lastWorkspaceMode(projectId)) ?? "worktree";
  }

  async function startOnce(input: StartConversationInput): Promise<ConversationSummary> {
    const project = await projects.require(input.projectId);
    if (project.status !== "ready") throw new AppError("project_not_ready", "This project is not ready.");
    const ref = await chooseModel(input.model);
    const model = lookUp(ref);
    if (!model) throw new AppError("invalid_request", "This model is not available.");
    await validateMessage(input, ref);
    const thinkingLevel = clampThinkingLevel(model, input.thinkingLevel ?? (await defaultLevel()));
    const workspace = await workspaces.create({
      project,
      mode: await workspaceModeFor(project.id, input.workspace),
      requestId: input.requestId,
      firstMessage: input.text,
    });
    const { summary, created } = await conversations.start({
      project,
      model: { provider: ref.provider, modelId: ref.modelId },
      thinkingLevel,
      input,
      workspace,
      beforeFirstInput: (id) =>
        checkpoints.snapshotBefore(id, input.requestId).catch(reportCheckpointFailure),
      now: now(),
    });
    announce(project.id);
    if (created && input.text.trim() !== "") nameTheThread(summary.id, input.text);
    return summary;
  }

  async function whenBusyFor(input: SendMessageInput) {
    if (input.whenBusy !== undefined) return input.whenBusy;
    return (await settings.get()).messageMode === "queue" ? "followUp" : "steer";
  }

  async function closeTerminalsBeforeArchive(id: string) {
    try {
      await deps.closeTerminalsOf?.(id);
    } catch (error) {
      console.error("tau: could not close terminals before archiving", error);
    }
  }

  async function archiveChildren(id: string, archived: boolean) {
    const summary = await conversations.find(id);
    if (!summary) return;
    const children = (await conversations.list(summary.projectId)).filter((thread) => thread.parentId === id);
    for (const child of children) {
      if (archived) await conversations.abort(child.id);
      if (archived) await closeTerminalsBeforeArchive(child.id);
      await conversations.archive(child.id, archived, now());
      if (archived) await deps.closeClaudeCliThread(child.id);
    }
  }

  async function modelOfThread(id: string): Promise<ModelRef> {
    const ref = await conversations.modelOf(id);
    if (!ref) throw new AppError("invalid_request", "This thread has no model.");
    return ref;
  }

  async function currentTodos(id: string): Promise<TodoItem[]> {
    const conversation = await deps.harness.conversation(Number(id) as ConversationId, BACKGROUND);
    if (!conversation) return [];
    const { entries } = await conversation.context(BACKGROUND);
    return latestTodos({ entries } as unknown as ConversationView);
  }

  async function configureThread(id: string, input: ConfigureConversationInput): Promise<void> {
    if (input.model === undefined && input.thinkingLevel === undefined) {
      throw new AppError("invalid_request", "Choose a model or a thinking level.");
    }
    const current = await conversations.agentOf(id);
    const ref = input.model ?? current.model;
    const model = lookUp(ref);
    if (!model) throw new AppError("invalid_request", "This model is not available.");
    const thinkingLevel = clampThinkingLevel(model, input.thinkingLevel ?? current.thinkingLevel);
    await conversations.configure(id, {
      model: { provider: ref.provider, modelId: ref.modelId },
      thinkingLevel,
    });
  }

  return {
    async list(projectId) {
      await projects.require(projectId);
      return conversations.list(projectId);
    },
    async listAll() {
      const perProject = await Promise.all(
        (await projects.list()).map((project) => conversations.list(project.id)),
      );
      return perProject.flat().sort((a, b) => b.updatedAt - a.updatedAt || Number(b.id) - Number(a.id));
    },
    start(input) {
      const pending = startsInFlight.get(input.requestId) ?? startOnce(input);
      startsInFlight.set(input.requestId, pending);
      return pending.finally(() => {
        if (startsInFlight.get(input.requestId) === pending) startsInFlight.delete(input.requestId);
      });
    },
    async rename(id, title) {
      announce(await conversations.rename(id, requireName(title)));
    },
    send(id, input) {
      // Like `start`: two racing sends with one `requestId` admit once, so one command spawns.
      const key = `${id}${input.requestId}`;
      const pending = sendsInFlight.get(key) ?? sendOnce(id, input);
      sendsInFlight.set(key, pending);
      return pending.finally(() => {
        if (sendsInFlight.get(key) === pending) sendsInFlight.delete(key);
      });
    },
    async updateTodos(id, input: UpdateTodosInput) {
      if (!Value.Check(UpdateTodosInputSchema, input)) {
        throw new AppError(
          "invalid_request",
          "The todo list needs 1 to 500 character items, at most 50 of them.",
        );
      }
      const thread = await conversations.find(id);
      if (!thread) throw new AppError("not_found", "Conversation not found.");
      const todos: TodoItem[] = input.todos.map((todo) => ({ content: todo.content, status: todo.status }));
      const before = await currentTodos(id);
      const diff = diffTodos(before, todos);
      // Intentionally no TodosDoc write: the entry log is the source of truth for the list
      // (the UI reads the newest todo event, the agent reads history). The notification below
      // carries the full list, so a racing agent turn converges on it instead of losing the edit.
      try {
        await notifications.notify(id, {
          kind: TODOS_UPDATED_KIND,
          data: { todos, diff, requestId: input.requestId },
          text: todosUpdatedText(todos, diff),
          requestId: `todos:${id}:${input.requestId}`,
        });
      } catch (error) {
        if (error instanceof ThreadGoneError) throw new AppError("not_found", "Conversation not found.");
        throw error;
      }
    },
    abort: (id) => conversations.abort(id),
    async archive(id, archived) {
      if (archived) await closeTerminalsBeforeArchive(id);
      await archiveChildren(id, archived);
      announce(await conversations.archive(id, archived, now()));
      if (archived) await deps.closeClaudeCliThread(id);
    },
    remove: (id, options) => removal.remove(id, options?.force === true),
    deleteArchived: (input) => archivedCleanup.deleteArchived(input),
    configure: configureThread,
    compact: (id, input) => conversations.compact(id, input.instructions),
    async retry(id, input) {
      announce(await conversations.retry(id, input, now()));
    },
    watch: (id, onOps) => conversations.watch(id, onOps),
    ...createConversationsMvp5Api({
      forker: deps.forker,
      checkpoints,
      conversations,
      subagents: createSubagentStopper(conversations, deps.harness),
    }),
  };
}
