import { homedir } from "node:os";
import { join } from "node:path";
import type { Core, CreateCore } from "@pi-everywhere/protocol";
import { createChangeEmitter } from "./change-emitter";
import { createCheckpointService } from "./checkpoints/checkpoint-service";
import { createConversationRecovery } from "./conversation-recovery";
import { createConversationsApi } from "./conversations-api";
import { suggestDirectories } from "./fs/suggest-directories";
import { createCloneService } from "./git/clone-service";
import { createGithubService } from "./github/github-service";
import { createRunGh, type RunGh, resolveGhPath } from "./github/run-gh";
import { createConversationForker } from "./harness/conversation-fork";
import { createConversationStore } from "./harness/conversation-store";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "./harness/open";
import { createProjectStore } from "./harness/project-store";
import { createAgentRegistry } from "./harness/registry";
import { createToolServicesRef } from "./harness/tools/tool-file";
import { openDataHome } from "./home/data-home";
import { acquireHomeLock } from "./home/lock";
import { createSettingsStore } from "./home/settings-store";
import { createIconService } from "./icons/icon-service";
import { createMcpService } from "./mcp/mcp-service";
import { createMcpApi } from "./mcp-api";
import { createProcessService } from "./processes/process-service";
import { createPresentProject } from "./project-view";
import { createProjectsApi } from "./projects-api";
import { createProviderService, type Environment } from "./provider/provider-service";
import { createProvidersApi } from "./providers-api";
import type { RemovalHooks } from "./removal-hooks";
import { createSettingsApi } from "./settings-api";
import { createSkillsApi } from "./skills/skills-api";
import { createStatusTracker } from "./status/status-tracker";
import { createTitleService } from "./titles/title-service";
import { createWorkspaceService } from "./workspaces/workspace-service";

export interface CreateCoreOptions {
  /** Data home directory (`~/.pi-everywhere` by default in the CLI). */
  readonly home: string;
  /** Use pi-ai's faux provider with the faux script instead of OpenRouter. */
  readonly faux?: boolean;
}

export interface CoreDependencies {
  readonly env: Environment;
  readonly now: () => number;
  /** Runs the GitHub CLI; the default execs the `gh` found on the PATH at startup. */
  readonly runGh: RunGh;
  /** Absolute path of `gh` (for the git credential helper); `undefined` when it is not installed. */
  readonly ghPath: string | undefined;
  /** The agent store failed for good: the process cannot continue. */
  readonly onFatal: (error: unknown) => void;
}

const exitAfterLogging = (error: unknown) => {
  console.error("pi-everywhere: the agent store failed", error);
  process.exit(1);
};

export const defaultCoreDependencies = (): CoreDependencies => {
  const ghPath = resolveGhPath(process.env);
  return {
    env: process.env,
    now: Date.now,
    runGh: createRunGh(ghPath, process.env),
    ghPath,
    onFatal: exitAfterLogging,
  };
};

