import type { DeleteArchivedInput, DeleteArchivedResult } from "./archived";
import type {
  Change,
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
  WorkspaceMode,
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
  /** Fires after a successful commit that changed the project list or one project's conversation index. */
  onChange(listener: (change: Change) => void): () => void;
  close(): Promise<void>;
}

export interface CreateCoreOptions {
  readonly home: string;
  readonly faux?: boolean;
  /** The CLI entry file; core writes the `<home>/bin/tau` shim from it. */
  readonly cliEntry?: string;
}

export type CreateCore = (options: CreateCoreOptions) => Promise<Core>;
