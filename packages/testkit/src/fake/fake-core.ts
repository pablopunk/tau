import {
  AppError,
  type Change,
  type ConversationSummary,
  type Core,
  type ModelRef,
  type Project,
  type ProviderStatus,
  type Settings,
} from "@pi-everywhere/protocol";
import { FAKE_MODELS, FAKE_PROVIDER_ID } from "./catalog";
import { FakeConversation } from "./fake-conversation";
import { assertDirectory, baseName, FAKE_FS, type FakeFs } from "./fake-fs";

export interface FakeCoreOptions {
  /** Replay speed multiplier: 1 is the recorded timing, larger is faster. Default 1. */
  readonly speed?: number;
  /** Known paths, as `path -> kind`. Defaults to `FAKE_FS`. */
  readonly fs?: FakeFs;
  /** Start with a key stored and the first model as default, as after setup. */
  readonly configured?: boolean;
  readonly now?: () => number;
}

const FIRST_CONVERSATION_ID = 2;

export function createFakeCore(options: FakeCoreOptions = {}): Core {
  const now = options.now ?? Date.now;
  const speed = options.speed ?? 1;
  const fs = options.fs ?? FAKE_FS;
  const listeners = new Set<(change: Change) => void>();
  const projects: Project[] = [];
  const conversations = new Map<string, FakeConversation>();
  let keyStored = options.configured ?? false;
  let defaultModel: ModelRef | null = options.configured ? modelRef(0) : null;
  let nextProjectId = 1;
  let nextConversationId = FIRST_CONVERSATION_ID;

  const emit = (change: Change) => {
    for (const listener of [...listeners]) listener(change);
  };

  const requireProject = (id: string): Project => {
    const project = projects.find((candidate) => candidate.id === id);
    if (!project) throw new AppError("not_found", `Unknown project: ${id}`);
    return project;
  };

  const requireConversation = (id: string): FakeConversation => {
    const conversation = conversations.get(id);
    if (!conversation) throw new AppError("not_found", `Unknown conversation: ${id}`);
    return conversation;
  };

  const requireProvider = () => {
    if (!keyStored) throw new AppError("no_provider", "No API key is configured");
  };

  return {
    settings: {
      async get(): Promise<Settings> {
        return { defaultModel };
      },
      async setDefaultModel(ref) {
        requireProvider();
        const known = FAKE_MODELS.some(
          (model) => model.provider === ref.provider && model.modelId === ref.modelId,
        );
        if (!known) throw new AppError("invalid_request", `Unknown model: ${ref.provider}/${ref.modelId}`);
        defaultModel = { provider: ref.provider, modelId: ref.modelId };
      },
    },
    provider: {
      async status(): Promise<ProviderStatus> {
        return {
          provider: FAKE_PROVIDER_ID,
          configured: keyStored,
          source: keyStored ? "file" : null,
          valid: keyStored ? true : null,
        };
      },
      async setApiKey(key) {
        if (key.trim() === "") throw new AppError("invalid_key", "The key is empty");
        keyStored = true;
      },
      async listModels() {
        requireProvider();
        return FAKE_MODELS.map((model) => ({ ...model }));
      },
    },
    projects: {
      async list() {
        return projects.map((project) => ({ ...project }));
      },
      async add({ path, name }) {
        const real = assertDirectory(fs, path);
        if (projects.some((project) => project.path === real)) {
          throw new AppError("duplicate_project", `Already added: ${real}`);
        }
        const project: Project = {
          id: `project-${nextProjectId++}`,
          name: name ?? baseName(real),
          path: real,
          createdAt: now(),
        };
        projects.push(project);
        emit({ resource: "projects" });
        return { ...project };
      },
      async rename(id, name) {
        requireProject(id).name = name;
        emit({ resource: "projects" });
      },
      async remove(id) {
        requireProject(id);
        for (const [conversationId, conversation] of conversations) {
          if (conversation.projectId !== id) continue;
          await conversation.abort();
          conversation.stop();
          conversations.delete(conversationId);
        }
        projects.splice(
          projects.findIndex((project) => project.id === id),
          1,
        );
        emit({ resource: "projects" });
        emit({ resource: "conversations", projectId: id });
      },
    },
    conversations: {
      async list(projectId) {
        requireProject(projectId);
        return [...conversations.values()]
          .filter((conversation) => conversation.projectId === projectId)
          .map((conversation) => conversation.summary())
          .sort((a, b) => b.updatedAt - a.updatedAt);
      },
      async create(projectId): Promise<ConversationSummary> {
        const project = requireProject(projectId);
        requireProvider();
        if (!defaultModel) throw new AppError("no_default_model", "No default model is set");
        const conversation = new FakeConversation({
          id: String(nextConversationId++),
          projectId,
          cwd: project.path,
          model: defaultModel,
          speed,
          now,
          onSummaryChange: (changedProjectId) =>
            emit({ resource: "conversations", projectId: changedProjectId }),
        });
        conversations.set(conversation.id, conversation);
        emit({ resource: "conversations", projectId });
        return conversation.summary();
      },
      async rename(id, title) {
        requireConversation(id).rename(title);
      },
      async send(id, input) {
        requireConversation(id).send(input.requestId, input.text);
      },
      async abort(id) {
        await requireConversation(id).abort();
      },
      async watch(id, onOps) {
        return requireConversation(id).watch(onOps);
      },
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      for (const conversation of conversations.values()) conversation.stop();
      listeners.clear();
    },
  };
}

function modelRef(index: number): ModelRef {
  const model = FAKE_MODELS[index];
  if (!model) throw new Error("FAKE_MODELS is empty");
  return { provider: model.provider, modelId: model.modelId };
}
