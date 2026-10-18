import {
  AppError,
  type Change,
  type Core,
  type LoginSession,
  type ModelInfo,
  type ProviderId,
  type ProviderInfo,
} from "@tau/protocol";
import {
  FAKE_AUTH_URL,
  FAKE_CLAUDE_CLI_MODELS,
  FAKE_CLAUDE_CLI_RESETS_AT,
  FAKE_MODELS,
  FAKE_PROVIDERS,
  FAKE_VALID_CALLBACK_URL,
} from "./catalog";

const MAX_LOGIN_ATTEMPTS = 5;
const CALLBACK_PREFIX = "http://127.0.0.1:1455/auth/callback";

type Connection = NonNullable<ProviderInfo["connection"]>;

interface FakeLogin {
  session: LoginSession;
  attempts: number;
}

const copyModel = (model: ModelInfo): ModelInfo => ({ ...model, thinkingLevels: [...model.thinkingLevels] });

function rejectionFor(url: string): string {
  const pasted = url.trim();
  if (!URL.canParse(pasted)) return "Paste the full callback URL from the browser";
  if (!pasted.startsWith(CALLBACK_PREFIX))
    return `The pasted callback URL must start with ${CALLBACK_PREFIX}`;
  return "OAuth state mismatch";
}

export interface FakeProviders {
  readonly providers: Core["providers"];
  readonly models: Core["models"];
  isConnected(): boolean;
  claudeCliNoticeAt(): number | null;
}

export function createFakeProviders(deps: {
  emit: (change: Change) => void;
  connectOpenRouter: boolean;
}): FakeProviders {
  const connections = new Map<ProviderId, Connection>();
  if (deps.connectOpenRouter)
    connections.set("openrouter", { method: "api_key", source: "file", valid: true });
  let claudeCliNoticeAt: number | null = null;
  const logins = new Map<string, FakeLogin>();
  let activeLoginId: string | undefined;
  let nextLoginId = 1;

  const infoOf = (id: ProviderId): ProviderInfo => {
    const provider = FAKE_PROVIDERS.find((candidate) => candidate.id === id);
    if (!provider) throw new AppError("not_found", `Unknown provider: ${id}`);
    return {
      ...provider,
      methods: [...provider.methods],
      connection: connections.get(id) ?? null,
      cli: id === "claude-cli" ? claudeCliStatus() : null,
    };
  };

  const claudeCliStatus = (): NonNullable<ProviderInfo["cli"]> => {
    const updatedAt = claudeCliNoticeAt;
    return {
      state: updatedAt !== null ? "ready" : "needs_notice",
      plan: "Team",
      org: "Fake Org",
      cliVersion: "2.1.302",
      sdkCliVersion: "2.1.302",
      message: null,
      usage:
        updatedAt !== null
          ? {
              status: "allowed",
              fiveHour: 0.43,
              resetsAt: FAKE_CLAUDE_CLI_RESETS_AT,
              updatedAt,
            }
          : null,
      processCount: 0,
    };
  };

  const refuseKeyOperationsOnCli = (id: ProviderId) => {
    if (id === "claude-cli") throw new AppError("invalid_request", "Claude CLI has no API key.");
  };

  const changed = () => deps.emit({ resource: "providers" });

  const requireLogin = (id: string): FakeLogin => {
    const login = logins.get(id);
    if (!login) throw new AppError("not_found", `Unknown sign-in: ${id}`);
    return login;
  };

  const settle = (login: FakeLogin, state: LoginSession["state"], error: string | null = null) => {
    login.session = { ...login.session, state, error };
    if (activeLoginId === login.session.id) activeLoginId = undefined;
  };

  const cancelActiveLogin = () => {
    const active = activeLoginId ? logins.get(activeLoginId) : undefined;
    if (active) settle(active, "cancelled");
  };

  const rejectAttempt = (login: FakeLogin, url: string) => {
    login.attempts += 1;
    const error = rejectionFor(url);
    if (login.attempts >= MAX_LOGIN_ATTEMPTS) settle(login, "failed", error);
    else login.session = { ...login.session, error };
  };

  return {
    isConnected: () => connections.size > 0,
    claudeCliNoticeAt: () => claudeCliNoticeAt,
    providers: {
      async list() {
        return FAKE_PROVIDERS.map((provider) => infoOf(provider.id));
      },
      async setApiKey(id, key) {
        infoOf(id);
        refuseKeyOperationsOnCli(id);
        if (key.trim() === "") throw new AppError("invalid_key", "The key is empty");
        connections.set(id, { method: "api_key", source: "file", valid: true });
        changed();
        return infoOf(id);
      },
      async disconnect(id) {
        infoOf(id);
        refuseKeyOperationsOnCli(id);
        connections.delete(id);
        changed();
        return infoOf(id);
      },
      async acknowledgeClaudeCli() {
        claudeCliNoticeAt = Date.now();
        connections.set("claude-cli", { method: "claude_cli", source: "cli", valid: true });
        changed();
        return infoOf("claude-cli");
      },
      async refreshClaudeCli() {
        changed();
        return infoOf("claude-cli");
      },
      async installClaudeCliSdk() {
        changed();
        return infoOf("claude-cli");
      },
      async startLogin() {
        cancelActiveLogin();
        const session: LoginSession = {
          id: `login-${nextLoginId++}`,
          provider: "openai",
          method: "chatgpt",
          state: "waiting",
          authUrl: FAKE_AUTH_URL,
          error: null,
        };
        logins.set(session.id, { session, attempts: 0 });
        activeLoginId = session.id;
        return session;
      },
      async login(sessionId) {
        return requireLogin(sessionId).session;
      },
      async submitLoginUrl(sessionId, url) {
        const login = requireLogin(sessionId);
        if (login.session.state !== "waiting") throw new AppError("login_failed", "This sign-in is over.");
        if (url.trim() !== FAKE_VALID_CALLBACK_URL) {
          rejectAttempt(login, url);
          return login.session;
        }
        connections.set("openai", { method: "chatgpt", source: "file", valid: true });
        settle(login, "done");
        changed();
        return login.session;
      },
      async cancelLogin(sessionId) {
        const login = logins.get(sessionId);
        if (login?.session.state === "waiting") settle(login, "cancelled");
      },
    },
    models: {
      async list() {
        const claudeModels = connections.has("claude-cli") ? FAKE_CLAUDE_CLI_MODELS.map(copyModel) : [];
        return connections.size > 0 ? [...FAKE_MODELS.map(copyModel), ...claudeModels] : [];
      },
    },
  };
}
