import { randomBytes } from "node:crypto";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import type { Harness } from "@earendil-works/pi-durable";
import {
  type Core,
  type CreateCore,
  type CreateCoreOptions,
  LINK_PROTOCOL,
  PROTOCOL_VERSION,
} from "@tau/protocol";
import { createAccess } from "./access/create-access";
import { createFileDeviceStore } from "./access/file-device-store";
import { createAgentTypeLoader } from "./agents/agent-types";
import { resolveModelAlias } from "./agents/model-alias";
import { createApprovals } from "./approvals/approvals";
import { createApprovalsApi } from "./approvals-api";
import { createArchivedCleanup } from "./archived-cleanup";
import { createChangeEmitter } from "./change-emitter";
import { createCheckpointService } from "./checkpoints/checkpoint-service";
import { createConnectorToolServices } from "./claude-cli/connectors/connector-tool-services";
import { writeTauShim } from "./cli-shim/write-shim";
import { createConversationRecovery } from "./conversation-recovery";
import { createConversationRemoval } from "./conversation-removal";
import { createConversationsApi } from "./conversations-api";
import { suggestDirectories } from "./fs/suggest-directories";
import { createCloneService } from "./git/clone-service";
import { createGithubService } from "./github/github-service";
import { createRunGh, type RunGh, resolveGhPath } from "./github/run-gh";
import { checkinMinutesFrom, createGoalService } from "./goals/goal-service";
import { createJudgeModel } from "./goals/judge-model";
import { createGoalsApi } from "./goals-api";
import { createConnectorOffering } from "./harness/connector-offering";
import { resyncWhenConnectorsChange } from "./harness/connector-resync";
import { createConversationForker } from "./harness/conversation-fork";
import { type ConversationOfSession, createConversationOfSession } from "./harness/conversation-of-session";
import { createConversationStore } from "./harness/conversation-store";
import { createLiveWork } from "./harness/live-work";
import { harnessNotificationSubmitter } from "./harness/notification-submitter";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "./harness/open";
import { createProjectStore } from "./harness/project-store";
import { providerSessionOf } from "./harness/provider-session";
import { createAgentRegistry } from "./harness/registry";
import { createSubagentRemover } from "./harness/subagent-removal";
import { createLocalTerminalDaemon, type TerminalDaemon } from "./harness/terminal-daemon";
import { clampThinkingFor } from "./harness/tools/agent-thinking";
import { createToolServicesRef } from "./harness/tools/tool-file";
import { openDataHome } from "./home/data-home";
import { acquireHomeLock } from "./home/lock";
import { createSettingsStore } from "./home/settings-store";
import { createIconService } from "./icons/icon-service";
import { createNodeIdentityStore } from "./identity/node-identity";
import { createMcpService } from "./mcp/mcp-service";
import { createMcpApi } from "./mcp-api";
import { createNodes } from "./nodes/create-nodes";
import { createDirectory } from "./nodes/directory";
import { createSelfThreadCount } from "./nodes/self-thread-count";
import { createFilePeersStore, migrateHubFile, migrateSummaryDirectory } from "./peers/peers-store";
import { createProcessService } from "./processes/process-service";
import { createPresentProject } from "./project-view";
import { createProjectsApi } from "./projects-api";
import { createProviderService, type Environment } from "./provider/provider-service";
import { createProvidersApi } from "./providers-api";
import { createFakeRemoteAdapter } from "./remote/fake-adapter";
import { createOpenTunnelAdapter } from "./remote/opentunnel-adapter";
import type { RemoteAdapter, RemoteAdapterDeps } from "./remote/ports";
import { createRemoteService } from "./remote/remote-service";
import type { RemovalHooks } from "./removal-hooks";
import { createSettingsApi } from "./settings-api";
import { createSkillsApi } from "./skills/skills-api";
import { createStatusTracker } from "./status/status-tracker";
import {
  createTerminalService,
  type TerminalService,
  type TerminalServiceDeps,
} from "./terminals/terminal-service";
import { clockFromEnvironment } from "./timers/scaled-clock";
import { announceTimers, timerProjectIds } from "./timers/timer-ids";
import { createTimerScheduler } from "./timers/timer-scheduler";
import { createTimerToolServices } from "./timers/timer-tool-services";
import { createTimersApi } from "./timers-api";
import { createTitleService } from "./titles/title-service";
import { createUpdateService } from "./updates/update-service";
import { CRASH_LOOP_TEXT, recordStart, startRecordFiles } from "./watchdog/start-record";
import { createWorkspaceService } from "./workspaces/workspace-service";

