import type { Device, MintedPairing, MintPairingInput, RedeemedPairing, RedeemPairingInput } from "./access";
import type { DeleteArchivedInput, DeleteArchivedResult } from "./archived";
import type {
  Change,
  ClaudeConnectorSettings,
  CompactInput,
  ConfigureConversationInput,
  ConversationSummary,
  FileSuggestion,
  GithubRepo,
  GithubStatus,
  IconCandidate,
  LoginSession,
  MessageMode,
  ModelInfo,
  ModelRef,
  PathSuggestion,
  Project,
  ProjectIconImage,
  ProviderId,
  ProviderInfo,
  RetryInput,
  SendMessageInput,
  Settings,
  Skill,
  StartConversationInput,
  SuggestDirectoriesInput,
  SuggestedCodeFolder,
  ThinkingLevel,
  UseGithubRepoInput,
  WorkspaceDefault,
} from "./entities";
import type {
  Checkpoint,
  McpServerConfig,
  McpServerStatus,
  ProcessInfo,
  RestorePreview,
  WorkspaceStatus,
} from "./mvp5";
import type { Goal, LoopInput, Timer } from "./mvp8";
import type { Approval, ApprovalDecision } from "./mvp10";
import type { Node, NodeLinkDirection, NodeLinkReport, NodePeerInfo, NodeSelf, NodeSummary } from "./nodes";
import type { RemoteStatus } from "./remote";
import type { OpenTerminalInput, TerminalInfo } from "./terminals";
import type { UpdateStatus } from "./updates";
import type { Op } from "./view";

export type {
  Change,
  CompactInput,
  ConfigureConversationInput,
  ConversationSummary,
  FileSuggestion,
  GithubRepo,
  GithubStatus,
  IconCandidate,
  LoginSession,
  ModelInfo,
  ModelRef,
  PathSuggestion,
  Project,
  ProjectIconImage,
  ProviderId,
  ProviderInfo,
  RetryInput,
  SendMessageInput,
  Settings,
  Skill,
  StartConversationInput,
  SuggestDirectoriesInput,
  SuggestedCodeFolder,
  UseGithubRepoInput,
  WorkspaceDefault,
  WorkspaceMode,
} from "./entities";

export interface TerminalHandlers {
  /** Raw output bytes: replay first, then live. */
  onData(data: Uint8Array): void;
  onExit(exitCode: number | null): void;
}

