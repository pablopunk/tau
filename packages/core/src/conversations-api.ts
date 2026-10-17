import { clampThinkingLevel } from "@earendil-works/pi-ai/models";
import {
  AppError,
  type ConfigureConversationInput,
  type ConversationSummary,
  type Core,
  type ModelRef,
  type SendMessageInput,
  type StartConversationInput,
  type ThinkingLevel,
} from "@pi-everywhere/protocol";
import type { ChangeEmitter } from "./change-emitter";
import type { CheckpointService } from "./checkpoints/checkpoint-service";
import { requireContent, requireImageBytesMatchTheirType, requireImagesAllowed } from "./conversation-input";
import { createConversationRemoval } from "./conversation-removal";
import { createConversationsMvp5Api } from "./conversations-mvp5-api";
import type { ConversationForker } from "./harness/conversation-fork";
import type { ConversationStore } from "./harness/conversation-store";
import type { ProjectStore } from "./harness/project-store";
import { createSubagentStopper } from "./harness/subagent-stop";
import type { SettingsStore } from "./home/settings-store";
import type { ProviderService } from "./provider/provider-service";
import type { RemovalHooks } from "./removal-hooks";
import { requireName } from "./require-name";
import type { StatusTracker } from "./status/status-tracker";
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
  removalHooks: RemovalHooks;
  changes: ChangeEmitter;
  now: () => number;
}): Core["conversations"] {
  const { conversations, projects, provider, settings, titles, workspaces, checkpoints, changes, now } = deps;
  const announce = (projectId: string) => changes.emit({ resource: "conversations", projectId });
  const removal = createConversationRemoval({
    conversations,
    hooks: deps.removalHooks,
    now,
    announce: (projectId) => announce(projectId),
  });
  const reportCheckpointFailure = (error: unknown) =>
    console.error("pi-everywhere: could not take a checkpoint", error);
  const startsInFlight = new Map<string, Promise<ConversationSummary>>();

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

  function validateMessage(input: SendMessageInput, ref: ModelRef) {
    requireContent(input);
    requireImagesAllowed(input, lookUp(ref));
    requireImageBytesMatchTheirType(input);
  }

  async function startOnce(input: StartConversationInput): Promise<ConversationSummary> {
    const project = await projects.require(input.projectId);
    if (project.status !== "ready") throw new AppError("project_not_ready", "This project is not ready.");
    const ref = await chooseModel(input.model);
    const model = lookUp(ref);
    if (!model) throw new AppError("invalid_request", "This model is not available.");
    validateMessage(input, ref);
    const thinkingLevel = clampThinkingLevel(model, input.thinkingLevel ?? (await defaultLevel()));
    const workspace = await workspaces.create({
      project,
      mode: input.workspace ?? (await settings.get()).workspaceDefault,
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

  async function archiveChildren(id: string, archived: boolean) {
    const summary = await conversations.find(id);
    if (!summary) return;
    const children = (await conversations.list(summary.projectId)).filter((thread) => thread.parentId === id);
    for (const child of children) {
      if (archived) await conversations.abort(child.id);
      await conversations.archive(child.id, archived, now());
    }
  }

  async function modelOfThread(id: string): Promise<ModelRef> {
    const ref = await conversations.modelOf(id);
    if (!ref) throw new AppError("invalid_request", "This thread has no model.");
    return ref;
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
    async send(id, input) {
      validateMessage(input, await modelOfThread(id));
      await checkpoints.snapshotBefore(id, input.requestId).catch(reportCheckpointFailure);
      const { projectId, titleText } = await conversations.send(id, input, now(), await whenBusyFor(input));
      announce(projectId);
      if (titleText !== undefined) nameTheThread(id, titleText);
    },
    abort: (id) => conversations.abort(id),
    async archive(id, archived) {
      await archiveChildren(id, archived);
      announce(await conversations.archive(id, archived, now()));
    },
    remove: (id, options) => removal.remove(id, options?.force === true),
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
      subagents: createSubagentStopper(conversations),
    }),
  };
}
