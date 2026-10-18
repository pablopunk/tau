import type {
  Checkpoint,
  CompactInput,
  ConfigureConversationInput,
  ConversationSummary,
  DeleteArchivedInput,
  DeleteArchivedResult,
  FileSuggestion,
  GithubRepo,
  GithubStatus,
  LoginSession,
  McpServerConfig,
  McpServerStatus,
  MessageMode,
  ModelInfo,
  ModelRef,
  PathSuggestion,
  ProcessInfo,
  Project,
  ProviderId,
  ProviderInfo,
  RestorePreview,
  RetryInput,
  SendMessageInput,
  Settings,
  Skill,
  StartConversationInput,
  SuggestDirectoriesInput,
  SuggestedCodeFolder,
  ThinkingLevel,
  UseGithubRepoInput,
  WorkspaceMode,
  WorkspaceStatus,
} from "@tau/protocol";
import { fillPath, routes } from "@tau/protocol";
import { createHttpTransport } from "./transport/http";
import { createLazyTransport } from "./transport/lazy";
import type { LiveTransport, Transport } from "./transport/types";

export type { LiveHandlers, LiveSocket, LiveTransport, Transport } from "./transport/types";

export const isConnected = (provider: ProviderInfo): boolean => provider.connection !== null;

/** The typed REST client. Every method rejects with `AppError` (see `@tau/protocol`). */
export interface Api {
  fs: {
    suggestDirectories(input: SuggestDirectoriesInput): Promise<PathSuggestion[]>;
  };
  settings: {
    get(): Promise<Settings>;
    setDefaultModel(ref: ModelRef): Promise<void>;
    setFastModel(ref: ModelRef | null): Promise<void>;
    setDefaultThinkingLevel(level: ThinkingLevel | null): Promise<void>;
    setFastThinkingLevel(level: ThinkingLevel | null): Promise<void>;
    setProjectsFolder(path: string): Promise<void>;
    setMessageMode(mode: MessageMode): Promise<void>;
    setWorkspaceDefault(mode: WorkspaceMode): Promise<void>;
    suggestedCodeFolder(): Promise<SuggestedCodeFolder>;
  };
  github: {
    status(): Promise<GithubStatus>;
    repos(): Promise<GithubRepo[]>;
    refreshRepos(): Promise<GithubRepo[]>;
    use(input: UseGithubRepoInput): Promise<Project>;
  };
  providers: {
    list(): Promise<ProviderInfo[]>;
    setKey(id: ProviderId, key: string): Promise<ProviderInfo>;
    disconnect(id: ProviderId): Promise<ProviderInfo>;
  };
  logins: {
    start(): Promise<LoginSession>;
    get(sessionId: string): Promise<LoginSession>;
    submitUrl(sessionId: string, url: string): Promise<LoginSession>;
    cancel(sessionId: string): Promise<void>;
  };
  models: {
    list(): Promise<ModelInfo[]>;
  };
  skills: {
    list(projectId: string | null): Promise<Skill[]>;
  };
  projects: {
    list(): Promise<Project[]>;
    add(input: { path: string; name?: string }): Promise<Project>;
    clone(input: { url: string; name?: string }): Promise<Project>;
    retryClone(id: string): Promise<void>;
    suggestFiles(id: string, query: string): Promise<FileSuggestion[]>;
    rename(id: string, name: string): Promise<void>;
    remove(id: string): Promise<void>;
    /** Image sources for `<img src>`; the session cookie authenticates them. */
    iconUrl(id: string): string;
    iconCandidates(id: string): Promise<{ name: string; url: string }[]>;
    /** `png` is a 128x128 PNG. */
    setIcon(id: string, png: Uint8Array): Promise<void>;
    resetIcon(id: string): Promise<void>;
  };
  conversations: {
    list(projectId: string): Promise<ConversationSummary[]>;
    listAll(): Promise<ConversationSummary[]>;
    start(input: StartConversationInput): Promise<ConversationSummary>;
    rename(id: string, title: string): Promise<void>;
    send(id: string, input: SendMessageInput): Promise<void>;
    abort(id: string): Promise<void>;
    archive(id: string, archived: boolean): Promise<void>;
    remove(id: string, options?: { force?: boolean }): Promise<void>;
    deleteArchived(input: DeleteArchivedInput): Promise<DeleteArchivedResult>;
    fork(id: string, entryId: string): Promise<ConversationSummary>;
    rewindPreview(id: string, entryId: string): Promise<RestorePreview>;
    rewind(id: string, entryId: string): Promise<{ conversation: ConversationSummary; draft: string }>;
    stopAgent(id: string): Promise<void>;
    cancelQueued(id: string, itemId: string): Promise<{ cancelled: boolean }>;
    checkpoints(id: string): Promise<Checkpoint[]>;
    checkpointDiff(id: string, checkpointId: string, path: string): Promise<string>;
    configure(id: string, input: ConfigureConversationInput): Promise<void>;
    retry(id: string, input: RetryInput): Promise<void>;
    compact(id: string, input: CompactInput): Promise<void>;
  };
  workspaces: {
    status(conversationId: string): Promise<WorkspaceStatus>;
    merge(conversationId: string): Promise<ConversationSummary>;
    createPullRequest(conversationId: string): Promise<ConversationSummary>;
    remove(conversationId: string, force?: boolean): Promise<ConversationSummary>;
  };
  processes: {
    list(conversationId: string): Promise<ProcessInfo[]>;
    logs(id: string, tail?: number): Promise<string>;
    stop(id: string): Promise<void>;
  };
  mcp: {
    servers(projectId: string | null): Promise<McpServerStatus[]>;
    save(config: McpServerConfig): Promise<void>;
    remove(name: string): Promise<void>;
  };
  /** Raw frames of `/api/live`; `LiveClient` turns them into views. */
  live: LiveTransport;
}

const toBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));

export function createApi(transport: Transport): Api {
  const { request } = transport;
  return {
    fs: {
      suggestDirectories: (input) => request("suggestDirectories", { body: input }),
    },
    settings: {
      get: () => request("getSettings", {}),
      setDefaultModel: (ref) => request("setDefaultModel", { body: ref }),
      setFastModel: (ref) => request("setFastModel", { body: { model: ref } }),
      setDefaultThinkingLevel: (level) => request("setDefaultThinking", { body: { thinkingLevel: level } }),
      setFastThinkingLevel: (level) => request("setFastThinking", { body: { thinkingLevel: level } }),
      setProjectsFolder: (path) => request("setProjectsFolder", { body: { path } }),
      suggestedCodeFolder: () => request("getSuggestedCodeFolder", {}),
      setMessageMode: (mode) => request("setMessageMode", { body: { mode } }),
      setWorkspaceDefault: (mode) => request("setWorkspaceDefault", { body: { mode } }),
    },
    github: {
      status: () => request("getGithubStatus", {}),
      repos: () => request("listGithubRepos", {}),
      refreshRepos: () => request("refreshGithubRepos", {}),
      use: (input) => request("useGithubRepo", { body: input }),
    },
    providers: {
      list: () => request("listProviders", {}),
      setKey: (id, key) => request("setProviderKey", { params: { id }, body: { key } }),
      disconnect: (id) => request("disconnectProvider", { params: { id } }),
    },
    logins: {
      start: () => request("startLogin", { params: { id: "openai" } }),
      get: (sid) => request("getLogin", { params: { sid } }),
      submitUrl: (sid, url) => request("submitLoginUrl", { params: { sid }, body: { url } }),
      cancel: (sid) => request("cancelLogin", { params: { sid } }),
    },
    models: {
      list: () => request("listModels", {}),
    },
    skills: {
      list: (projectId) => request("listSkills", { query: projectId ? { projectId } : {} }),
    },
    projects: {
      list: () => request("listProjects", {}),
      add: (input) => request("addProject", { body: input }),
      clone: (input) => request("cloneProject", { body: input }),
      retryClone: (id) => request("retryClone", { params: { id } }),
      suggestFiles: (id, query) => request("suggestProjectFiles", { params: { id }, body: { query } }),
      rename: (id, name) => request("renameProject", { params: { id }, body: { name } }),
      remove: (id) => request("removeProject", { params: { id } }),
      iconUrl: (id) => fillPath(routes.getProjectIcon.path, { id }),
      iconCandidates: (id) => request("listIconCandidates", { params: { id } }),
      setIcon: (id, png) => request("setProjectIcon", { params: { id }, body: { png: toBase64(png) } }),
      resetIcon: (id) => request("resetProjectIcon", { params: { id } }),
    },
    conversations: {
      list: (projectId) => request("listConversations", { params: { id: projectId } }),
      listAll: () => request("listAllConversations", {}),
      start: (input) => request("startConversation", { body: input }),
      rename: (id, title) => request("renameConversation", { params: { id }, body: { title } }),
      send: (id, input) => request("sendMessage", { params: { id }, body: input }),
      abort: (id) => request("abortConversation", { params: { id } }),
      archive: (id, archived) => request("archiveConversation", { params: { id }, body: { archived } }),
      remove: (id, options) =>
        request("removeConversation", { params: { id }, query: options?.force ? { force: "true" } : {} }),
      deleteArchived: (input) => request("deleteArchivedConversations", { body: input }),
      fork: (id, entryId) => request("forkConversation", { params: { id }, body: { entryId } }),
      rewindPreview: (id, entryId) => request("rewindPreview", { params: { id }, body: { entryId } }),
      rewind: (id, entryId) => request("rewindConversation", { params: { id }, body: { entryId } }),
      stopAgent: (id) => request("stopAgent", { params: { id } }),
      cancelQueued: (id, itemId) => request("cancelQueued", { params: { id, itemId } }),
      checkpoints: (id) => request("listCheckpoints", { params: { id } }),
      checkpointDiff: async (id, cid, path) =>
        (await request("getCheckpointDiff", { params: { id, cid }, query: { path } })).diff,
      configure: (id, input) => request("configureConversation", { params: { id }, body: input }),
      retry: (id, input) => request("retryConversation", { params: { id }, body: input }),
      compact: (id, input) => request("compactConversation", { params: { id }, body: input }),
    },
    workspaces: {
      status: (id) => request("getWorkspace", { params: { id } }),
      merge: (id) => request("mergeWorkspace", { params: { id } }),
      createPullRequest: (id) => request("createPullRequest", { params: { id } }),
      remove: (id, force = false) =>
        request("removeWorkspace", { params: { id }, query: { force: force ? "true" : "false" } }),
    },
    processes: {
      list: (id) => request("listProcesses", { params: { id } }),
      logs: async (id, tail) =>
        (await request("getProcessLogs", { params: { id }, query: tail ? { tail: String(tail) } : {} })).logs,
      stop: (id) => request("stopProcess", { params: { id } }),
    },
    mcp: {
      servers: (projectId) => request("listMcpServers", { query: projectId ? { projectId } : {} }),
      save: (config) => request("saveMcpServer", { params: { name: config.name }, body: config }),
      remove: (name) => request("removeMcpServer", { params: { name } }),
    },
    live: transport.live,
  };
}

function loadFakeTransport(): Promise<Transport> {
  return import("./transport/fake").then((module) => module.createDefaultFakeTransport());
}

export function createDefaultTransport(): Transport {
  return import.meta.env.VITE_FAKE ? createLazyTransport(loadFakeTransport) : createHttpTransport();
}

/** The app's client: real over HTTP + WebSocket, or the in-browser fake when built with `VITE_FAKE=1`. */
export const api: Api = createApi(createDefaultTransport());
