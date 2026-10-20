import type { Api } from "@earendil-works/pi-ai";
import type { Provider } from "@earendil-works/pi-ai/models";
import type { ClaudeCliStatus, ClaudeConnectorSettings } from "@tau/protocol";
import type { Approvals } from "../approvals/approvals-port";
import { type ClaudeCliClock, systemClaudeCliClock } from "./clock";
import { createConnectorProbe } from "./connectors/connector-probe";
import { lateConnectorsMessage } from "./connectors/late-message";
import type { ObservedResultStore } from "./connectors/observed-results";
import { createClaudeCliDetector } from "./detect/claude-cli-detector";
import { createClaudeCliModels } from "./models/claude-cli-models";
import { createPlanUsage } from "./plan-usage";
import { createClaudeCliProvider } from "./provider";
import { type ClaudeSdkInstaller, noopSdkInstaller } from "./sdk-install";
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
  /** Checks again and loads the model list, without the connector probe. Never rejects. */
  loadModels(): Promise<void>;
  /** Installs the pinned Agent SDK, then refreshes. */
  installSdk(): Promise<ClaudeCliStatus>;
  /** Archive and delete: closes the SDK query of a Pi session. */
  closeThread(piSessionId: string): Promise<void>;
  /** Stop on a connector call: interrupts the open turn of a Pi session. */
  interruptConversation(piSessionId: string): Promise<void>;
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
  /** `<tau home>/claude-sdk`. Where the SDK is installed and loaded from. */
  readonly sdkHome?: string;
  readonly installer?: ClaudeSdkInstaller;
  readonly connectorSettings?: () => Promise<ClaudeConnectorSettings>;
  readonly approvals?: Approvals;
  readonly observed?: ObservedResultStore;
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
  loadModels: async () => undefined,
  installSdk: async () => {
    throw new Error("Claude CLI is disabled.");
  },
  closeThread: async () => undefined,
  interruptConversation: async () => undefined,
  close: async () => undefined,
};

function memoizedUntilItFails<T>(load: () => Promise<T>): () => Promise<T> {
  let loaded: Promise<T> | undefined;
  return () => {
    loaded ??= load().catch((error: unknown) => {
      loaded = undefined;
      throw error;
    });
    return loaded;
  };
}

const usesFakeSdk = (env: Environment, faux: boolean): boolean => faux || env[FAKE_SDK_VARIABLE] === "1";

async function fakeSdkLoader(loggedIn: boolean): Promise<ClaudeSdkLoader> {
  const { createFakeClaudeSdk, FAKE_LOGGED_IN } = await import("./testing/fake-claude-sdk");
  const { FAKE_LINEAR, FAKE_NEEDS_AUTH, FAKE_SLACK } = await import("./testing/fake-claude-connectors");
  const { fakeThreadScript } = await import("./testing/fake-claude-thread-script");
  const fake = createFakeClaudeSdk({
    script: fakeThreadScript,
    connectors: [FAKE_LINEAR, FAKE_SLACK, FAKE_NEEDS_AUTH],
    auth: loggedIn ? FAKE_LOGGED_IN : { ...FAKE_LOGGED_IN, loggedIn: false },
  });
  return fake.load;
}

export function defaultSdkLoader(env: Environment, faux: boolean, sdkHome?: string): ClaudeSdkLoader {
  if (usesFakeSdk(env, faux)) {
    return memoizedUntilItFails(async () => (await fakeSdkLoader(env[FAKE_SDK_VARIABLE] === "1"))());
  }
  return memoizedUntilItFails(async () => (await import("./sdk-port")).loadClaudeSdkPort(sdkHome));
}

export function createClaudeCliService(deps: ClaudeCliServiceDeps): ClaudeCliService {
  if (claudeCliDisabled(deps.env)) return DISABLED;
  const clock = deps.clock ?? systemClaudeCliClock;
  const sdk = deps.sdk ?? defaultSdkLoader(deps.env, deps.faux, deps.sdkHome);
  const installer = deps.installer ?? noopSdkInstaller;
  let installing: Promise<void> | null = null;
  const installSdk = async (): Promise<ClaudeCliStatus> => {
    installing ??= installer.install().finally(() => {
      installing = null;
    });
    await installing;
    return refresh();
  };
  /** The notice was acknowledged, so tau installs the SDK for the user instead of failing every thread's run. */
  const installSdkWhenMissing = async (): Promise<void> => {
    if (detector.status().state !== "sdk_missing" || (await deps.noticeAt()) === null) return;
    await installSdk().catch(() => undefined);
  };
  const planUsage = createPlanUsage({ clock, onChange: deps.onChange });
  const detector = createClaudeCliDetector({
    sdk,
    noticeAt: deps.noticeAt,
    usage: () => planUsage.current(),
    onChange: () => {
      deps.onChange();
      void installSdkWhenMissing();
    },
    clock,
    sdkHome: deps.sdkHome,
  });
  const models = createClaudeCliModels({
    sdk,
    isReady: () => isClaudeCliReady(detector.status()),
    onChange: deps.onChange,
  });
  let lateNotes: readonly string[] = [];
  const streamer = createClaudeCliStream({
    onConnectorsLate: (notes) => {
      lateNotes = notes;
      deps.onChange();
    },
    sdk,
    planUsage,
    clock,
    env: deps.env,
    noteContextWindow: (value, window) => models.noteContextWindow(value, window),
    onAuthError: () => void detector.refresh(),
    onProcessCount: deps.onChange,
    ...(deps.connectorSettings && { connectorSettings: deps.connectorSettings }),
    ...(deps.approvals && { approvals: deps.approvals }),
    ...(deps.observed && { observed: deps.observed }),
  });
  const connectorProbe = createConnectorProbe({ sdk, onChange: deps.onChange });
  detector.start();
  const provider = createClaudeCliProvider({
    models,
    streamer,
    isReady: () => isClaudeCliReady(detector.status()),
  });
  const statusWithProcesses = (): ClaudeCliStatus => ({
    ...detector.status(),
    ...(lateNotes.length > 0 && { message: lateConnectorsMessage(lateNotes) }),
    processCount: streamer.processCount(),
    connectors: isClaudeCliReady(detector.status()) ? connectorProbe.current() : null,
  });
  const refresh = async (): Promise<ClaudeCliStatus> => {
    lateNotes = [];
    await detector.refresh();
    await models.refresh();
    if (isClaudeCliReady(detector.status())) await connectorProbe.refresh();
    return statusWithProcesses();
  };
  return {
    provider,
    status: statusWithProcesses,
    async acknowledge() {
      await deps.recordNotice();
      return detector.refresh();
    },
    refresh,
    async loadModels() {
      await detector.refresh().catch(() => undefined);
      await models.refresh().catch(() => undefined);
    },
    installSdk,
    closeThread: (piSessionId) => streamer.closeThread(piSessionId),
    interruptConversation: (piSessionId) => streamer.interruptConversation(piSessionId),
    async close() {
      detector.stop();
      await streamer.closeAll();
    },
  };
}
