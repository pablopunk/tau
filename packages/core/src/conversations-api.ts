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
  nativeAttachmentsError,
  nativeDisabledError,
  type SendMessageInput,
  type SendReceipt,
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
import type { ArchivedCleanup } from "./archived-cleanup";
import {
  admitAndDispatchBang,
  type BangCommandDeps,
  dispatchBang,
  entryOfThread,
  parseBangCommand,
} from "./bang-command";
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
import { retainedError } from "./runtimes/native/native-mode";
import { type NativeService, requireNativeInput } from "./runtimes/native/service";
import type { StatusTracker } from "./status/status-tracker";
import type { TitleService } from "./titles/title-service";
import type { UploadStore } from "./upload-store";
import type { WorkspaceService } from "./workspaces/workspace-service";

const FALLBACK_THINKING_LEVEL = "medium";

export type NativeStartInput = Pick<StartConversationInput, "projectId" | "text" | "requestId" | "workspace">;

export type NativeConversationsApi = {
  /** Core level only, not on the wire: starts a native thread and queues its first message. */
  startNative(input: NativeStartInput): Promise<ConversationSummary>;
};

const unsupportedOnNative = (capability: string): AppError =>
  new AppError("invalid_request", `Native Claude Code threads do not support ${capability} yet.`);

const sequenceOfReceipt = (receiptId: string): number =>
  Number(receiptId.slice(receiptId.lastIndexOf(":") + 1));

