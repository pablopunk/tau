import { AppError, type Core } from "@pi-everywhere/protocol";
import type { ChangeEmitter } from "./change-emitter";
import type { ConversationStore } from "./harness/conversation-store";
import type { ProjectStore } from "./harness/project-store";
import type { SettingsStore } from "./home/settings-store";
import { notImplemented } from "./not-implemented";
import type { ProviderService } from "./provider/provider-service";
import { requireName } from "./require-name";
import type { StatusTracker } from "./status/status-tracker";
import type { TitleService } from "./titles/title-service";

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
  const { conversations, projects, provider, settings, changes, now } = deps;
  const announce = (projectId: string) => changes.emit({ resource: "conversations", projectId });

  async function requireProvider() {
    if (!(await provider.isConfigured())) throw new AppError("no_provider", "Connect a provider first.");
  }

  async function requireDefaultModel() {
    await requireProvider();
    const { defaultModel } = await settings.get();
    if (!defaultModel) throw new AppError("no_default_model", "Choose a default model first.");
    return defaultModel;
  }

  return {
    async list(projectId) {
      await projects.require(projectId);
      return conversations.list(projectId);
    },
    async listAll() {
      throw notImplemented("conversations.listAll");
    },
    async start(input) {
      const project = await projects.require(input.projectId);
      if (project.status !== "ready") throw new AppError("project_not_ready", "This project is not ready.");
      await requireProvider();
      if (input.images?.length) throw notImplemented("conversations.start with images");
      const model = input.model ?? (await requireDefaultModel());
      const created = await conversations.create(project, model, now());
      await conversations.send(created.id, { text: input.text, requestId: input.requestId }, now());
      announce(project.id);
      const summaries = await conversations.list(project.id);
      return summaries.find((summary) => summary.id === created.id) ?? created;
    },
    async rename(id, title) {
      announce(await conversations.rename(id, requireName(title)));
    },
    async send(id, input) {
      announce(await conversations.send(id, input, now()));
    },
    abort: (id) => conversations.abort(id),
    async archive() {
      throw notImplemented("conversations.archive");
    },
    async remove() {
      throw notImplemented("conversations.remove");
    },
    async retry() {
      throw notImplemented("conversations.retry");
    },
    watch: (id, onOps) => conversations.watch(id, onOps),
  };
}
