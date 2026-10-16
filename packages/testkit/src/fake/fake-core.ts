import {
  AppError,
  type Change,
  type Core,
  type ModelRef,
  type Project,
  type ProviderStatus,
  type Settings,
  type StartConversationInput,
} from "@pi-everywhere/protocol";
import { clampFakeThinkingLevel, FAKE_MODELS, FAKE_PROVIDER_ID, findFakeModel } from "./catalog";
import { FakeConversation, type FakeInput } from "./fake-conversation";
import { assertDirectory, baseName, FAKE_FS, type FakeFs, normalizePath } from "./fake-fs";
import { cloneWouldFail, folderNameFor, normalizeGitUrl } from "./fake-git";
import { assertImageMatchesMimeType } from "./fake-images";

export interface FakeCoreOptions {
  /** Replay speed multiplier: 1 is the recorded timing, larger is faster. Default 1. */
  readonly speed?: number;
  /** Known paths, as `path -> kind`. Defaults to `FAKE_FS`. */
  readonly fs?: FakeFs;
  /** Start with a key stored and the first model as default, as after setup. */
  readonly configured?: boolean;
  readonly now?: () => number;
  /** How long a clone stays in `cloning`, before `speed`. Default 1200 ms. */
  readonly cloneMs?: number;
}

export const FAKE_HOME_PATH = "/Users/demo";
export const FAKE_PROJECTS_FOLDER = `${FAKE_HOME_PATH}/.pi-everywhere/projects`;
const HOME_ID = "home";
const FIRST_CONVERSATION_ID = 2;
const DEFAULT_CLONE_MS = 1200;
const DEFAULT_THINKING_LEVEL = "medium";
const TITLE_WORDS = 3;

const firstWords = (text: string) => text.trim().split(/\s+/).slice(0, TITLE_WORDS).join(" ");