export interface CoreDependencies {
  readonly env: Environment;
  readonly now: () => number;
  /** Runs the GitHub CLI; the default execs the `gh` found on the PATH at startup. */
  readonly runGh: RunGh;
  /** Absolute path of `gh` (for the git credential helper); `undefined` when it is not installed. */
  readonly ghPath: string | undefined;
  /** The agent store failed for good: the process cannot continue. */
  readonly onFatal: (error: unknown) => void;
  /** The PTY daemon behind terminals; tests pass a fake with no PTY. */
  readonly terminalDaemon: TerminalDaemon;
  /** Tests replace the terminal service to watch the hooks. Default: `createTerminalService`. */
  /** Tests replace the tunnel with the fake adapter. Default: the OpenTunnel adapter. */
  readonly remoteAdapter?: (deps: RemoteAdapterDeps) => RemoteAdapter;
  readonly terminalService?: (deps: TerminalServiceDeps) => TerminalService;
}

const exitAfterLogging = (error: unknown) => {
  console.error("tau: the agent store failed", error);
  process.exit(1);
};

/** Interrupted runs resume at open; with no models yet they would fail `no_model` and stay aborted. */
const MODELS_READY_TIMEOUT_MS = 15_000;

/** Any live task or unsettled submission may start a model run on resume; a normal start has none and must not wait. */
async function hasInterruptedWork(harness: Harness): Promise<boolean> {
  const { tasks, submissions } = await harness.inspect(BACKGROUND);
  return tasks.length > 0 || submissions.length > 0;
}

export const defaultCoreDependencies = (): CoreDependencies => {
  const ghPath = resolveGhPath(process.env);
  return {
    env: process.env,
    now: Date.now,
    runGh: createRunGh(ghPath, process.env),
    ghPath,
    onFatal: exitAfterLogging,
    terminalDaemon: createLocalTerminalDaemon(process.env),
    ...(process.env.TAU_FAKE_REMOTE === "1" && { remoteAdapter: () => createFakeRemoteAdapter() }),
  };
};

