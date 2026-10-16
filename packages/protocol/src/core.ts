import type {
  Change,
  ConversationSummary,
  ModelInfo,
  ModelRef,
  Project,
  ProviderStatus,
  SendMessageInput,
  Settings,
} from "./entities";
import type { Op } from "./view";

export type {
  Change,
  ConversationSummary,
  ModelInfo,
  ModelRef,
  Project,
  ProviderStatus,
  SendMessageInput,
  Settings,
} from "./entities";

export type OpsListener = (ops: readonly Op[]) => Promise<void>;

export interface ConversationWatcher {
  stop(): Promise<void>;
}

/**
 * The application core. Every method rejects with `AppError` (see `errors.ts`) for expected failures; anything else
 * is an internal error. The server only depends on this interface, and `createCore` (packages/core) implements it.
 */
export interface Core {
  settings: {
    get(): Promise<Settings>;
    /** Only affects conversations created afterwards. Rejects `invalid_request` for a model the provider does not list. */
    setDefaultModel(ref: ModelRef): Promise<void>;
  };
  provider: {
    /** `configured` is false and `source`/`valid` are null until a key exists (file or OPENROUTER_API_KEY). */
    status(): Promise<ProviderStatus>;
    /** Validates the key against the provider first. Rejects `invalid_key` without storing anything. */
    setApiKey(key: string): Promise<void>;
    /** Models the configured key can use. Rejects `no_provider` when nothing is configured. */
    listModels(): Promise<ModelInfo[]>;
  };
  projects: {
    /** In creation order. */
    list(): Promise<Project[]>;
    /**
     * Resolves the real path. Rejects `path_not_found`, `not_a_directory` or `duplicate_project`.
     * `name` defaults to the folder's basename.
     */
    add(input: { path: string; name?: string }): Promise<Project>;
    /** Rejects `not_found`. */
    rename(id: string, name: string): Promise<void>;
    /** Aborts the project's busy conversations first. Never touches the folder. Rejects `not_found`. */
    remove(id: string): Promise<void>;
  };
  conversations: {
    /** Most recently updated first. Rejects `not_found` for an unknown project. */
    list(projectId: string): Promise<ConversationSummary[]>;
    /** Uses the current default model. Rejects `not_found`, `no_provider` or `no_default_model`. */
    create(projectId: string): Promise<ConversationSummary>;
    /** Rejects `not_found`. */
    rename(id: string, title: string): Promise<void>;
    /**
     * Resolves once the message is durably admitted, not when the run ends. Steers when the conversation is busy.
     * A repeated `requestId` is a no-op. Rejects `not_found`.
     */
    send(id: string, input: SendMessageInput): Promise<void>;
    /** Stops the current run; resolves once the conversation is idle. Rejects `not_found`. */
    abort(id: string): Promise<void>;
    /**
     * `onOps` first gets `[["r", view]]` (view is a `ConversationView`), then each commit's ops. After falling behind
     * it may get `[["r", view]]` again, and `[["r", null]]` when the view is retired. Calls are serialized.
     * Rejects `not_found` for an unknown conversation.
     */
    watch(id: string, onOps: OpsListener): Promise<ConversationWatcher>;
  };
  /** Fires after a successful commit that changed the project list or one project's conversation index. */
  onChange(listener: (change: Change) => void): () => void;
  close(): Promise<void>;
}

export type CreateCore = (options: { home: string; faux?: boolean }) => Promise<Core>;