export function createFakeCore(options: FakeCoreOptions = {}): Core {
  const now = options.now ?? Date.now;
  const speed = options.speed ?? 1;
  const fs = options.fs ?? FAKE_FS;
  const cloneMs = (options.cloneMs ?? DEFAULT_CLONE_MS) / speed;
  const listeners = new Set<(change: Change) => void>();
  const home: Project = {
    id: HOME_ID,
    name: "Home",
    path: FAKE_HOME_PATH,
    createdAt: 0,
    kind: "home",
    status: "ready",
  };
  const projects: Project[] = [];
  const clones = new Map<string, ReturnType<typeof setTimeout>>();
  const conversations = new Map<string, FakeConversation>();
  const startsByRequest = new Map<string, string>();
  let keyStored = options.configured ?? false;
  let defaultModel: ModelRef | null = options.configured ? modelRef(0) : null;
  let fastModel: ModelRef | null = null;
  let projectsFolder = FAKE_PROJECTS_FOLDER;
  let nextProjectId = 1;
  let nextConversationId = FIRST_CONVERSATION_ID;

  const emit = (change: Change) => {
    for (const listener of [...listeners]) listener(change);
  };

  const allProjects = () => [home, ...projects];

  const requireProject = (id: string): Project => {
    const project = allProjects().find((candidate) => candidate.id === id);
    if (!project) throw new AppError("not_found", `Unknown project: ${id}`);
    return project;
  };

  const requireConversation = (id: string): FakeConversation => {
    const conversation = conversations.get(id);
    if (!conversation || conversation.isDeleted) {
      throw new AppError("not_found", `Unknown conversation: ${id}`);
    }
    return conversation;
  };

  const requireProvider = () => {
    if (!keyStored) throw new AppError("no_provider", "No API key is configured");
  };

  const requireListedModel = (ref: ModelRef) => {
    const model = findFakeModel(ref);
    if (!model) throw new AppError("invalid_request", `Unknown model: ${ref.provider}/${ref.modelId}`);
    return model;
  };

  const rejectHome = (id: string, action: string) => {
    if (id === HOME_ID) throw new AppError("invalid_request", `The Home project cannot be ${action}.`);
  };

  const liveConversations = () => [...conversations.values()].filter((item) => !item.isDeleted);
  const byRecent = (a: { updatedAt: number }, b: { updatedAt: number }) => b.updatedAt - a.updatedAt;

  const validateInput = (input: FakeInput, model: ModelRef) => {
    const images = input.images ?? [];
    if (input.text.trim() === "" && images.length === 0) {
      throw new AppError("invalid_request", "The message is empty.");
    }
    if (images.length > 0 && !requireListedModel(model).images) {
      throw new AppError("images_not_supported", "This model does not accept images.");
    }
    for (const image of images) assertImageMatchesMimeType(image);
  };

  const generateTitle = (text: string): string | undefined => {
    const title = firstWords(text);
    return title === "" ? undefined : title;
  };

  const finishClone = (project: Project) => {
    clones.delete(project.id);
    if (cloneWouldFail(project.gitUrl ?? "")) {
      project.status = "failed";
      project.error = "fatal: repository not found";
    } else {
      project.status = "ready";
      delete project.error;
    }
    emit({ resource: "projects" });
  };

  const scheduleClone = (project: Project) => {
    clones.set(
      project.id,
      setTimeout(() => finishClone(project), cloneMs),
    );
  };

  async function startConversation(input: StartConversationInput) {
    const project = requireProject(input.projectId);
    if (project.status !== "ready") throw new AppError("project_not_ready", "This project is not ready.");
    requireProvider();
    const model = input.model ?? defaultModel;
    if (!model) throw new AppError("no_default_model", "No default model is set");
    const info = requireListedModel(model);
    const existing = startsByRequest.get(input.requestId);
    if (existing) return requireConversation(existing).summary();
    validateInput(input, model);
    const conversation = new FakeConversation({
      id: String(nextConversationId++),
      projectId: project.id,
      cwd: project.path,
      model: { provider: model.provider, modelId: model.modelId },
      thinkingLevel: clampFakeThinkingLevel(info, input.thinkingLevel ?? DEFAULT_THINKING_LEVEL),
      speed,
      now,
      onSummaryChange: (changedProjectId) => emit({ resource: "conversations", projectId: changedProjectId }),
      generateTitle,
    });
    conversations.set(conversation.id, conversation);
    startsByRequest.set(input.requestId, conversation.id);
    conversation.send(input.requestId, { text: input.text, images: input.images });
    return conversation.summary();
  }

  return {
    settings: {
      async get(): Promise<Settings> {
        return { defaultModel, fastModel, projectsFolder };
      },
      async setDefaultModel(ref) {
        requireProvider();
        requireListedModel(ref);
        defaultModel = { provider: ref.provider, modelId: ref.modelId };
      },
      async setFastModel(ref) {
        if (ref === null) {
          fastModel = null;
          return;
        }
        requireProvider();
        requireListedModel(ref);
        fastModel = { provider: ref.provider, modelId: ref.modelId };
      },
      async setProjectsFolder(path) {
        if (!path.startsWith("/")) throw new AppError("invalid_request", "The path must be absolute.");
        if (fs[normalizePath(path)] === "file")
          throw new AppError("not_a_directory", `Not a folder: ${path}`);
        projectsFolder = normalizePath(path);
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
        return FAKE_MODELS.map((model) => ({ ...model, thinkingLevels: [...model.thinkingLevels] }));
      },
    },
    projects: {
      async list() {
        return allProjects().map((project) => ({ ...project }));
      },
      async add({ path, name }) {
        const real = normalizePath(path) === home.path ? home.path : assertDirectory(fs, path);
        if (allProjects().some((project) => project.path === real)) {
          throw new AppError("duplicate_project", `Already added: ${real}`);
        }
        const project: Project = {
          id: `project-${nextProjectId++}`,
          name: name ?? baseName(real),
          path: real,
          createdAt: now(),
          kind: "folder",
          status: "ready",
        };
        projects.push(project);
        emit({ resource: "projects" });
        return { ...project };
      },
      async clone({ url, name }) {
        const normalized = normalizeGitUrl(url);
        if (projects.some((project) => project.gitUrl && normalizeGitUrl(project.gitUrl) === normalized)) {
          throw new AppError("duplicate_project", `Already added: ${url}`);
        }
        const taken = new Set(projects.map((project) => project.path));
        const base = `${projectsFolder}/${folderNameFor(url)}`;
        let path = base;
        for (let suffix = 2; taken.has(path); suffix++) path = `${base}-${suffix}`;
        const project: Project = {
          id: `project-${nextProjectId++}`,
          name: name ?? baseName(path),
          path,
          createdAt: now(),
          kind: "git",
          gitUrl: url,
          status: "cloning",
        };
        projects.push(project);
        scheduleClone(project);
        emit({ resource: "projects" });
        return { ...project };
      },
      async retryClone(id) {
        const project = requireProject(id);
        if (project.status !== "failed") throw new AppError("invalid_request", "This clone did not fail.");
        project.status = "cloning";
        delete project.error;
        scheduleClone(project);
        emit({ resource: "projects" });
      },
      async rename(id, name) {
        rejectHome(id, "renamed");
        requireProject(id).name = name;
        emit({ resource: "projects" });
      },
      async remove(id) {
        rejectHome(id, "removed");
        requireProject(id);
        clearTimeout(clones.get(id));
        clones.delete(id);
        for (const conversation of liveConversations()) {
          if (conversation.projectId !== id) continue;
          await conversation.abort();
          conversation.remove();
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
        return liveConversations()
          .filter((conversation) => conversation.projectId === projectId)
          .map((conversation) => conversation.summary())
          .sort(byRecent);
      },
      async listAll() {
        return liveConversations()
          .map((conversation) => conversation.summary())
          .sort(byRecent);
      },
      start: startConversation,
      async rename(id, title) {
        requireConversation(id).rename(title);
      },
      async send(id, input) {
        const conversation = requireConversation(id);
        validateInput(input, conversation.model);
        conversation.send(input.requestId, { text: input.text, images: input.images });
      },
      async abort(id) {
        await requireConversation(id).abort();
      },
      async archive(id, archived) {
        requireConversation(id).archive(archived);
      },
      async remove(id) {
        const conversation = conversations.get(id);
        if (!conversation) throw new AppError("not_found", `Unknown conversation: ${id}`);
        if (conversation.isDeleted) return;
        await conversation.abort();
        conversation.remove();
        emit({ resource: "conversations", projectId: conversation.projectId });
      },
      async configure(id, input) {
        const conversation = requireConversation(id);
        if (input.model === undefined && input.thinkingLevel === undefined) {
          throw new AppError("invalid_request", "Choose a model or a thinking level.");
        }
        const model = input.model ?? conversation.model;
        const info = requireListedModel(model);
        conversation.configure(
          model,
          clampFakeThinkingLevel(info, input.thinkingLevel ?? conversation.thinkingLevel()),
        );
      },
      async retry(id, input) {
        requireConversation(id).retry(input.requestId);
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
      for (const timer of clones.values()) clearTimeout(timer);
      clones.clear();
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