export async function createCoreWith(options: CreateCoreOptions, deps: CoreDependencies): Promise<Core> {
  const home = await openDataHome(options.home);
  const lock = await acquireHomeLock(home.lockFile);
  try {
    if (options.cliEntry !== undefined) await writeTauShim(home.root, process.execPath, options.cliEntry);
    const changes = createChangeEmitter();
    const defaultProjectsFolder = join(home.root, "projects");
    const settings = createSettingsStore(home.settingsFile, defaultProjectsFolder);
    const sessionLookup: { current: ConversationOfSession } = { current: async () => undefined };
    const approvals = createApprovals({
      settings,
      changes,
      conversationOfSession: (piSessionId) => sessionLookup.current(piSessionId),
    });
    const connectorTools = createConnectorToolServices();
    const provider = createProviderService({
      credentialsFile: home.credentialsFile,
      faux: options.faux ?? false,
      env: deps.env,
      changes,
      settings,
      approvals,
      observed: connectorTools.observed,
    });
    const status = createStatusTracker({ changes, now: deps.now });
    const toolServices = createToolServicesRef();
    const harness = await openAgentHarness({
      registry: createAgentRegistry(toolServices, undefined, home.root),
      storage: await openSqliteStorage(home.agentDatabase),
      models: provider.models,
      onReport: (error) => console.error("tau: agent report", error),
      beforeResume: async (opened) => {
        status.attach(opened);
        if (await hasInterruptedWork(opened)) await provider.ready(MODELS_READY_TIMEOUT_MS);
      },
    });
    harness.closed.then((end) => {
      if (end.reason === "failed") deps.onFatal(end.error);
    });

    const projects = createProjectStore(harness);
    sessionLookup.current = createConversationOfSession(harness);
    const connectorOffering = createConnectorOffering({
      harness,
      settings: async () => (await settings.get()).claudeConnectors,
      connectors: () => provider.claudeConnectors(),
    });
    resyncWhenConnectorsChange(changes, provider, connectorOffering);
    const conversations = createConversationStore(harness, async (id) => (await projects.require(id)).path, {
      offering: connectorOffering,
      beforeAbort: (id) => approvals.denyAll(id),
    });
    const shared = { projects, conversations, changes, now: deps.now };
    const titles = createTitleService({ harness, models: provider.models, settings, changes });
    const icons = createIconService({ iconsDirectory: home.iconsDirectory, now: deps.now });
    const present = createPresentProject(icons, settings);
    const githubRef: { current?: ReturnType<typeof createGithubService> } = {};
    const allowFileClones = (options.faux ?? false) && deps.env.TAU_ALLOW_FILE_CLONES === "1";
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
    const terminals = (deps.terminalService ?? createTerminalService)({
      daemon: deps.terminalDaemon,
      changes,
      conversations,
      home: home.root,
      env: deps.env,
      now: deps.now,
    });
    const workspaces = createWorkspaceService({
      home: home.root,
      closeTerminalsOf: (conversationId) => terminals.closeAllOf(conversationId),
      conversations,
      runGh: deps.runGh,
      announce: (projectId) => changes.emit({ resource: "conversations", projectId }),
    });
    const forker = createConversationForker(harness, conversations);
    const checkpoints = createCheckpointService({ home: home.root, conversations, forker });
    status.onRunEnded(({ conversationId }) => checkpoints.snapshotAfter(conversationId, ""));
    forker.onForked(async (fork) => changes.emit({ resource: "conversations", projectId: fork.projectId }));
    const notifications = harnessNotificationSubmitter(harness);
    const clock = clockFromEnvironment(deps.env, options.faux ?? false);
    const announceTimerChange = announceTimers(changes);
    const scheduler = createTimerScheduler({
      harness,
      notifications,
      clock,
      projectIds: timerProjectIds(harness),
      announce: announceTimerChange,
    });
    const timersApi = createTimersApi({
      harness,
      conversations,
      now: clock.now,
      projectIds: timerProjectIds(harness),
      announce: announceTimerChange,
    });
    const processes = createProcessService({
      home: home.root,
      notifications,
      emitChange: (conversationId) => changes.emit({ resource: "processes", conversationId }),
    });
    const liveWork = createLiveWork({ harness, processes, approvals });
    const goals = createGoalService({
      harness,
      conversations,
      notifications,
      scheduler,
      liveWork,
      ask: createJudgeModel({ harness, models: provider.models, settings }),
      changes,
      now: deps.now,
      checkinMinutes: checkinMinutesFrom(deps.env.TAU_GOAL_CHECKIN_MINUTES),
    });
    status.onRunEnded((end) => goals.onRunEnded(end));
    const mcp = createMcpService({
      settingsServers: () => settings.mcpServers(),
      projectPathOf: async (id) => (await projects.require(id)).path,
      emitChange: () => changes.emit({ resource: "mcp" }),
    });
    toolServices.set({
      processes,
      mcp,
      notifications,
      scheduler,
      liveWork,
      claudeConnectors: {
        observed: connectorTools.observed,
        interruptConversation: (piSessionId) => provider.interruptClaudeCliThread(piSessionId),
      },
      timers: createTimerToolServices(harness, clock, announceTimerChange),
      subagents: {
        agentTypes: createAgentTypeLoader(),
        resolveModelAlias,
        fastModel: async () => (await settings.get()).fastModel ?? undefined,
        clampThinking: (ref, level) => clampThinkingFor(provider.models, ref, level),
        projectOf: (id) => projects.require(id),
        removeSubagent: (id, force) => subagentRemover.remove(id, force),
        workspaces,
        connectorOffering,
      },
      connectedModels: async () =>
        (await provider.listModels()).map(({ provider: id, modelId }) => ({ provider: id, modelId })),
    });
    const closeClaudeCliThread = async (id: string) => {
      const sessionId = await providerSessionOf(harness, id);
      if (sessionId) await provider.closeClaudeCliThread(sessionId).catch(() => undefined);
    };
    const removalHooks: RemovalHooks = {
      unmergedWork: (thread) => workspaces.unmergedWork(thread),
      onConversationRemoved: [
        (thread) => terminals.onConversationRemoved(thread),
        (thread) => closeClaudeCliThread(thread.id),
        (thread) => workspaces.onConversationRemoved(thread),
        (thread) => checkpoints.onConversationRemoved(thread),
        (thread) => processes.onConversationRemoved(thread),
        async (thread) => goals.onConversationRemoved(thread.id),
        (thread) => timersApi.onConversationRemoved(thread),
      ],
      onProjectRemoved: [(id) => workspaces.onProjectRemoved(id)],
    };
    const removal = createConversationRemoval({
      conversations,
      hooks: removalHooks,
      now: deps.now,
      announce: (projectId) => changes.emit({ resource: "conversations", projectId }),
    });
    const subagentRemover = createSubagentRemover({ conversations, hooks: removalHooks, removal });
    const archivedCleanup = createArchivedCleanup({
      conversations,
      removal,
      hooks: removalHooks,
      listArchived: async () => {
        const perProject = await Promise.all(
          (await projects.list()).map((project) => conversations.list(project.id)),
        );
        return perProject.flat().filter((thread) => thread.archivedAt !== null);
      },
      now: deps.now,
      announce: (projectId) => changes.emit({ resource: "conversations", projectId }),
    });
    const recovery = createConversationRecovery({ harness, conversations, changes });
    await status.recoverAtStartup();
    await clones.recoverAtStartup();
    await recovery.recoverAtStartup();
    await processes.reapStaleAtStartup();
    await goals.recoverAtStartup();
    await scheduler.start();
    archivedCleanup.start();

    const startRecord = recordStart(startRecordFiles(home.root), deps.now());
    console.log(`tau: previous run ended: ${startRecord.previousExit.reason}`);
    const tunnel = (deps.remoteAdapter ?? createOpenTunnelAdapter)({
      directory: home.remoteDirectory,
      tunnelTarget: options.tunnelTarget ?? (() => Promise.reject(new Error("No tunnel listener"))),
      now: deps.now,
    });
    await migrateHubFile(home.root);
    await migrateSummaryDirectory(home.root);
    const identityStore = createNodeIdentityStore(home.identityFile, deps.now);
    let identity = await identityStore.load();
    const access = createAccess({
      store: createFileDeviceStore(home.devicesFile),
      now: deps.now,
      randomBytes: (size) => randomBytes(size),
      remoteUrl: () => tunnel.status().url,
      announce: () => changes.emit({ resource: "devices" }),
      nodeId: () => identity.nodeId,
    });
    const updates = createUpdateService({
      currentVersion: options.currentVersion,
      latestVersion: options.latestVersion,
      now: deps.now,
      autoStart: options.autoStartUpdates,
      updater: options.updater,
      listConversations: async () =>
        (await Promise.all((await projects.list()).map((project) => conversations.list(project.id)))).flat(),
    });
    // `TAU_NODE_NAME` names this node instead of the host name (tests and scratch nodes on one machine).
    const nodeName = deps.env.TAU_NODE_NAME || undefined;
    const nodes = createNodes({
      directory: home.nodesDirectory,
      now: deps.now,
      changes,
      access,
      peers: createFilePeersStore(home.peersFile),
      identity: () => identity,
      resetIdentity: async () => {
        await identityStore.reset();
        identity = await identityStore.load();
      },
      // `TAU_FAKE_PROTOCOL_VERSION` lets the e2e run a node that speaks another protocol ("update required").
      protocolVersion: process.env.TAU_FAKE_PROTOCOL_VERSION || PROTOCOL_VERSION,
      linkProtocol: LINK_PROTOCOL,
      tauVersion: options.currentVersion,
      ...(nodeName && { name: nodeName }),
    });

    const selfThreads = createSelfThreadCount(async () => {
      const perProject = await Promise.all(
        (await projects.list()).map((project) => conversations.list(project.id)),
      );
      return perProject.flat().filter((thread) => thread.archivedAt === null).length;
    }, changes);
    const directory = createDirectory({
      expelledFile: home.expelledFile,
      now: deps.now,
      changes,
      identity: () => identity,
      nodes,
      home: home.root,
      self: () => ({
        name: nodeName ?? hostname().replace(/\.local$/i, ""),
        os: `${process.platform} ${process.arch}`,
        tauVersion: options.currentVersion,
        protocolVersion: process.env.TAU_FAKE_PROTOCOL_VERSION || PROTOCOL_VERSION,
        linkProtocol: LINK_PROTOCOL,
        threadCount: selfThreads.current(),
      }),
    });

    const remote = createRemoteService({
      adapter: tunnel,
      settings,
      access,
      changes,
      forgetNodes: () => nodes.reset(),
    });

    void remote
      .start({
        enabled: (await settings.get()).remote.enabled,
        holdReason: startRecord.crashLoop ? CRASH_LOOP_TEXT : undefined,
      })
      .catch((error: unknown) => console.error("tau: remote access did not start", error));

    let closing: Promise<void> | undefined;
    return {
      access,
      nodes: {
        ...nodes,
        directory: directory.directory,
        expulsions: directory.expulsions,
        group: directory.group,
        async disconnect(id) {
          await nodes.disconnect(id);
          directory.forgetPeer(id);
        },
        async forget(id) {
          await nodes.forget(id);
          directory.forgetPeer(id);
        },
        async resetIdentity() {
          await nodes.resetIdentity();
          await directory.reset();
        },
        async self() {
          const removed = directory.removal();
          return { ...(await nodes.self()), ...(removed ? { removed } : {}) };
        },
      },
      remote: remote.api,
      fs: { suggestDirectories },
      settings: createSettingsApi({
        settings,
        provider,
        codeFolder: { settings, defaultProjectsFolder, homeDirectory: homedir() },
        onProjectsFolderChanged: () => github.invalidateScan(),
        onClaudeConnectorsChanged: () => connectorOffering.resyncAll(),
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
        harness,
        removal,
        archivedCleanup,
        closeClaudeCliThread,
        closeTerminalsOf: (conversationId) => terminals.closeAllOf(conversationId),
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
        background: (id, callId) => processes.background(id, callId),
      },
      terminals: terminals.api,
      approvals: createApprovalsApi(approvals, conversations),
      timers: timersApi,
      goals: createGoalsApi(goals),
      mcp: createMcpApi({ settings, mcp, changes }),
      updates: {
        status: () => updates.status(),
        refresh: () => updates.refresh(),
        start: (body) => updates.start(body),
      },
      onChange: (listener) => changes.subscribe(listener),
      close() {
        closing ??= (async () => {
          changes.clear();
          updates.stop();
          await remote.close();
          await archivedCleanup.stop();
          clones.stopAll();
          try {
            await goals.close();
            await scheduler.close();
            await processes.stopAll();
            await terminals.close();
            await status.settled();
            await mcp.closeAll();
            await harness.close(BACKGROUND);
            await provider.close();
            await github.settled();
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
