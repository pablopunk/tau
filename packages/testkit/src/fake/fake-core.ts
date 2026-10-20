import {
  AppError,
  type Change,
  type CompactionSettings,
  CompactionSettingsSchema,
  type ConversationSummary,
  type Core,
  type MessageMode,
  type ModelRef,
  type NodeLinkDirection,
  type Project,
  type ProviderId,
  type Settings,
  type Skill,
  type StartConversationInput,
  type ThinkingLevel,
  type ThreadWorkspace,
  type WorkspaceDefault,
  type WorkspaceMode,
} from "@tau/protocol";
import { Value } from "typebox/value";
import { clampFakeThinkingLevel, FAKE_MODELS, findFakeModel } from "./catalog";
import { createFakeAccess } from "./fake-access";
import { createFakeConnectors, type FakeConnectors } from "./fake-connectors";
import { FakeConversation, type FakeInput } from "./fake-conversation";
import { createFakeDeleteArchived } from "./fake-delete-archived";
import { suggestFakeFiles } from "./fake-files";
import {
  assertDirectory,
  baseName,
  expandFakeHome,
  FAKE_FS,
  FAKE_HOME_PATH,
  type FakeFs,
  normalizePath,
} from "./fake-fs";
import { cloneWouldFail, folderNameFor, repositoryKeyOf } from "./fake-git";
import { createFakeGithub, type FakeGithubOptions } from "./fake-github";
import { createFakeIcons } from "./fake-icons";
import { assertImageMatchesMimeType } from "./fake-images";
import { createFakeMvp5 } from "./fake-mvp5";
import { createFakeMvp8 } from "./fake-mvp8";
import { createFakeNodes, FAKE_NODE_SEEDS, type FakeNodes } from "./fake-nodes";
import { createFakeProviders } from "./fake-providers";
import { createFakeRemote, type FakeRemote } from "./fake-remote";
import { createFakeResources, type FakeResources } from "./fake-resources";
import { suggestFakeDirectories } from "./fake-suggest";
import { createFakeTerminals } from "./fake-terminals";
import type { SpawnParams } from "./fake-thread-ops";
import { createFakeUpdates, type FakeUpdates, type FakeUpdatesOptions } from "./fake-updates";
import { linkFakeCores } from "./link-fake-cores";

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
  /** The GitHub account and repos. Default: connected as `demo` with three repos. */
  readonly github?: FakeGithubOptions;
  /** Skills `skills.list` answers with. Default: none. */
  readonly skills?: readonly Skill[];
  /** Whether terminals work. Default true. */
  readonly terminals?: boolean;
  /** Start with remote on. Default false. */
  readonly remote?: boolean;
  /** Start in a group with two linked nodes (`Homelab` online, `Work laptop` offline), each linked both ways. Default false. */
  readonly nodes?: boolean;
  /** How this fake names itself in `nodes.self()` (and to its peers). Default `Mac`, `darwin arm64`. */
  readonly nodeName?: string;
  readonly nodeOs?: string;
  /** This tau's version for `updates.status()`. Default `0.0.0`. */
  readonly currentVersion?: string;
  /** The latest version the registry answers, known from the start. Default none (unreachable). */
  readonly latestVersion?: string | null;
  /** The update fake: install plan, caller (`canUpdate`), failing job, running work (`update_busy`). */
  readonly updates?: Pick<FakeUpdatesOptions, "install" | "canUpdate" | "failUpdate" | "busy">;
}

export { FAKE_HOME_PATH };
export const FAKE_PROJECTS_FOLDER = `${FAKE_HOME_PATH}/.tau/projects`;
const HOME_ID = "home";
const FIRST_CONVERSATION_ID = 2;
const DEFAULT_CLONE_MS = 1200;
const DEFAULT_THINKING_LEVEL = "medium";
const TITLE_WORDS = 3;

const firstWords = (text: string) => text.trim().split(/\s+/).slice(0, TITLE_WORDS).join(" ");

