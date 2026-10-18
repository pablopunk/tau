import type { Api } from "@earendil-works/pi-ai";
import type { Provider } from "@earendil-works/pi-ai/models";
import type { ClaudeCliStatus } from "@tau/protocol";
import { type ClaudeCliClock, systemClaudeCliClock } from "./clock";
import { createClaudeCliDetector } from "./detect/claude-cli-detector";
import { createClaudeCliModels } from "./models/claude-cli-models";
import { createPlanUsage } from "./plan-usage";
import { createClaudeCliProvider } from "./provider";
import type { ClaudeSdkLoader } from "./sdk-types";
import { isClaudeCliReady } from "./status";
import { createClaudeCliStream } from "./stream/claude-cli-stream";

export const KILL_SWITCH_VARIABLE = "TAU_DISABLE_CLAUDE_CLI";
export const FAKE_SDK_VARIABLE = "TAU_FAKE_CLAUDE_CLI";

type Environment = Readonly<Record<string, string | undefined>>;

export interface ClaudeCliService {
  /** `null` under the kill switch: the provider is not registered and no row is listed. */
  readonly provider: Provider<Api> | null;
  /** `null` under the kill switch. */
  status(): ClaudeCliStatus | null;
  /** Records the notice, checks again. */
  acknowledge(): Promise<ClaudeCliStatus>;
  /** Checks again and reloads the model list. */
  refresh(): Promise<ClaudeCliStatus>;
  close(): Promise<void>;
}

export interface ClaudeCliServiceDeps {
  readonly env: Environment;
  readonly faux: boolean;
  readonly onChange: () => void;
  readonly noticeAt: () => Promise<number | null>;
  readonly recordNotice: () => Promise<void>;
  readonly clock?: ClaudeCliClock;
  /** Tests inject a fake SDK; production loads the real one on first use. */
  readonly sdk?: ClaudeSdkLoader;
}

export const claudeCliDisabled = (env: Environment): boolean => env[KILL_SWITCH_VARIABLE] === "1";

const DISABLED: ClaudeCliService = {
  provider: null,
  status: () => null,
  acknowledge: async () => {
    throw new Error("Claude CLI is disabled.");
  },
  refresh: async () => {
    throw new Error("Claude CLI is disabled.");
  },
  close: async () => undefined,
};

function memoized<T>(load: () => Promise<T>): () => Promise<T> {
  let loaded: Promise<T> | undefined;
  return () => (loaded ??= load());
}

async function fakeSdkLoader(loggedIn: boolean): Promise<ClaudeSdkLoader> {
  const { createFakeClaudeSdk, FAKE_LOGGED_IN } = await import("./testing/fake-claude-sdk");
  const fake = createFakeClaudeSdk({
    auth: loggedIn ? FAKE_LOGGED_IN : { ...FAKE_LOGGED_IN, loggedIn: false },
  });
  return fake.load;
}

export function defaultSdkLoader(env: Environment, faux: boolean): ClaudeSdkLoader {
  if (faux || env[FAKE_SDK_VARIABLE] === "1") {
    return memoized(async () => (await fakeSdkLoader(env[FAKE_SDK_VARIABLE] === "1"))());
  }
  return memoized(async () => (await import("./sdk-port")).loadClaudeSdkPort());
}

export function createClaudeCliService(deps: ClaudeCliServiceDeps): ClaudeCliService {
  if (claudeCliDisabled(deps.env)) return DISABLED;
  const clock = deps.clock ?? systemClaudeCliClock;
  const sdk = deps.sdk ?? defaultSdkLoader(deps.env, deps.faux);
  const planUsage = createPlanUsage({ clock, onChange: deps.onChange });
  const detector = createClaudeCliDetector({
    sdk,
    noticeAt: deps.noticeAt,
    usage: () => planUsage.current(),
    onChange: deps.onChange,
    clock,
  });
  const models = createClaudeCliModels({
    sdk,
    isReady: () => isClaudeCliReady(detector.status()),
    onChange: deps.onChange,
  });
  const streamer = createClaudeCliStream({
    sdk,
    planUsage,
    clock,
    env: deps.env,
    noteContextWindow: (value, window) => models.noteContextWindow(value, window),
    onAuthError: () => void detector.refresh(),
    onProcessCount: deps.onChange,
  });
  detector.start();
  const provider = createClaudeCliProvider({
    models,
    streamer,
    isReady: () => isClaudeCliReady(detector.status()),
  });
  return {
    provider,
    status: () => detector.status(),
    async acknowledge() {
      await deps.recordNotice();
      return detector.refresh();
    },
    async refresh() {
      const status = await detector.refresh();
      await models.refresh();
      return status;
    },
    async close() {
      detector.stop();
      await streamer.closeAll();
    },
  };
}
