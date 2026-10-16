import type { Core, CreateCore } from "@pi-everywhere/protocol";
import { createChangeEmitter } from "./change-emitter";
import { createConversationsApi } from "./conversations-api";
import { createConversationStore } from "./harness/conversation-store";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "./harness/open";
import { createProjectStore } from "./harness/project-store";
import { openDataHome } from "./home/data-home";
import { acquireHomeLock } from "./home/lock";
import { createSettingsStore } from "./home/settings-store";
import { createProjectsApi } from "./projects-api";
import { createProviderService, type Environment } from "./provider/provider-service";
import { createSettingsApi } from "./settings-api";

export interface CreateCoreOptions {
  /** Data home directory (`~/.pi-everywhere` by default in the CLI). */
  readonly home: string;
  /** Use pi-ai's faux provider with the faux script instead of OpenRouter. */
  readonly faux?: boolean;
}

export interface CoreDependencies {
  readonly env: Environment;
  readonly now: () => number;
  /** The agent store failed for good: the process cannot continue. */
  readonly onFatal: (error: unknown) => void;
}

const exitAfterLogging = (error: unknown) => {
  console.error("pi-everywhere: the agent store failed", error);
  process.exit(1);
};

export const defaultCoreDependencies = (): CoreDependencies => ({
  env: process.env,
  now: Date.now,
  onFatal: exitAfterLogging,
});

export async function createCoreWith(options: CreateCoreOptions, deps: CoreDependencies): Promise<Core> {
  const home = await openDataHome(options.home);
  const lock = await acquireHomeLock(home.lockFile);
  try {
    const provider = createProviderService({
      credentialsFile: home.credentialsFile,
      faux: options.faux ?? false,
      env: deps.env,
    });
    const settings = createSettingsStore(home.settingsFile);
    const harness = await openAgentHarness({
      storage: await openSqliteStorage(home.agentDatabase),
      models: provider.models,
      onReport: (error) => console.error("pi-everywhere: agent report", error),
    });
    harness.closed.then((end) => {
      if (end.reason === "failed") deps.onFatal(end.error);
    });

    const projects = createProjectStore(harness);
    const conversations = createConversationStore(harness);
    const changes = createChangeEmitter();
    const shared = { projects, conversations, changes, now: deps.now };

    let closing: Promise<void> | undefined;
    return {
      settings: createSettingsApi({ settings, provider }),
      provider: {
        status: () => provider.status(),
        setApiKey: (key) => provider.setApiKey(key),
        listModels: () => provider.listModels(),
      },
      projects: createProjectsApi(shared),
      conversations: createConversationsApi({ ...shared, provider, settings }),
      onChange: (listener) => changes.subscribe(listener),
      close() {
        closing ??= (async () => {
          changes.clear();
          try {
            await harness.close(BACKGROUND);
          } finally {
            await lock.release();
          }
        })();
        return closing;
      },
    };
  } catch (error) {
    await lock.release();
    throw error;
  }
}

export const createCore: CreateCore = (options) => createCoreWith(options, defaultCoreDependencies());
