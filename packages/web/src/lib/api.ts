import type {
  Approval,
  ApprovalDecision,
  Checkpoint,
  ClaudeConnectorSettings,
  CompactInput,
  CompactionSettings,
  ConfigureConversationInput,
  ConversationSummary,
  DeleteArchivedInput,
  DeleteArchivedResult,
  Device,
  DirectoryNode,
  Expulsion,
  FileRef,
  FileSuggestion,
  GithubRepo,
  GithubStatus,
  Goal,
  LoginSession,
  LoopInput,
  McpServerConfig,
  McpServerStatus,
  MessageMode,
  MintedPairing,
  MintPairingInput,
  ModelInfo,
  ModelRef,
  Node,
  NodeSelf,
  NodeSummary,
  PathSuggestion,
  ProcessInfo,
  Project,
  ProviderId,
  ProviderInfo,
  RedeemPairingBody,
  RedeemPairingResponse,
  RemoteStatus,
  ResourceActivity,
  ResourceSettings,
  ResourceSupport,
  RestorePreview,
  RetryInput,
  SendMessageInput,
  Settings,
  Skill,
  StartConversationInput,
  SuggestDirectoriesInput,
  SuggestedCodeFolder,
  TerminalInfo,
  ThinkingLevel,
  Timer,
  TranscribeInput,
  UpdateStartBody,
  UpdateStatus,
  UpdateTodosInput,
  UseGithubRepoInput,
  VoiceModelSetting,
  VoiceOptions,
  WorkspaceDefault,
  WorkspaceStatus,
} from "@tau/protocol";
import {
  AppError,
  fillPath,
  isAppError,
  MAX_UPLOAD_FILE_BYTES,
  routes,
  terminalStreamPath,
} from "@tau/protocol";
import { createHttpTransport } from "./transport/http";
import { createLazyTransport } from "./transport/lazy";
import type {
  LiveTransport,
  RequestOptions,
  StreamHandlers,
  StreamSocket,
  Transport,
} from "./transport/types";
import { createWorkspaceStatusQueue } from "./workspace-status-queue";

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
    setWorkspaceDefault(mode: WorkspaceDefault): Promise<void>;
    setClaudeConnectors(value: ClaudeConnectorSettings): Promise<void>;
    setResources(value: ResourceSettings): Promise<void>;
    setCompaction(value: CompactionSettings): Promise<void>;
    /** `null`: this node is older than resource control (404), so the controls are not supported there. */
    resourceSupport(): Promise<ResourceSupport | null>;
    /** `null` on a node without resource control, as for `resourceSupport`. */
    resourceActivity(): Promise<ResourceActivity | null>;
    stopResourceCommand(entryId: string): Promise<void>;
    /** "Use my other nodes": skip first-run setup on this node (server-side, so a fresh browser keeps it). */
    setSetupSkipped(skipped: boolean): Promise<void>;
    suggestedCodeFolder(): Promise<SuggestedCodeFolder>;
    /** `null` is the browser fallback; the body goes in `--json` on the CLI. Never deletes bytes. */
    setVoiceModel(setting: VoiceModelSetting): Promise<void>;
  };
  voice: {
    /** `null`: this node predates voice support (404), so the row hides. */
    options(): Promise<VoiceOptions | null>;
    transcribe(input: TranscribeInput): Promise<{ text: string }>;
    removeModel(): Promise<void>;
    warm(): Promise<void>;
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
    acknowledgeClaudeCli(): Promise<ProviderInfo>;
    refreshClaudeCli(): Promise<ProviderInfo>;
    installClaudeCliSdk(): Promise<ProviderInfo>;
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
    setFolder(id: string, path: string): Promise<Project>;
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
    /** Replaces the thread's todo list with the user's edit and pings the agent with the diff. */
    updateTodos(id: string, input: UpdateTodosInput): Promise<void>;
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
    status(conversationId: string, options?: RequestOptions): Promise<WorkspaceStatus>;
    merge(conversationId: string): Promise<ConversationSummary>;
    createPullRequest(conversationId: string): Promise<ConversationSummary>;
    remove(conversationId: string, force?: boolean): Promise<ConversationSummary>;
  };
  processes: {
    list(conversationId: string): Promise<ProcessInfo[]>;
    logs(id: string, tail?: number): Promise<string>;
    stop(id: string): Promise<void>;
    background(conversationId: string, callId: string): Promise<ProcessInfo>;
    stopCall(conversationId: string, callId: string): Promise<void>;
  };
  approvals: {
    list(conversationId: string): Promise<Approval[]>;
    decide(conversationId: string, toolUseId: string, decision: ApprovalDecision): Promise<void>;
  };
  timers: {
    list(conversationId: string): Promise<Timer[]>;
    delete(id: string): Promise<void>;
    loop(conversationId: string, input: LoopInput): Promise<void>;
    stopLoop(conversationId: string): Promise<void>;
  };
  goals: {
    set(conversationId: string, condition: string): Promise<void>;
    get(conversationId: string): Promise<Goal | null>;
    clear(conversationId: string): Promise<void>;
  };
  mcp: {
    servers(projectId: string | null): Promise<McpServerStatus[]>;
    save(config: McpServerConfig): Promise<void>;
    remove(name: string): Promise<void>;
  };
  uploads: {
    /** Stages a file for a later message and returns its ref (a virtual path, never bytes). */
    stage(file: File): Promise<FileRef>;
  };
  remote: {
    status(): Promise<RemoteStatus>;
    enable(): Promise<RemoteStatus>;
    disable(): Promise<RemoteStatus>;
    recreate(): Promise<RemoteStatus>;
  };
  access: {
    devices(): Promise<Device[]>;
    renameDevice(id: string, name: string): Promise<void>;
    revokeDevice(id: string): Promise<void>;
    signOutAll(): Promise<void>;
    mintPairing(input: MintPairingInput): Promise<MintedPairing>;
    /** What the pair page does with `fetch`; here for the fake backend and tests (a real device redeems before it has a session). */
    redeemPairing(input: RedeemPairingBody): Promise<RedeemPairingResponse>;
  };
  updates: {
    /** This tau against the latest published version. `latest` is null until a check succeeds. */
    status(): Promise<UpdateStatus>;
    /** Checks the registry now (the server limits it to one per minute). */
    refresh(): Promise<UpdateStatus>;
    /** Owner only (`forbidden` otherwise). Starts the detached updater; `target` is the version the dialog showed. */
    start(body: UpdateStartBody): Promise<UpdateStatus>;
  };
  nodes: {
    /** The nodes linked to THIS tau (a hub). */
    list(): Promise<Node[]>;
    rename(id: string, name: string): Promise<void>;
    disconnect(id: string): Promise<void>;
    /** What the hub last saw of a node (titles and times); rejects `not_found` before the first one. */
    summary(id: string): Promise<NodeSummary>;
    /** Local only: revokes the node's device here and closes its links; no other node is told. */
    forget(id: string): Promise<void>;
    /** This tau itself: nodeId, name, os and versions. */
    self(): Promise<NodeSelf>;
    /** Deletes this node's key and links: a new nodeId. */
    resetIdentity(): Promise<void>;
    /** The group as this node sees it: neighbours, routed nodes and ghosts. */
    directory(): Promise<DirectoryNode[]>;
    /** Nodes removed from the group, with who removed them and who has not confirmed. */
    expulsions(): Promise<Expulsion[]>;
    /** Group-wide remove; `confirm` is the node's exact name or id. */
    remove(id: string, confirm: string): Promise<void>;
  };
  terminals: {
    available(): Promise<boolean>;
    list(conversationId: string): Promise<TerminalInfo[]>;
    open(conversationId: string, size: { cols: number; rows: number }): Promise<TerminalInfo>;
    close(id: string): Promise<void>;
    /** The binary stream of one terminal (raw output down, input bytes and resize frames up). */
    openStream(id: string, handlers: StreamHandlers): StreamSocket;
  };
  /** Raw frames of `/api/live`; `LiveClient` turns them into views. */
  live: LiveTransport;
}

