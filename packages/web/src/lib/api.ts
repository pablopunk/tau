import type {
  ConfigureConversationInput,
  ConversationSummary,
  GithubRepo,
  GithubStatus,
  ModelInfo,
  ModelRef,
  PathSuggestion,
  Project,
  ProviderStatus,
  RetryInput,
  SendMessageInput,
  Settings,
  StartConversationInput,
  SuggestDirectoriesInput,
  SuggestedCodeFolder,
  UseGithubRepoInput,
} from "@pi-everywhere/protocol";
import { fillPath, routes } from "@pi-everywhere/protocol";
import { createHttpTransport } from "./transport/http";
import { createLazyTransport } from "./transport/lazy";
import type { LiveTransport, Transport } from "./transport/types";

export type { LiveHandlers, LiveSocket, LiveTransport, Transport } from "./transport/types";

/** The typed REST client. Every method rejects with `AppError` (see `@pi-everywhere/protocol`). */
export interface Api {
  fs: {
    suggestDirectories(input: SuggestDirectoriesInput): Promise<PathSuggestion[]>;
  };
  settings: {
    get(): Promise<Settings>;
    setDefaultModel(ref: ModelRef): Promise<void>;
    setFastModel(ref: ModelRef | null): Promise<void>;
    setProjectsFolder(path: string): Promise<void>;
    suggestedCodeFolder(): Promise<SuggestedCodeFolder>;
  };
  github: {
    status(): Promise<GithubStatus>;
    repos(): Promise<GithubRepo[]>;
    refreshRepos(): Promise<GithubRepo[]>;
    use(input: UseGithubRepoInput): Promise<Project>;
  };
  provider: {
    status(): Promise<ProviderStatus>;
    setKey(key: string): Promise<void>;
    models(): Promise<ModelInfo[]>;
  };
  projects: {
    list(): Promise<Project[]>;
    add(input: { path: string; name?: string }): Promise<Project>;
    clone(input: { url: string; name?: string }): Promise<Project>;
    retryClone(id: string): Promise<void>;
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
    remove(id: string): Promise<void>;
    configure(id: string, input: ConfigureConversationInput): Promise<void>;
    retry(id: string, input: RetryInput): Promise<void>;
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
      setProjectsFolder: (path) => request("setProjectsFolder", { body: { path } }),
      suggestedCodeFolder: () => request("getSuggestedCodeFolder", {}),
    },
    github: {
      status: () => request("getGithubStatus", {}),
      repos: () => request("listGithubRepos", {}),
      refreshRepos: () => request("refreshGithubRepos", {}),
      use: (input) => request("useGithubRepo", { body: input }),
    },
    provider: {
      status: () => request("getProvider", {}),
      setKey: (key) => request("setProviderKey", { body: { key } }),
      models: () => request("listModels", {}),
    },
    projects: {
      list: () => request("listProjects", {}),
      add: (input) => request("addProject", { body: input }),
      clone: (input) => request("cloneProject", { body: input }),
      retryClone: (id) => request("retryClone", { params: { id } }),
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
      remove: (id) => request("removeConversation", { params: { id } }),
      configure: (id, input) => request("configureConversation", { params: { id }, body: input }),
      retry: (id, input) => request("retryConversation", { params: { id }, body: input }),
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