export async function createCoreWith(options: CreateCoreOptions, deps: CoreDependencies): Promise<Core> {
  const home = await openDataHome(options.home);
  const lock = await acquireHomeLock(home.lockFile);
  try {
    const changes = createChangeEmitter();
    const provider = createProviderService({
      credentialsFile: home.credentialsFile,
      faux: options.faux ?? false,
      env: deps.env,
      changes,
    });
    const defaultProjectsFolder = join(home.root, "projects");
    const settings = createSettingsStore(home.settingsFile, defaultProjectsFolder);
    const status = createStatusTracker({ changes, now: deps.now });
    const toolServices = createToolServicesRef();
    const harness = await openAgentHarness({
      registry: createAgentRegistry(toolServices),
      storage: await openSqliteStorage(home.agentDatabase),
      models: provider.models,
      onReport: (error) => console.error("pi-everywhere: agent report", error),
      beforeResume: (opened) => status.attach(opened),
    });
    harness.closed.then((end) => {
      if (end.reason === "failed") deps.onFatal(end.error);
    });

    const projects = createProjectStore(harness);
    const conversations = createConversationStore(harness, async (id) => (await projects.require(id)).path);
    const shared = { projects, conversations, changes, now: deps.now };
    const titles = createTitleService({ harness, models: provider.models, settings, changes });
    const icons = createIconService({ iconsDirectory: home.iconsDirectory, now: deps.now });
    const present = createPresentProject(icons);
    const githubRef: { current?: ReturnType<typeof createGithubService> } = {};
    const allowFileClones = (options.faux ?? false) && deps.env.PI_EVERYWHERE_ALLOW_FILE_CLONES === "1";
    const clones = createCloneService({
      harness,
      projects,
      settings,
      changes,
      now: deps.now,
      env: deps.env,
      allowFileClones,
      extraGitConfig: (url) => githubRef.current?.extraGitConfig(url) ?? [],
    });
    const github = createGithubService({
      runGh: deps.runGh,
      ghPath: deps.ghPath,
      projects,
      clones,
      settings,
      changes,
      now: deps.now,
      allowFileClones,
      presentProject: present,
    });
    githubRef.current = github;
    const workspaces = createWorkspaceService({ home: home.root, conversations });
    const forker = createConversationForker(harness, conversations);
    const checkpoints = createCheckpointService({ home: home.root, conversations, forker });
    const processes = createProcessService({
      home: home.root,
      emitChange: (conversationId) => changes.emit({ resource: "processes", conversationId }),
    });
    const mcp = createMcpService({
      settingsServers: () => settings.mcpServers(),
      projectPathOf: async (id) => (await projects.require(id)).path,
    });
    toolServices.set({ processes, mcp });
    const removalHooks: RemovalHooks = {
      unmergedWork: (thread) => workspaces.unmergedWork(thread),
      onConversationRemoved: [
        (thread) => workspaces.onConversationRemoved(thread),
        (thread) => checkpoints.onConversationRemoved(thread),
        (thread) => processes.onConversationRemoved(thread),
      ],
      onProjectRemoved: [(id) => workspaces.onProjectRemoved(id)],
    };
    const recovery = createConversationRecovery({ harness, conversations, changes });
    await status.recoverAtStartup();
    await clones.recoverAtStartup();
    await recovery.recoverAtStartup();
    await processes.reapStaleAtStartup();

    let closing: Promise<void> | undefined;
    return {
      fs: { suggestDirectories },
      settings: createSettingsApi({
        settings,
        provider,
        codeFolder: { settings, defaultProjectsFolder, homeDirectory: homedir() },
        onProjectsFolderChanged: () => github.invalidateScan(),
      }),
      github: {
        status: () => github.status(),
        repos: () => github.repos(),
        refreshRepos: () => github.refreshRepos(),
        use: (input) => github.use(input),
      },
      ...createProvidersApi(provider),
      skills: createSkillsApi({ projects }),
      projects: createProjectsApi({ ...shared, clones, icons, present, removalHooks }),
      conversations: createConversationsApi({
        ...shared,
        provider,
        settings,
        titles,
        status,
        workspaces,
        checkpoints,
        forker,
        removalHooks,
      }),
      workspaces: {
        status: (id) => workspaces.status(id),
        merge: (id) => workspaces.merge(id),
        createPullRequest: (id) => workspaces.createPullRequest(id),
        remove: (id, force) => workspaces.remove(id, force),
      },
      processes: {
        list: (id) => processes.list(id),
        logs: (id, tail) => processes.logs(id, tail),
        stop: (id) => processes.stop(id),
      },
      mcp: createMcpApi({ settings, mcp, changes }),
      onChange: (listener) => changes.subscribe(listener),
      close() {
        closing ??= (async () => {
          changes.clear();
          clones.stopAll();
          try {
            await processes.stopAll();
            await mcp.closeAll();
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