export interface TerminalAttachment {
  readonly status: TerminalInfo["status"];
  readonly exitCode: number | null;
  write(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  detach(): void;
}

export type OpsListener = (ops: readonly Op[]) => Promise<void>;

export interface ConversationWatcher {
  stop(): Promise<void>;
}

/**
 * The application core. Every method rejects with `AppError` (see `errors.ts`) for expected failures; anything else
 * is an internal error. The server only depends on this interface, and `createCore` (packages/core) implements it.
 * Ids (projects, conversations) are opaque strings.
 * `ProviderInfo.id` is our provider id; `ModelRef.provider` is the model's own pi provider id (`faux` in faux mode).
 */
export interface Core {
  fs: {
    /** Folders matching a typed path, `~` allowed; relative or empty prefixes suggest from the home folder. Never rejects: unreadable or missing folders give `[]`. */
    suggestDirectories(input: SuggestDirectoriesInput): Promise<PathSuggestion[]>;
  };
  settings: {
    get(): Promise<Settings>;
    /** Only affects conversations created afterwards. Rejects `no_provider` without a key, `invalid_request` for a model the provider does not list. */
    setDefaultModel(ref: ModelRef): Promise<void>;
    /** `null` means "same as the thread". Rejects `invalid_request` for a model the provider does not list. */
    setFastModel(ref: ModelRef | null): Promise<void>;
    /** `null` means the model's own default. Clamped to the default model; rejects `no_default_model` without one. */
    setDefaultThinkingLevel(level: ThinkingLevel | null): Promise<void>;
    /** `null` means the model's own default. Clamped to the fast model; rejects `invalid_request` without one. */
    setFastThinkingLevel(level: ThinkingLevel | null): Promise<void>;
    /** Absolute path; created when missing and stored as its real path. Rejects `not_a_directory`. */
    setProjectsFolder(path: string): Promise<void>;
    /** The first existing `~/src`, `~/code`, `~/projects` or `~/dev` while the projects folder is still the default; else `null`. */
    suggestedCodeFolder(): Promise<SuggestedCodeFolder>;
    /** Whether messages sent while the agent works steer it or queue behind it. */
    setMessageMode(mode: MessageMode): Promise<void>;
    /** Where new threads in git projects start. */
    setWorkspaceDefault(mode: WorkspaceDefault): Promise<void>;
    /** Replaces the chosen connectors and the always-allowed tools. Takes effect at the next idle call of each thread. */
    setClaudeConnectors(value: ClaudeConnectorSettings): Promise<void>;
    /** `Settings.setupSkipped`: "Use my other nodes". The gate in `App.tsx` also needs a known peer, so it is harmless alone. */
    setSetupSkipped(skipped: boolean): Promise<void>;
  };
  github: {
    /** Cached for a minute. Never rejects for a missing or logged-out `gh`: that is a state. */
    status(): Promise<GithubStatus>;
    /** Archived and disabled repos dropped, most recently pushed first; `localPath` and `projectId` are computed per call. Rejects `github_unavailable` unless connected. */
    repos(): Promise<GithubRepo[]>;
    /** Bypasses the cache; one refresh in flight at a time. */
    refreshRepos(): Promise<GithubRepo[]>;
    /**
     * Idempotent. `local` needs a local copy (else `needs_folder`), `folder` needs `path` and a matching remote
     * (else `remote_mismatch`), `clone` starts a clone (`kind: "git"`). Rejects `not_found` for a repo not in the list.
     */
    use(input: UseGithubRepoInput): Promise<Project>;
  };
  providers: {
    /** Every provider we support, connected or not, in a fixed order. */
    list(): Promise<ProviderInfo[]>;
    /** Validates first. Rejects `invalid_key` without storing anything. Replaces a ChatGPT login. */
    setApiKey(id: ProviderId, key: string): Promise<ProviderInfo>;
    /** Removes the stored credential only; an env key keeps the provider connected (`source: "env"`). */
    disconnect(id: ProviderId): Promise<ProviderInfo>;
    /** Records that the user read the Claude CLI notice (`Settings.claudeCliNoticeAt`) and re-checks. Rejects `invalid_request` when the provider is hidden. */
    acknowledgeClaudeCli(): Promise<ProviderInfo>;
    /** Checks `claude auth status` again and reloads the model list. Never rejects for a missing or logged-out CLI: that is a state. */
    refreshClaudeCli(): Promise<ProviderInfo>;
    /** Installs the pinned Claude Agent SDK under the tau home, then re-checks. Rejects `invalid_request` when the provider is hidden and `internal` when the install fails. */
    installClaudeCliSdk(): Promise<ProviderInfo>;
    /** One active session; starting one awaits the cancel of the old. Rejects `invalid_request` for a provider without ChatGPT sign-in. */
    startLogin(id: "openai"): Promise<LoginSession>;
    /** Rejects `not_found` for an unknown or expired session. */
    login(sessionId: string): Promise<LoginSession>;
    /** The full callback URL. Rejects `not_found`; a wrong URL keeps the session waiting with `error` set, and `login_failed` after 5 attempts. */
    submitLoginUrl(sessionId: string, url: string): Promise<LoginSession>;
    /** Idempotent. Resolves once the login has stopped. */
    cancelLogin(sessionId: string): Promise<void>;
  };
  models: {
    /** Models of every connected provider, in provider order; `[]` when none is connected. */
    list(): Promise<ModelInfo[]>;
  };
  skills: {
    /** Project skills win over user skills with the same name. `null` lists user skills only. */
    list(projectId: string | null): Promise<Skill[]>;
  };
  projects: {
    /** Home first (`kind: "home"`), then creation order. */
    list(): Promise<Project[]>;
    /**
     * Resolves the real path. Rejects `path_not_found`, `not_a_directory` or `duplicate_project`.
     * `name` defaults to the folder's basename.
     */
    add(input: { path: string; name?: string }): Promise<Project>;
    /**
     * Resolves with `status: "cloning"`; the clone runs in the background. Rejects `git_missing`,
     * `invalid_git_url` or `duplicate_project`.
     */
    clone(input: { url: string; name?: string }): Promise<Project>;
    /** Rejects `invalid_request` unless the project's status is `failed`, `not_found` for an unknown id. */
    retryClone(id: string): Promise<void>;
    /** The custom icon, else the discovered one; `null` when there is none (and for Home). Rejects `not_found`. */
    icon(id: string): Promise<ProjectIconImage | null>;
    /** At most 12 images found in the project folder, addressed by relative name. Rejects `not_found`. */
    iconCandidates(id: string): Promise<IconCandidate[]>;
    /** Rejects `not_found` for an unknown project or a name that is not a current candidate. */
    iconCandidate(id: string, name: string): Promise<ProjectIconImage>;
    /** A 128x128 PNG of at most 256 KB, or `null` to go back to the automatic icon. Rejects `invalid_request`, `not_found`. */
    setIcon(id: string, png: Uint8Array | null): Promise<void>;
    /** Rejects `not_found`, and `invalid_request` for Home. */
    rename(id: string, name: string): Promise<void>;
    /**
     * Points the project at another folder holding the same repository (matching remote URL or root commit),
     * and moves checkout threads and worktree links with it. Rejects `not_found`, `path_not_found`,
     * `not_a_directory`, `duplicate_project`, `thread_busy` while a thread runs, and `invalid_request` for Home or
     * another repository.
     */
    setFolder(id: string, path: string): Promise<Project>;
    /** Deletes the project's conversations, aborting busy ones. Never touches the folder. Rejects `not_found`, and `invalid_request` for Home. */
    remove(id: string): Promise<void>;
    /** At most 20 files and folders relative to the project folder, best match first. A query with `..` or starting with `/` or `~` gives `[]`. Rejects `not_found`. */
    suggestFiles(id: string, query: string): Promise<FileSuggestion[]>;
  };
  conversations: {
    /** Most recently updated first, archived included, deleted excluded. Rejects `not_found` for an unknown project. */
    list(projectId: string): Promise<ConversationSummary[]>;
    /** Every project including Home, most recent first. */
    listAll(): Promise<ConversationSummary[]>;
    /**
     * Creates the conversation and admits its first message in one call; resolves once admitted. A repeated
     * `requestId` returns the same conversation. Rejects `not_found`, `project_not_ready`, `no_provider`,
     * `no_default_model`, `invalid_request` or `images_not_supported` without creating anything.
     */
    start(input: StartConversationInput): Promise<ConversationSummary>;
    /** Rejects `not_found`. */
    rename(id: string, title: string): Promise<void>;
    /**
     * Resolves once the message is durably admitted, not when the run ends. Steers when the conversation is busy.
     * A repeated `requestId` is a no-op. Unarchives. Rejects `not_found`, `invalid_request` or `images_not_supported`.
     */
    send(id: string, input: SendMessageInput): Promise<void>;
    /** Stops the current run; resolves once the conversation is idle. Rejects `not_found`. */
    abort(id: string): Promise<void>;
    /** Never aborts a run. Rejects `not_found`. */
    archive(id: string, archived: boolean): Promise<void>;
    /**
     * Idempotent for an already deleted id; rejects `not_found` for an unknown one. Rejects `has_unmerged_work`
     * when the worktree has uncommitted changes or unmerged commits, unless `force`.
     */
    remove(id: string, options?: { force?: boolean }): Promise<void>;
    /**
     * Deletes archived top-level threads (children go with them). Threads with unmerged work, or running, are kept
     * with a reason unless `force` (running threads are always kept).
     */
    deleteArchived(input: DeleteArchivedInput): Promise<DeleteArchivedResult>;
    /** Stops the run of a subagent child; its status becomes `stopped`. Rejects `not_found`, `invalid_request` for a thread that is not a child. */
    stopAgent(id: string): Promise<void>;
    /** New thread in the same checkout or worktree, with history up to and including the entry. Rejects `not_found`. */
    fork(id: string, entryId: string): Promise<ConversationSummary>;
    /** The files a rewind would change. Rejects `not_found` for an unknown thread, entry or checkpoint. */
    rewindPreview(id: string, entryId: string): Promise<RestorePreview>;
    /** Restores files, forks before the entry; `draft` is the message text. Rejects `thread_busy`, `not_found`. */
    rewind(id: string, entryId: string): Promise<{ conversation: ConversationSummary; draft: string }>;
    /** `{ cancelled: false }` when the queued item was already delivered. Rejects `not_found`. */
    cancelQueued(id: string, itemId: string): Promise<{ cancelled: boolean }>;
    /** In order of time. Rejects `not_found`. */
    checkpoints(id: string): Promise<Checkpoint[]>;
    /** Unified diff of one file; `path` is repo-relative without `..`. Rejects `not_found`, `invalid_request`. */
    checkpointDiff(id: string, checkpointId: string, path: string): Promise<string>;
    /**
     * Changes the model and/or thinking level; applies from the next model request, also while busy. The level is
     * clamped to what the resulting model supports. Rejects `not_found`, and `invalid_request` for an unlisted
     * model or an empty input.
     */
    configure(id: string, input: ConfigureConversationInput): Promise<void>;
    /**
     * Continues after a failed or stopped answer (see `isRetryable`), once per `requestId`. Unarchives.
     * Rejects `not_found`, and `invalid_request` unless retryable.
     */
    retry(id: string, input: RetryInput): Promise<void>;
    /** Resolves when the compaction ends. Rejects `not_found`, and `nothing_to_compact` when there is nothing to summarize. */
    compact(id: string, input: CompactInput): Promise<void>;
    /**
     * `onOps` first gets `[["r", view]]` (view is a `ConversationView`), then each commit's ops. After falling behind
     * it may get `[["r", view]]` again, and `[["r", null]]` when the view is retired or the conversation is deleted.
     * Calls are serialized. Rejects `not_found` for an unknown or deleted conversation.
     */
    watch(id: string, onOps: OpsListener): Promise<ConversationWatcher>;
  };
  workspaces: {
    /** Rejects `not_found`, and `invalid_request` for a thread without a worktree. */
    status(conversationId: string): Promise<WorkspaceStatus>;
    /** Rebases and fast-forwards the base. Rejects `thread_busy`, `worktree_dirty`, `merge_conflict`, `not_on_base`, `base_dirty`. */
    merge(conversationId: string): Promise<ConversationSummary>;
    /** Needs a connected `gh`; rejects `github_unavailable`. */
    createPullRequest(conversationId: string): Promise<ConversationSummary>;
    /** Rejects `has_unmerged_work` unless `force`. The thread moves to the main checkout. */
    remove(conversationId: string, force: boolean): Promise<ConversationSummary>;
  };
  processes: {
    list(conversationId: string): Promise<ProcessInfo[]>;
    /** The last `tail` lines. Rejects `not_found`. */
    logs(id: string, tail: number): Promise<string>;
    /** Idempotent for a stopped process; rejects `not_found`. */
    stop(id: string): Promise<void>;
    /**
     * Detaches the running `bash` call `callId` of the thread: the call returns at once and its command keeps running,
     * now as a background process that tells the thread when it exits. Rejects `not_found` when no such call is running.
     */
    background(conversationId: string, callId: string): Promise<ProcessInfo>;
  };
  terminals: {
    /** False when this node cannot run terminals (unsupported platform, missing daemon, `TAU_DISABLE_TERMINALS=1`). Never rejects. */
    available(): Promise<boolean>;
    /** Rejects `not_found` for an unknown thread (or when unavailable). */
    list(conversationId: string): Promise<TerminalInfo[]>;
    /** Rejects `not_found`, and `invalid_request` for a removed or missing folder or beyond 8 per thread / 32 in total. */
    open(conversationId: string, input: OpenTerminalInput): Promise<TerminalInfo>;
    /** Idempotent for an ended terminal; rejects `not_found` for an unknown id. */
    close(id: string): Promise<void>;
    /** Replays the kept output, then streams live. Rejects `not_found`. */
    attach(id: string, handlers: TerminalHandlers): Promise<TerminalAttachment>;
  };
  approvals: {
    /** The tool calls of this thread that wait for the user, oldest first. Rejects `not_found` for an unknown thread. */
    list(conversationId: string): Promise<Approval[]>;
    /** Rejects `not_found` for an unknown thread or a call that is not waiting. `allow_always` also stores the tool in `Settings.claudeConnectors.alwaysAllow`. */
    decide(conversationId: string, toolUseId: string, decision: ApprovalDecision): Promise<void>;
  };
  timers: {
    /** This thread's timers, soonest first. Rejects `not_found` for an unknown thread. */
    list(conversationId: string): Promise<Timer[]>;
    /** Idempotent. */
    delete(id: string): Promise<void>;
    /** Repeats `prompt` every `every` and runs it now, or paces itself without `every`. Rejects `not_found`, `invalid_request`. */
    loop(conversationId: string, input: LoopInput): Promise<void>;
    /** Deletes the thread's `/loop` timers. Idempotent. */
    stopLoop(conversationId: string): Promise<void>;
  };
  goals: {
    /** Replaces the active goal and starts a turn. Rejects `not_found`, `invalid_request` for a child thread or a condition over 4,000 characters. */
    set(conversationId: string, condition: string): Promise<void>;
    /** `null` when the thread has no goal. Rejects `not_found`. */
    get(conversationId: string): Promise<Goal | null>;
    /** Idempotent. Rejects `not_found`. */
    clear(conversationId: string): Promise<void>;
  };
  mcp: {
    /** Settings servers plus the project's `.mcp.json` servers (`null` for settings only). Never returns env or header values. */
    servers(projectId: string | null): Promise<McpServerStatus[]>;
    /** Adds or replaces by name. */
    save(config: McpServerConfig): Promise<void>;
    /** Idempotent. */
    remove(name: string): Promise<void>;
  };
  /**
   * Who may talk to this server. Secrets are 32 random bytes shown once; the store keeps `sha256(secret)`.
   * The server's guard calls `verify*`; `Core.access` never sees cookies or sockets.
   */
  access: {
    /** A device secret (browser, phone, cli). `undefined` for a wrong secret or a node secret. */
    verifyDevice(secret: string): Promise<{ deviceId: string } | undefined>;
    /** A node secret, accepted only by `GET /api/nodes/link`. `undefined` for any device secret. */
    verifyNode(secret: string): Promise<{ deviceId: string } | undefined>;
    /** Records activity; throttled to once a minute per device. Never rejects. */
    touch(deviceId: string): void;
    /** Newest first. `current` is true for `currentDeviceId`, never for nodes. */
    listDevices(currentDeviceId?: string): Promise<Device[]>;
    /** Rejects `not_found`. */
    renameDevice(id: string, name: string): Promise<void>;
    /** Idempotent for an unknown id. The server closes the device's open sockets. */
    revokeDevice(id: string): Promise<void>;
    /** Drops browsers, phones and cli devices, not nodes. */
    signOutAll(): Promise<void>;
    /** Single use, five minutes, at most five live; the oldest is dropped. A node pairing without remote has a `null` link. */
    mintPairing(input: MintPairingInput): Promise<MintedPairing>;
    /** Takes the link code or the short code. Rejects `unauthorized` (generic text) for a wrong or burnt code and for a locked peer. */
    redeemPairing(input: RedeemPairingInput): Promise<RedeemedPairing>;
  };
  remote: {
    /** Never rejects. */
    status(): Promise<RemoteStatus>;
    /** Opens the tunnel and stores `Settings.remote.enabled`. Resolves with `starting` or `online`. */
    enable(): Promise<RemoteStatus>;
    /** Closes and removes the tunnel; clears devices and nodes. */
    disable(): Promise<RemoteStatus>;
    /** "Make a new URL": a new tunnel, every device and node cleared. Rejects `invalid_request` unless `canRecreate`. */
    recreate(): Promise<RemoteStatus>;
  };
  /**
   * Nodes: every tau is a node and links to peers in BOTH directions (MVP13 Step 1). The list is the union of
   * accepted peers (node devices) and dialled peers (`<home>/peers.json`), deduped by `nodeId`; the id is the
   * peer's `nodeId` (a migrated entry keeps its old device id until its first `hello`).
   * The server owns sockets and frames; the dialler in the CLI reports per-peer link state with `reportLink`.
   */
  nodes: {
    /** This tau itself (identity from `<home>/node.json`, created at start). */
    self(): Promise<NodeSelf>;
    /** Signs `payload` with this node's private key (base64url Ed25519). The key never leaves core. */
    sign(payload: string): Promise<string>;
    /** Peers from both directions with a status computed from heartbeats (online, reconnecting after 15 s, offline after 45 s). */
    list(): Promise<Node[]>;
    /** Rejects `not_found`. Announces `nodes`. */
    rename(id: string, name: string): Promise<void>;
    /** Idempotent. Revokes the peer's device here, deletes its `peers.json` entry and standby and its summary cache, announces `nodes`. The server sends `bye` and closes its links. */
    disconnect(id: string): Promise<void>;
    /** Like `disconnect`, but local only and no `bye`: for a peer that must not be told. Idempotent. */
    forget(id: string): Promise<void>;
    /** Deletes `node.json` and `peers.json` and revokes every node device: a new key and `nodeId` at the next start. */
    resetIdentity(): Promise<void>;
    /** The dialler reports the state of its link to one peer (`peerId` is the `peers.json` entry's nodeId or old device id); core keeps it per peer and announces `nodes`. */
    reportLink(peerId: string, state: NodeLinkReport): void;
    /** A link passed the handshake (`hello` + `proof` verified). Stores `nodeId` and the public key on the node device (accepted) or the `peers.json` entry (dialled). `update-required` when `info.protocolVersion` differs from ours. Announces `nodes`. */
    register(peerId: string, info: NodePeerInfo, direction: NodeLinkDirection): Promise<Node>;
    /** A ping or any frame arrived; `threadCount` refreshes the count. */
    heartbeat(nodeId: string, threadCount?: number): void;
    /** The link closed. Announces `nodes`. */
    markOffline(nodeId: string): void;
    /** `undefined` when none was written. */
    readSummary(nodeId: string): Promise<NodeSummary | undefined>;
    /** Written only while the link is healthy; deleted by `disconnect`. */
    writeSummary(nodeId: string, summary: NodeSummary): Promise<void>;
  };
  /** This tau against the latest published version; never an error, offline keeps the last good value. */
  updates: {
    /** Never blocks: `latest` is null until the first background check succeeds. */
    status(): Promise<UpdateStatus>;
    /** Checks the registry now; a call within 60 s of the last returns the cached status. */
    refresh(): Promise<UpdateStatus>;
  };
  /** Fires after a successful commit that changed the project list or one project's conversation index. */
  onChange(listener: (change: Change) => void): () => void;
  close(): Promise<void>;
}

export interface CreateCoreOptions {
  readonly home: string;
  readonly faux?: boolean;
  /** The CLI entry file; core writes the `<home>/bin/tau` shim from it. */
  readonly cliEntry?: string;
  /** `127.0.0.1:<port>` of the server's tunnel listener; resolves once the server is up. Absent: remote cannot start. */
  readonly tunnelTarget?: () => Promise<string>;
  /** This tau's own version (`updates.status().current`). */
  readonly currentVersion: string;
  /** The registry's latest published version; rejects when unknown. The CLI supplies it (core cannot run npm). */
  readonly latestVersion: () => Promise<string>;
}

export type CreateCore = (options: CreateCoreOptions) => Promise<Core>;
