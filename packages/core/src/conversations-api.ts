import { clampThinkingLevel } from "@earendil-works/pi-ai/models";
import {
  AppError,
  type ConversationSummary,
  type Core,
  type ModelRef,
  type SendMessageInput,
  type StartConversationInput,
} from "@pi-everywhere/protocol";
import type { ChangeEmitter } from "./change-emitter";
import { requireContent, requireImageBytesMatchTheirType, requireImagesAllowed } from "./conversation-input";
import type { ConversationStore } from "./harness/conversation-store";
import type { ProjectStore } from "./harness/project-store";
import type { SettingsStore } from "./home/settings-store";
import type { ProviderService } from "./provider/provider-service";
import { requireName } from "./require-name";
import type { StatusTracker } from "./status/status-tracker";
import type { TitleService } from "./titles/title-service";

const DEFAULT_THINKING_LEVEL = "medium";

export function createConversationsApi(deps: {
  conversations: ConversationStore;
  projects: ProjectStore;
  provider: ProviderService;
  settings: SettingsStore;
  titles: TitleService;
  status: StatusTracker;
  changes: ChangeEmitter;
  now: () => number;
}): Core["conversations"] {
  const { conversations, projects, provider, settings, titles, changes, now } = deps;
  const announce = (projectId: string) => changes.emit({ resource: "conversations", projectId });
  const startsInFlight = new Map<string, Promise<ConversationSummary>>();

  const nameTheThread = (id: string, text: string) => void titles.generateFor(id, text);
  const lookUp = (ref: ModelRef) => provider.models.getModel(ref.provider, ref.modelId);

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
    const thinkingLevel = clampThinkingLevel(model, input.thinkingLevel ?? DEFAULT_THINKING_LEVEL);
    const { summary, created } = await conversations.start({
      project,
      model: { provider: ref.provider, modelId: ref.modelId },
      thinkingLevel,
      input,
      now: now(),
    });
    announce(project.id);
    if (created && input.text.trim() !== "") nameTheThread(summary.id, input.text);
    return summary;
  }

  async function modelOfThread(id: string): Promise<ModelRef> {
    const ref = await conversations.modelOf(id);
    if (!ref) throw new AppError("invalid_request", "This thread has no model.");
    return ref;
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
      const { projectId, titleText } = await conversations.send(id, input, now());
      announce(projectId);
      if (titleText !== undefined) nameTheThread(id, titleText);
    },
    abort: (id) => conversations.abort(id),
    async archive(id, archived) {
      announce(await conversations.archive(id, archived, now()));
    },
    async remove(id) {
      const projectId = await conversations.remove(id, now());
      if (projectId !== undefined) announce(projectId);
    },
    async retry(id, input) {
      announce(await conversations.retry(id, input, now()));
    },
    watch: (id, onOps) => conversations.watch(id, onOps),
  };
}
