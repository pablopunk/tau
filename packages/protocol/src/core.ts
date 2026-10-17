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
} from "./entities";
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
    /** Idempotent for an already deleted id; rejects `not_found` for an unknown one. */
    remove(id: string): Promise<void>;
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
  /** Fires after a successful commit that changed the project list or one project's conversation index. */
  onChange(listener: (change: Change) => void): () => void;
  close(): Promise<void>;
}

export type CreateCore = (options: { home: string; faux?: boolean }) => Promise<Core>;