export type FakeCore = Core & {
  readonly seedApproval: FakeConnectors["seedApproval"];
  /** Puts commands into `settings.resourceActivity()`. */
  readonly seedResourceActivity: FakeResources["seed"];
  /** Plays tunnel behaviour (`reconnecting`, errors) over the fake remote. */
  readonly remoteControl: Pick<FakeRemote, "push">;
  /** Plays link behaviour over the fake nodes registry; `attach` makes `peer` one of this fake's nodes (see `linkFakeCores`). */
  readonly nodesControl: Pick<
    FakeNodes,
    "setStatus" | "addDialledPeer" | "nodeId" | "selfSync" | "joinGroup"
  > & {
    attach(peer: FakeCore, direction: NodeLinkDirection): Promise<void>;
    /** Makes `peer` a routed node (hops away, handed over by `via`, which is already a direct peer): `/api/n/<id>/...` reaches it. */
    reach(peer: FakeCore, via: FakeCore, hops: number): Promise<void>;
  };
  /** Plays the registry: what the next `updates.refresh()` finds (`null`: unreachable). */
  readonly updatesControl: Pick<FakeUpdates, "setLatest" | "advance">;
  /**
   * The data of each linked node: `core.nodeCores.get(id)` is the fake tau that `/api/n/<id>/...` reaches.
   * Empty unless `nodes: true`; a node added by `core.nodes.register` has none.
   */
  readonly nodeCores: ReadonlyMap<string, FakeCore>;
};