/** Everything that assumes a Pi conversation refuses a native thread before any side effect. */
function routeNativeThreads(
  api: Core["conversations"],
  native: NativeService,
  cancelBeforeRemove: (id: string) => Promise<void>,
): Core["conversations"] {
  const piOnly =
    <Args extends [string, ...unknown[]], Result>(
      capability: string,
      method: (...args: Args) => Promise<Result>,
    ) =>
    async (...args: Args): Promise<Result> => {
      if (await native.isNative(args[0])) throw unsupportedOnNative(capability);
      return method(...args);
    };
  return {
    ...api,
    async send(id, input) {
      if (!(await native.isNative(id))) return api.send(id, input);
      const receipt = await native.send(id, input);
      return { submissionId: sequenceOfReceipt(receipt.receiptId) };
    },
    async abort(id) {
      if (!(await native.isNative(id))) return api.abort(id);
      await native.cancel(id);
      return { restored: [] };
    },
    async remove(id, options) {
      if (await native.isNative(id)) await cancelBeforeRemove(id);
      return api.remove(id, options);
    },
    retry: piOnly("retry", api.retry),
    sendNow: piOnly("send now", api.sendNow),
    configure: piOnly("changing the model", api.configure),
    compact: piOnly("compaction", api.compact),
    fork: piOnly("fork", api.fork),
    rewind: piOnly("rewind", api.rewind),
    rewindPreview: piOnly("rewind", api.rewindPreview),
    cancelQueued: piOnly("editing queued messages", api.cancelQueued),
    setQueuedMode: piOnly("editing queued messages", api.setQueuedMode),
    updateTodos: piOnly("todo updates", api.updateTodos),
    stopAgent: piOnly("stopping subagents", api.stopAgent),
  };
}

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
  /** Refuses a message for a thread whose workspace is being merged or removed by another thread. Default: open. */
  workspaceFence?: { assertOpen(workspaceKey: string, thread: string): void };
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
  /** Present while the native flag is on, or while native threads exist and only their reading and cancelling is kept. */
  native?: NativeService;
  now: () => number;
}): Core["conversations"] & Partial<NativeConversationsApi> {
  const { conversations, projects, provider, settings, titles, workspaces, checkpoints, changes, now } = deps;
  const { notifications } = deps;
  const announce = (projectId: string) => changes.emit({ resource: "conversations", projectId });
  const { removal, archivedCleanup } = deps;
  const reportCheckpointFailure = (error: unknown) =>
    console.error("tau: could not take a checkpoint", error);
  const startsInFlight = new Map<string, Promise<ConversationSummary>>();
  const sendsInFlight = new Map<string, Promise<SendReceipt>>();

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

  const bangDeps = () => ({
    threads: conversations,
    processes: deps.bang.processes,
    notifications: deps.bang.notifications,
    home: deps.bang.home,
    entryOf: (conversationId: string) => entryOfThread(deps.harness, conversationId),
    harness: deps.harness,
    ...(deps.uploads === undefined ? {} : { uploads: deps.uploads }),
  });

  async function requireWorkspaceOpen(id: string): Promise<void> {
    if (!deps.workspaceFence) return;
    const thread = await conversations.find(id);
    if (thread) deps.workspaceFence.assertOpen(thread.workspace.path, id);
  }

  async function sendOnce(id: string, input: SendMessageInput): Promise<SendReceipt> {
    await requireWorkspaceOpen(id);
    await validateMessage(input, await modelOfThread(id));
    const bang = parseBangCommand(input.text);
    if (bang.kind === "command") {
      // Display-only admission + dispatch under one gate: no checkpoint (nothing will ever anchor it),
      // no exec without a folder, and a concurrent bang refuses before any row is admitted.
      const admission = await admitAndDispatchBang(bangDeps(), id, input, now());
      announce(admission.projectId);
      if (admission.titleText !== undefined) nameTheThread(id, admission.titleText);
      return {
        submissionId: admission.submissionId,
        ...(admission.entryId === undefined ? {} : { entryId: admission.entryId }),
      };
    }
    // The server strips one `!`; web sends verbatim so every client behaves the same.
    const effective = bang.kind === "escaped" ? { ...input, text: bang.text } : input;
    await checkpoints.snapshotBefore(id, input.requestId).catch(reportCheckpointFailure);
    const { projectId, titleText, submissionId, entryId } = await conversations.send(
      id,
      effective,
      now(),
      await whenBusyFor(input),
    );
    announce(projectId);
    if (titleText !== undefined) nameTheThread(id, titleText);
    return { submissionId, entryId };
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
    const bang = parseBangCommand(input.text);
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
      // Bang sends never anchor a rewind: skip the snapshot on both admission paths.
      beforeFirstInput:
        bang.kind === "command"
          ? undefined
          : (id) => checkpoints.snapshotBefore(id, input.requestId).catch(reportCheckpointFailure),
      now: now(),
    });
    announce(project.id);
    // A bang titles from the stripped command; the stored entry keeps its display row, never model text.
    if (created && input.text.trim() !== "") {
      nameTheThread(summary.id, bang.kind === "command" ? bang.command : input.text);
    }
    if (bang.kind === "command") {
      // The first message admitted as a display-only row above; dispatch it. A retried start
      // re-admits under the same `requestId` and the marker makes the second dispatch a no-op.
      await dispatchBang(bangDeps(), summary.id, bang.command, input.requestId);
    }
    return summary;
  }

  async function startNativeOnce(
    native: NativeService,
    input: NativeStartInput,
  ): Promise<ConversationSummary> {
    const { text, requestId } = input;
    requireNativeInput({ text, requestId });
    const project = await projects.require(input.projectId);
    if (project.status !== "ready") throw new AppError("project_not_ready", "This project is not ready.");
    const workspace = await workspaces.create({
      project,
      mode: await workspaceModeFor(project.id, input.workspace),
      requestId,
      firstMessage: text,
    });
    return native.startThread({ project, input: { text, requestId }, workspace, now: now() });
  }

  const hasAttachments = (input: StartConversationInput) =>
    (input.images ?? []).length > 0 || (input.files ?? []).length > 0;

  async function startOnNativeExecutor(input: StartConversationInput): Promise<ConversationSummary> {
    const { native } = deps;
    if (!native) throw nativeDisabledError();
    if (hasAttachments(input)) throw nativeAttachmentsError();
    const { projectId, text, requestId, workspace } = input;
    return startNative(native, { projectId, text, requestId, ...(workspace && { workspace }) });
  }

  function startNative(native: NativeService, input: NativeStartInput): Promise<ConversationSummary> {
    if (!native.creationEnabled) return Promise.reject(retainedError());
    const pending = startsInFlight.get(input.requestId) ?? startNativeOnce(native, input);
    startsInFlight.set(input.requestId, pending);
    return pending.finally(() => {
      if (startsInFlight.get(input.requestId) === pending) startsInFlight.delete(input.requestId);
    });
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

  const api: Core["conversations"] = {
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
      if (input.executor === "claude-code") return startOnNativeExecutor(input);
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
      await requireWorkspaceOpen(id);
      const { projectId, submissionId, entryId } = await conversations.retry(id, input, now());
      announce(projectId);
      return { submissionId, entryId };
    },
    async sendNow(id, itemId) {
      await requireWorkspaceOpen(id);
      const { projectId, ...result } = await conversations.sendNow(id, itemId);
      announce(projectId);
      return result;
    },
    watch: (id, onOps) => conversations.watch(id, onOps),
    ...createConversationsMvp5Api({
      forker: deps.forker,
      checkpoints,
      conversations,
      subagents: createSubagentStopper(conversations, deps.harness),
    }),
  };
  const { native } = deps;
  if (!native) return api;
  const stopBeforeRemove = (id: string) =>
    native.cancel(id).then(
      () => undefined,
      (error: unknown) => console.error("tau: could not stop a native run before removal", error),
    );
  return {
    ...routeNativeThreads(api, native, stopBeforeRemove),
    startNative: (input) => startNative(native, input),
  };
}