const NOT_FOUND_ON_OLD_NODE = /\(404\)/;

/** An older node has no such route: the transport reports a plain 404 as `internal` "Request failed (404)". */
async function nullWhenMissing<T>(call: Promise<T>): Promise<T | null> {
  try {
    return await call;
  } catch (error) {
    if (isAppError(error) && (error.code === "not_found" || NOT_FOUND_ON_OLD_NODE.test(error.message))) {
      return null;
    }
    throw error;
  }
}

const toBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));

/** `File.arrayBuffer` to base64 in 32 KiB chunks, so a 5 MiB file never blows the argument limit. */
function fileToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 32 * 1024;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

const mib = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

/** An older node never heard of this route: the transport reports a plain 404 as `internal` "Request failed (404)". */
export function isUnknownRoute(error: unknown): boolean {
  return isAppError(error) && (error.code === "not_found" || NOT_FOUND_ON_OLD_NODE.test(error.message));
}

export function createApi(transport: Transport): Api {
  const { request } = transport;
  const readWorkspaceStatus = createWorkspaceStatusQueue();
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
      setClaudeConnectors: (value) => request("setClaudeConnectors", { body: value }),
      setSetupSkipped: (skipped) => request("setSetupSkipped", { body: { skipped } }),
      setResources: (value) => request("setResources", { body: value }),
      setCompaction: (value) => request("setCompaction", { body: value }),
      resourceSupport: () => nullWhenMissing(request("getResourceSupport", {})),
      resourceActivity: () => nullWhenMissing(request("getResourceActivity", {})),
      stopResourceCommand: (entryId) => request("stopResourceCommand", { params: { id: entryId } }),
      setVoiceModel: (setting) => request("setVoiceModel", { body: { setting } }),
    },
    voice: {
      options: () => nullWhenMissing(request("getVoiceOptions", {})),
      transcribe: (input) => request("transcribeVoice", { body: input }),
      removeModel: () => request("removeVoiceModel", {}),
      warm: () => request("warmVoice", {}),
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
      acknowledgeClaudeCli: () => request("acknowledgeClaudeCli", {}),
      refreshClaudeCli: () => request("refreshClaudeCli", {}),
      installClaudeCliSdk: () => request("installClaudeCliSdk", {}),
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
      setFolder: (id, path) => request("setProjectFolder", { params: { id }, body: { path } }),
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
      updateTodos: (id, input) => request("updateTodos", { params: { id }, body: input }),
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
      status: (id, options) =>
        readWorkspaceStatus(
          (signal) => request("getWorkspace", { params: { id } }, { signal }),
          options?.signal,
        ),
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
      background: (id, callId) => request("backgroundToolCall", { params: { id, callId } }),
      stopCall: (id, callId) => request("stopToolCall", { params: { id, callId } }),
    },
    approvals: {
      list: (id) => request("listApprovals", { params: { id } }),
      decide: (id, toolUseId, decision) =>
        request("decideApproval", { params: { id, toolUseId }, body: { decision } }),
    },
    timers: {
      list: (id) => request("listTimers", { params: { id } }),
      delete: (id) => request("deleteTimer", { params: { id } }),
      loop: (id, input) => request("startLoop", { params: { id }, body: input }),
      stopLoop: (id) => request("stopLoop", { params: { id } }),
    },
    goals: {
      set: (id, condition) => request("setGoal", { params: { id }, body: { condition } }),
      get: (id) => request("getGoal", { params: { id } }),
      clear: (id) => request("clearGoal", { params: { id } }),
    },
    mcp: {
      servers: (projectId) => request("listMcpServers", { query: projectId ? { projectId } : {} }),
      save: (config) => request("saveMcpServer", { params: { name: config.name }, body: config }),
      remove: (name) => request("removeMcpServer", { params: { name } }),
    },
    uploads: {
      stage: async (file) => {
        if (file.size > MAX_UPLOAD_FILE_BYTES) {
          throw new AppError(
            "too_large",
            `The file is ${mib(file.size)}; the limit is ${mib(MAX_UPLOAD_FILE_BYTES)}.`,
          );
        }
        return request("stageUpload", {
          body: {
            name: file.name || "file",
            mimeType: file.type || "application/octet-stream",
            data: fileToBase64(await file.arrayBuffer()),
          },
        });
      },
    },
    remote: {
      status: () => request("getRemoteStatus", {}),
      enable: () => request("enableRemote", {}),
      disable: () => request("disableRemote", {}),
      recreate: () => request("recreateRemote", {}),
    },
    access: {
      devices: () => request("listDevices", {}),
      renameDevice: (id, name) => request("renameDevice", { params: { id }, body: { name } }),
      revokeDevice: (id) => request("revokeDevice", { params: { id } }),
      signOutAll: () => request("signOutAllDevices", {}),
      mintPairing: (input) => request("mintPairing", { query: input }),
      redeemPairing: (input) => request("redeemPairing", { body: input }),
    },
    updates: {
      status: () => request("getUpdateStatus", {}),
      refresh: () => request("refreshUpdateStatus", {}),
      start: (body) => request("startUpdate", { body }),
    },
    nodes: {
      list: () => request("listNodes", {}),
      rename: (id, name) => request("renameNode", { params: { id }, body: { name } }),
      disconnect: (id) => request("disconnectNode", { params: { id } }),
      summary: (id) => request("getNodeSummary", { params: { id } }),
      forget: (id) => request("forgetNode", { params: { id } }),
      self: () => request("getNodeSelf", {}),
      resetIdentity: () => request("resetNodeIdentity", {}),
      directory: () => request("getNodeDirectory", {}),
      expulsions: () => request("listExpulsions", {}),
      remove: (id, confirm) => request("removeNode", { params: { id }, body: { confirm } }),
    },
    terminals: {
      available: async () => (await request("getTerminalsAvailable", {})).available,
      list: (id) => request("listTerminals", { params: { id } }),
      open: (id, size) => request("openTerminal", { params: { id }, body: size }),
      close: (id) => request("closeTerminal", { params: { id } }),
      openStream: (id, handlers) => transport.openStream(terminalStreamPath(id), handlers),
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