export function createFakeCore(options: FakeCoreOptions = {}): FakeCore {
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
    isGitRepo: false,
  };
  const projects: Project[] = [];
  const clones = new Map<string, ReturnType<typeof setTimeout>>();
  const conversations = new Map<string, FakeConversation>();
  const icons = createFakeIcons();
  const startsByRequest = new Map<string, string>();
  let defaultModel: ModelRef | null = options.configured ? modelRef(0) : null;
  let defaultThinkingLevel: ThinkingLevel | null = null;
  let fastModel: ModelRef | null = null;
  let fastThinkingLevel: ThinkingLevel | null = null;
  const clampFor = (ref: ModelRef, level: ThinkingLevel | null) => {
    const info = findFakeModel(ref);
    return level && info ? clampFakeThinkingLevel(info, level) : level;
  };
  let messageMode: MessageMode = "steer";
  let workspaceDefault: WorkspaceDefault = "per-project";
  let compaction: CompactionSettings = { mode: "summary", backend: "auto" };
  let setupSkipped = false;
  const lastWorkspaceModes = new Map<string, WorkspaceMode>();
  let projectsFolder = FAKE_PROJECTS_FOLDER;
  let nextProjectId = 1;
  let nextConversationId = FIRST_CONVERSATION_ID;

  const emit = (change: Change) => {
    for (const listener of [...listeners]) listener(change);
  };
  const connections = createFakeProviders({ emit, connectOpenRouter: options.configured ?? false });

  const allProjects = () => [home, ...projects];
  const present = (project: Project): Project => ({
    ...project,
    ...(lastWorkspaceModes.has(project.id) && { lastWorkspaceMode: lastWorkspaceModes.get(project.id) }),
    iconUrl: project.id === HOME_ID ? null : icons.iconUrl(project.id),
  });

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
    if (!connections.isConnected()) throw new AppError("no_provider", "No API key is configured");
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

  const resolveFolder = (path: string) =>
    normalizePath(expandFakeHome(path)) === home.path ? home.path : assertDirectory(fs, path);

  const addFolderProject = (input: { path: string; name?: string; gitUrl?: string }): Project => {
    const real = normalizePath(input.path);
    const key = input.gitUrl && repositoryKeyOf(input.gitUrl);
    const taken = allProjects().some(
      (project) =>
        project.path === real || (key && project.gitUrl && repositoryKeyOf(project.gitUrl) === key),
    );
    if (taken) throw new AppError("duplicate_project", `Already added: ${real}`);
    const project: Project = {
      id: `project-${nextProjectId++}`,
      name: input.name ?? baseName(real),
      path: real,
      createdAt: now(),
      kind: "folder",
      status: "ready",
      isGitRepo: true,
      ...(input.gitUrl ? { gitUrl: input.gitUrl } : {}),
    };
    projects.push(project);
    emit({ resource: "projects" });
    return present(project);
  };

  const cloneProject = ({ url, name }: { url: string; name?: string }): Project => {
    const key = repositoryKeyOf(url);
    if (projects.some((project) => project.gitUrl && repositoryKeyOf(project.gitUrl) === key)) {
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
      isGitRepo: true,
    };
    projects.push(project);
    scheduleClone(project);
    emit({ resource: "projects" });
    return present(project);
  };

  const remoteHub = createFakeGithub({
    options: options.github ?? {},
    now,
    fs,
    projects: () => allProjects(),
    addFolderProject,
    cloneProject,
  });

  const mvp5 = createFakeMvp5({
    emit,
    now,
    requireConversation,
    liveConversations,
    requireProject,
    spawn,
    githubConnected: async () => (await remoteHub.status()).state === "connected",
  });

  const terminals = createFakeTerminals({
    emit,
    now,
    available: options.terminals ?? true,
    requireConversation,
  });
  const mvp8 = createFakeMvp8({ emit, now, requireConversation });
  const connectors = createFakeConnectors({ emit, now, requireConversation });
  const resources = createFakeResources({ emit });

  function workspaceModeFor(projectId: string, requested: WorkspaceMode | undefined): WorkspaceMode {
    if (requested) {
      lastWorkspaceModes.set(projectId, requested);
      return requested;
    }
    if (workspaceDefault !== "per-project") return workspaceDefault;
    return lastWorkspaceModes.get(projectId) ?? "worktree";
  }

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
    const conversation = createConversation({
      projectId: project.id,
      workspace: mvp5.workspaceFor(project, workspaceModeFor(project.id, input.workspace), input.text),
      model: { provider: model.provider, modelId: model.modelId },
      thinkingLevel: clampFakeThinkingLevel(
        info,
        input.thinkingLevel ?? defaultThinkingLevel ?? DEFAULT_THINKING_LEVEL,
      ),
    });
    startsByRequest.set(input.requestId, conversation.id);
    conversation.send(input.requestId, { text: input.text, images: input.images });
    mvp5.afterMessage(conversation, input.text);
    return conversation.summary();
  }

  function createConversation(params: {
    projectId: string;
    workspace: ThreadWorkspace;
    model: ModelRef;
    thinkingLevel: ThinkingLevel;
    parentId?: string;
    forkOf?: ConversationSummary["forkOf"];
  }): FakeConversation {
    const conversation = new FakeConversation({
      ...params,
      id: String(nextConversationId++),
      cwd: params.workspace.path,
      speed,
      now,
      onSummaryChange: (changedProjectId) => emit({ resource: "conversations", projectId: changedProjectId }),
      summaryExtras: (id) => mvp8.extras(id),
      generateTitle,
    });
    conversations.set(conversation.id, conversation);
    return conversation;
  }

  function spawn({ source, title, forkOf, parentId }: SpawnParams): FakeConversation {
    const conversation = createConversation({
      projectId: source.projectId,
      workspace: { ...source.workspace },
      model: source.model,
      thinkingLevel: source.thinkingLevel(),
      parentId,
      forkOf,
    });
    conversation.rename(title);
    return conversation;
  }

  const removeConversation = async (conversation: FakeConversation) => {
    for (const child of mvp5.childrenOf(conversation)) await removeConversation(child);
    terminals.closeAllOf(conversation.id);
    await conversation.abort();
    mvp5.release(conversation);
    mvp8.release(conversation.id);
    conversation.remove();
  };

  const access = createFakeAccess({
    now,
    emit,
    remoteUrl: () => remote.status().url,
    nodeId: () => nodes.nodeId(),
  });
  const remote = createFakeRemote({ now, emit, access, enabled: options.remote });

  const nodes = createFakeNodes({
    now,
    emit,
    access,
    self: { name: options.nodeName, os: options.nodeOs },
  });
  const updates = createFakeUpdates({
    now,
    currentVersion: options.currentVersion,
    latest: options.latestVersion,
    ...options.updates,
  });
  const nodeCores = new Map<string, FakeCore>();

  /** Everything happens before the first `await`, so a caller that does not wait still sees the link. */
  async function attach(peer: FakeCore, direction: NodeLinkDirection): Promise<void> {
    const self = peer.nodesControl.selfSync();
    nodeCores.set(self.nodeId, peer);
    if (direction === "accepted") access.addNodeDevice(self.name, self.nodeId);
    await nodes.api.register(self.nodeId, { ...self, capabilities: [] }, direction);
  }
  async function reach(peer: FakeCore, via: FakeCore, hops: number): Promise<void> {
    const self = peer.nodesControl.selfSync();
    nodeCores.set(self.nodeId, peer);
    nodes.addRouted(
      {
        ...self,
        id: self.nodeId,
        identified: true,
        status: "online",
        lastSeenAt: now(),
        threadCount: 0,
        links: [],
      },
      via.nodesControl.nodeId(),
      hops,
    );
  }
  const control = {
    joinGroup: nodes.joinGroup,
    reach,
    setStatus: nodes.setStatus,
    addDialledPeer: nodes.addDialledPeer,
    nodeId: nodes.nodeId,
    selfSync: nodes.selfSync,
    attach,
  };

  function seedNodes(core: FakeCore) {
    for (const seed of FAKE_NODE_SEEDS) {
      const peer = createFakeCore({
        configured: true,
        now,
        speed,
        terminals: options.terminals,
        nodeName: seed.name,
        nodeOs: seed.os,
      });
      void linkFakeCores(peer, core);
      const peerId = peer.nodesControl.nodeId();
      nodes.api.heartbeat(peerId, seed.threadCount);
      if (seed.status === "offline") nodes.api.markOffline(peerId);
    }
  }

  const core: FakeCore = {
    access,
    nodes: nodes.api,
    nodesControl: control,
    updates: updates.api,
    updatesControl: updates,
    nodeCores,
    remote: remote.api,
    remoteControl: remote,
    fs: {
      async suggestDirectories(input) {
        return suggestFakeDirectories(fs, input);
      },
    },
    settings: {
      async suggestedCodeFolder() {
        return null;
      },
      async get(): Promise<Settings> {
        return {
          defaultModel,
          defaultThinkingLevel,
          fastModel,
          fastThinkingLevel,
          projectsFolder,
          messageMode,
          workspaceDefault,
          claudeCliNoticeAt: connections.claudeCliNoticeAt(),
          claudeConnectors: connectors.settings(),
          remote: { enabled: remote.status().state !== "off" },
          resources: resources.settings(),
          compaction: { ...compaction },
          setupSkipped,
        };
      },
      ...resources.api,
      async setSetupSkipped(skipped) {
        setupSkipped = skipped;
      },
      async setDefaultModel(ref) {
        requireProvider();
        requireListedModel(ref);
        defaultModel = { provider: ref.provider, modelId: ref.modelId };
        defaultThinkingLevel = clampFor(ref, defaultThinkingLevel);
      },
      async setDefaultThinkingLevel(level) {
        if (!defaultModel) throw new AppError("no_default_model", "Choose a default model first.");
        defaultThinkingLevel = clampFor(defaultModel, level);
      },
      async setFastThinkingLevel(level) {
        if (!fastModel) throw new AppError("invalid_request", "Choose a fast model first.");
        fastThinkingLevel = clampFor(fastModel, level);
      },
      async setFastModel(ref) {
        if (ref === null) {
          fastModel = null;
          fastThinkingLevel = null;
          return;
        }
        requireProvider();
        requireListedModel(ref);
        fastModel = { provider: ref.provider, modelId: ref.modelId };
        fastThinkingLevel = clampFor(ref, fastThinkingLevel);
      },
      async setMessageMode(mode) {
        messageMode = mode;
      },
      async setWorkspaceDefault(mode) {
        workspaceDefault = mode;
      },
      async setClaudeConnectors(value) {
        connectors.setSettings(value);
      },
      async setCompaction(value: CompactionSettings) {
        if (!Value.Check(CompactionSettingsSchema, value)) {
          throw new AppError("invalid_request", "Compaction mode must be summary or fast.");
        }
        if (value.mode === "fast") {
          const wanted: readonly ProviderId[] =
            value.backend === "auto" ? ["typesafe", "openai"] : [value.backend];
          const connected = new Set(
            (await connections.providers.list())
              .filter((info) => info.connection !== null)
              .map((info) => info.id),
          );
          if (!wanted.some((id) => connected.has(id))) {
            throw new AppError(
              "invalid_request",
              "Connect TypeSafe, or OpenAI with decisions access, to enable fast compaction.",
            );
          }
        }
        compaction = { ...value };
      },
      async setProjectsFolder(typedPath) {
        const path = expandFakeHome(typedPath);
        if (!path.startsWith("/")) throw new AppError("invalid_request", "The path must be absolute.");
        if (fs[normalizePath(path)] === "file")
          throw new AppError("not_a_directory", `Not a folder: ${path}`);
        projectsFolder = normalizePath(path);
      },
    },
    providers: connections.providers,
    models: connections.models,
    skills: {
      async list(projectId) {
        if (projectId !== null) requireProject(projectId);
        return (options.skills ?? []).map((skill) => ({ ...skill }));
      },
    },
    github: remoteHub,
    projects: {
      async list() {
        return allProjects().map(present);
      },
      async add({ path, name }) {
        return addFolderProject({ path: resolveFolder(path), name });
      },
      async clone({ url, name }) {
        return cloneProject({ url, name });
      },
      async retryClone(id) {
        const project = requireProject(id);
        if (project.status !== "failed") throw new AppError("invalid_request", "This clone did not fail.");
        project.status = "cloning";
        delete project.error;
        scheduleClone(project);
        emit({ resource: "projects" });
      },
      async setFolder(id, path) {
        const project = requireProject(id);
        if (project.id === HOME_ID) throw new AppError("invalid_request", "Home cannot change folder.");
        project.path = resolveFolder(path);
        emit({ resource: "projects" });
        emit({ resource: "conversations", projectId: id });
        return present(project);
      },
      async icon(id) {
        requireProject(id);
        return icons.icon(id);
      },
      async iconCandidates(id) {
        requireProject(id);
        return [];
      },
      async iconCandidate(id) {
        requireProject(id);
        throw new AppError("not_found", "This image is not available.");
      },
      async suggestFiles(id, query) {
        return suggestFakeFiles(fs, requireProject(id).path, query);
      },
      async setIcon(id, png) {
        requireProject(id);
        rejectHome(id, "given a custom icon");
        icons.set(id, png);
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
          await removeConversation(conversation);
        }
        projects.splice(
          projects.findIndex((project) => project.id === id),
          1,
        );
        icons.forget(id);
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
        const whenBusy = input.whenBusy ?? (messageMode === "queue" ? "followUp" : "steer");
        conversation.send(input.requestId, { text: input.text, images: input.images }, whenBusy);
        mvp5.afterMessage(conversation, input.text);
      },
      async abort(id) {
        await requireConversation(id).abort();
      },
      async archive(id, archived) {
        const conversation = requireConversation(id);
        if (archived) terminals.closeAllOf(id);
        conversation.archive(archived);
        for (const child of mvp5.childrenOf(conversation)) {
          if (archived) terminals.closeAllOf(child.id);
          child.archive(archived);
        }
      },
      async remove(id, options) {
        const conversation = conversations.get(id);
        if (!conversation) throw new AppError("not_found", `Unknown conversation: ${id}`);
        if (conversation.isDeleted) return;
        mvp5.guardRemoval(conversation, options?.force === true);
        await removeConversation(conversation);
        emit({ resource: "conversations", projectId: conversation.projectId });
      },
      deleteArchived: createFakeDeleteArchived({
        live: liveConversations,
        remove: removeConversation,
        announce: (conversation) => emit({ resource: "conversations", projectId: conversation.projectId }),
      }),
      ...mvp5.threadOps,
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
      async compact(id) {
        if (!requireConversation(id).hasHistoryToCompact()) {
          throw new AppError("nothing_to_compact", "There is nothing to compact yet.");
        }
      },
      async watch(id, onOps) {
        return requireConversation(id).watch(onOps);
      },
    },
    workspaces: mvp5.workspaces,
    processes: mvp5.processes,
    terminals: terminals.api,
    approvals: connectors.approvals,
    seedApproval: connectors.seedApproval,
    seedResourceActivity: resources.seed,
    timers: mvp8.timers,
    goals: mvp8.goals,
    mcp: mvp5.mcp,
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
  if (options.nodes) seedNodes(core);
  return core;
}

function modelRef(index: number): ModelRef {
  const model = FAKE_MODELS[index];
  if (!model) throw new Error("FAKE_MODELS is empty");
  return { provider: model.provider, modelId: model.modelId };
}
