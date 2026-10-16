import type {
  ConversationSummary,
  ModelInfo,
  ModelRef,
  Project,
  ProviderStatus,
  SendMessageInput,
  Settings,
} from "@pi-everywhere/protocol";
import { createHttpTransport } from "./transport/http";
import { createLazyTransport } from "./transport/lazy";
import type { LiveTransport, Transport } from "./transport/types";

export type { LiveHandlers, LiveSocket, LiveTransport, Transport } from "./transport/types";

/** The typed REST client. Every method rejects with `AppError` (see `@pi-everywhere/protocol`). */
export interface Api {
  settings: {
    get(): Promise<Settings>;
    setDefaultModel(ref: ModelRef): Promise<void>;
  };
  provider: {
    status(): Promise<ProviderStatus>;
    setKey(key: string): Promise<void>;
    models(): Promise<ModelInfo[]>;
  };
  projects: {
    list(): Promise<Project[]>;
    add(input: { path: string; name?: string }): Promise<Project>;
    rename(id: string, name: string): Promise<void>;
    remove(id: string): Promise<void>;
  };
  conversations: {
    list(projectId: string): Promise<ConversationSummary[]>;
    create(projectId: string): Promise<ConversationSummary>;
    rename(id: string, title: string): Promise<void>;
    send(id: string, input: SendMessageInput): Promise<void>;
    abort(id: string): Promise<void>;
  };
  /** Raw frames of `/api/live`; `LiveClient` turns them into views. */
  live: LiveTransport;
}

export function createApi(transport: Transport): Api {
  const { request } = transport;
  return {
    settings: {
      get: () => request("getSettings", {}),
      setDefaultModel: (ref) => request("setDefaultModel", { body: ref }),
    },
    provider: {
      status: () => request("getProvider", {}),
      setKey: (key) => request("setProviderKey", { body: { key } }),
      models: () => request("listModels", {}),
    },
    projects: {
      list: () => request("listProjects", {}),
      add: (input) => request("addProject", { body: input }),
      rename: (id, name) => request("renameProject", { params: { id }, body: { name } }),
      remove: (id) => request("removeProject", { params: { id } }),
    },
    conversations: {
      list: (projectId) => request("listConversations", { params: { id: projectId } }),
      create: (projectId) => request("createConversation", { params: { id: projectId } }),
      rename: (id, title) => request("renameConversation", { params: { id }, body: { title } }),
      send: (id, input) => request("sendMessage", { params: { id }, body: input }),
      abort: (id) => request("abortConversation", { params: { id } }),
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
