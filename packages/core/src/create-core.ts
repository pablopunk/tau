import { join } from "node:path";
import type { Core, CreateCore } from "@pi-everywhere/protocol";
import { createChangeEmitter } from "./change-emitter";
import { createConversationRecovery } from "./conversation-recovery";
import { createConversationsApi } from "./conversations-api";
import { createCloneService } from "./git/clone-service";
import { createConversationStore } from "./harness/conversation-store";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "./harness/open";
import { createProjectStore } from "./harness/project-store";
import { openDataHome } from "./home/data-home";
import { acquireHomeLock } from "./home/lock";
import { createSettingsStore } from "./home/settings-store";
import { createProjectsApi } from "./projects-api";
import { createProviderService, type Environment } from "./provider/provider-service";
import { createSettingsApi } from "./settings-api";
import { createStatusTracker } from "./status/status-tracker";
import { createTitleService } from "./titles/title-service";

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
    const settings = createSettingsStore(home.settingsFile, join(home.root, "projects"));
    const changes = createChangeEmitter();
    const status = createStatusTracker({ changes, now: deps.now });
    const harness = await openAgentHarness({
      storage: await openSqliteStorage(home.agentDatabase),
      models: provider.models,
      onReport: (error) => console.error("pi-everywhere: agent report", error),
      beforeResume: (opened) => status.attach(opened),
    });
    harness.closed.then((end) => {
      if (end.reason === "failed") deps.onFatal(end.error);
    });

    const projects = createProjectStore(harness);
    const conversations = createConversationStore(harness);
    const shared = { projects, conversations, changes, now: deps.now };
    const titles = createTitleService({ harness, models: provider.models, settings, changes });
    const clones = createCloneService({
      harness,
      projects,
      settings,
      changes,
      now: deps.now,
      env: deps.env,
      allowFileClones: (options.faux ?? false) && deps.env.PI_EVERYWHERE_ALLOW_FILE_CLONES === "1",
    });
    const recovery = createConversationRecovery({ harness, conversations, changes });
    await status.recoverAtStartup();
    await clones.recoverAtStartup();
    await recovery.recoverAtStartup();

    let closing: Promise<void> | undefined;
    return {
      settings: createSettingsApi({ settings, provider }),
      provider: {
        status: () => provider.status(),
        setApiKey: (key) => provider.setApiKey(key),
        listModels: () => provider.listModels(),
      },
      projects: createProjectsApi({ ...shared, clones }),
      conversations: createConversationsApi({ ...shared, provider, settings, titles, status }),
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
