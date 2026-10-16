import { AppError, type Core } from "@pi-everywhere/protocol";
import type { ChangeEmitter } from "./change-emitter";
import type { ConversationStore } from "./harness/conversation-store";
import type { ProjectStore } from "./harness/project-store";
import type { SettingsStore } from "./home/settings-store";
import type { ProviderService } from "./provider/provider-service";
import { requireName } from "./require-name";

export function createConversationsApi(deps: {
  conversations: ConversationStore;
  projects: ProjectStore;
  provider: ProviderService;
  settings: SettingsStore;
  changes: ChangeEmitter;
  now: () => number;
}): Core["conversations"] {
  const { conversations, projects, provider, settings, changes, now } = deps;
  const announce = (projectId: string) => changes.emit({ resource: "conversations", projectId });

  async function requireDefaultModel() {
    if (!(await provider.isConfigured())) throw new AppError("no_provider", "Connect a provider first.");
    const { defaultModel } = await settings.get();
    if (!defaultModel) throw new AppError("no_default_model", "Choose a default model first.");
    return defaultModel;
  }

  return {
    async list(projectId) {
      await projects.require(projectId);
      return conversations.list(projectId);
    },
    async create(projectId) {
      const project = await projects.require(projectId);
      const model = await requireDefaultModel();
      const summary = await conversations.create(project, model, now());
      announce(projectId);
      return summary;
    },
    async rename(id, title) {
      announce(await conversations.rename(id, requireName(title)));
    },
    async send(id, input) {
      announce(await conversations.send(id, input, now()));
    },
    abort: (id) => conversations.abort(id),
    watch: (id, onOps) => conversations.watch(id, onOps),
  };
}
