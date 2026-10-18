import type { ConversationWatcher } from "@tau/protocol";
import {
  AppError,
  type Change,
  type ClientFrame,
  type Core,
  changedFrame,
  iconCandidateUrl,
  isAppError,
  type JsonRouteName,
  PROCESS_LOG_TAIL_DEFAULT,
  RETIRED_OPS,
} from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
import { openFakeStream } from "./fake-terminal-stream";
import type { LiveHandlers, LiveSocket, RouteRequest, RouteResponse, Transport } from "./types";

type Input = {
  params: { id: string; sid: string; itemId: string; toolUseId: string; cid: string; name: string };
  query: { projectId?: string; path: string; tail?: string; force?: "true" | "false" };
  body: Record<string, unknown>;
};

/** The fake browser is the first device linked: the Devices list marks it "This device". */
export const FAKE_CURRENT_DEVICE_ID = "device-1";

type Handlers = { [N in JsonRouteName]: (core: Core, input: Input) => Promise<unknown> };

const handlers: Handlers = {
  suggestDirectories: (core, { body }) => core.fs.suggestDirectories(body as never),
  getSettings: (core) => core.settings.get(),
  setDefaultModel: (core, { body }) => core.settings.setDefaultModel(body as never),
  getSuggestedCodeFolder: (core) => core.settings.suggestedCodeFolder(),
  getGithubStatus: (core) => core.github.status(),
  listGithubRepos: (core) => core.github.repos(),
  refreshGithubRepos: (core) => core.github.refreshRepos(),
  useGithubRepo: (core, { body }) => core.github.use(body as never),
  setProjectIcon: (core, { params, body }) =>
    core.projects.setIcon(
      params.id,
      Uint8Array.from(atob(body.png as string), (char) => char.charCodeAt(0)),
    ),
  resetProjectIcon: (core, { params }) => core.projects.setIcon(params.id, null),
  listIconCandidates: async (core, { params }) =>
    (await core.projects.iconCandidates(params.id)).map(({ name }) => ({
      name,
      url: iconCandidateUrl(params.id, name),
    })),
  listProviders: (core) => core.providers.list(),
  setProviderKey: (core, { params, body }) =>
    core.providers.setApiKey(params.id as never, body.key as string),
  disconnectProvider: (core, { params }) => core.providers.disconnect(params.id as never),
  acknowledgeClaudeCli: (core) => core.providers.acknowledgeClaudeCli(),
  refreshClaudeCli: (core) => core.providers.refreshClaudeCli(),
  installClaudeCliSdk: (core) => core.providers.installClaudeCliSdk(),
  startLogin: (core) => core.providers.startLogin("openai"),
  getLogin: (core, { params }) => core.providers.login(params.sid),
  submitLoginUrl: (core, { params, body }) => core.providers.submitLoginUrl(params.sid, body.url as string),
  cancelLogin: (core, { params }) => core.providers.cancelLogin(params.sid),
  listModels: (core) => core.models.list(),
  listSkills: (core, { query }) => core.skills.list(query?.projectId ?? null),
  suggestProjectFiles: (core, { params, body }) =>
    core.projects.suggestFiles(params.id, body.query as string),
  compactConversation: (core, { params, body }) => core.conversations.compact(params.id, body as never),
  setDefaultThinking: (core, { body }) => core.settings.setDefaultThinkingLevel(body.thinkingLevel as never),
  setFastThinking: (core, { body }) => core.settings.setFastThinkingLevel(body.thinkingLevel as never),
  setFastModel: (core, { body }) => core.settings.setFastModel(body.model as never),
  setProjectsFolder: (core, { body }) => core.settings.setProjectsFolder(body.path as string),
  cloneProject: (core, { body }) => core.projects.clone(body as never),
  retryClone: (core, { params }) => core.projects.retryClone(params.id),
  listProjects: (core) => core.projects.list(),
  addProject: (core, { body }) => core.projects.add(body as never),
  setProjectFolder: (core, { params, body }) => core.projects.setFolder(params.id, body.path as string),
  renameProject: (core, { params, body }) => core.projects.rename(params.id, body.name as string),
  removeProject: (core, { params }) => core.projects.remove(params.id),
  listConversations: (core, { params }) => core.conversations.list(params.id),
  listAllConversations: (core) => core.conversations.listAll(),
  startConversation: (core, { body }) => core.conversations.start(body as never),
  renameConversation: (core, { params, body }) => core.conversations.rename(params.id, body.title as string),
  sendMessage: (core, { params, body }) => core.conversations.send(params.id, body as never),
  abortConversation: (core, { params }) => core.conversations.abort(params.id),
  archiveConversation: (core, { params, body }) =>
    core.conversations.archive(params.id, body.archived as boolean),
  deleteArchivedConversations: (core, { body }) =>
    core.conversations.deleteArchived(body as { force: boolean }),
  removeConversation: (core, { params, query }) =>
    core.conversations.remove(params.id, { force: query?.force === "true" }),
  configureConversation: (core, { params, body }) => core.conversations.configure(params.id, body as never),
  retryConversation: (core, { params, body }) => core.conversations.retry(params.id, body as never),
  stopAgent: (core, { params }) => core.conversations.stopAgent(params.id),
  forkConversation: (core, { params, body }) => core.conversations.fork(params.id, body.entryId as string),
  rewindPreview: (core, { params, body }) =>
    core.conversations.rewindPreview(params.id, body.entryId as string),
  rewindConversation: (core, { params, body }) =>
    core.conversations.rewind(params.id, body.entryId as string),
  cancelQueued: (core, { params }) => core.conversations.cancelQueued(params.id, params.itemId),
  listCheckpoints: (core, { params }) => core.conversations.checkpoints(params.id),
  getCheckpointDiff: async (core, { params, query }) => ({
    diff: await core.conversations.checkpointDiff(params.id, params.cid, query.path),
  }),
  getWorkspace: (core, { params }) => core.workspaces.status(params.id),
  mergeWorkspace: (core, { params }) => core.workspaces.merge(params.id),
  createPullRequest: (core, { params }) => core.workspaces.createPullRequest(params.id),
  removeWorkspace: (core, { params, query }) => core.workspaces.remove(params.id, query?.force === "true"),
  listProcesses: (core, { params }) => core.processes.list(params.id),
  getProcessLogs: async (core, { params, query }) => ({
    logs: await core.processes.logs(params.id, query?.tail ? Number(query.tail) : PROCESS_LOG_TAIL_DEFAULT),
  }),
  stopProcess: (core, { params }) => core.processes.stop(params.id),
  getTerminalsAvailable: async (core) => ({ available: await core.terminals.available() }),
  listTerminals: (core, { params }) => core.terminals.list(params.id),
  openTerminal: (core, { params, body }) => core.terminals.open(params.id, body as never),
  closeTerminal: (core, { params }) => core.terminals.close(params.id),
  listTimers: (core, { params }) => core.timers.list(params.id),
  deleteTimer: (core, { params }) => core.timers.delete(params.id),
  startLoop: (core, { params, body }) => core.timers.loop(params.id, body as never),
  stopLoop: (core, { params }) => core.timers.stopLoop(params.id),
  getGoal: (core, { params }) => core.goals.get(params.id),
  setGoal: (core, { params, body }) => core.goals.set(params.id, body.condition as string),
  clearGoal: (core, { params }) => core.goals.clear(params.id),
  listMcpServers: (core, { query }) => core.mcp.servers(query?.projectId ?? null),
  saveMcpServer: (core, { params, body }) => core.mcp.save({ ...body, name: params.name } as never),
  removeMcpServer: (core, { params }) => core.mcp.remove(params.name),
  setMessageMode: (core, { body }) => core.settings.setMessageMode(body.mode as never),
  setWorkspaceDefault: (core, { body }) => core.settings.setWorkspaceDefault(body.mode as never),
  setClaudeConnectors: (core, { body }) => core.settings.setClaudeConnectors(body as never),
  listApprovals: (core, { params }) => core.approvals.list(params.id),
  getHealth: async () => ({ ok: true }),
  getRemoteStatus: (core) => core.remote.status(),
  enableRemote: (core) => core.remote.enable(),
  disableRemote: (core) => core.remote.disable(),
  recreateRemote: (core) => core.remote.recreate(),
  listDevices: (core) => core.access.listDevices(FAKE_CURRENT_DEVICE_ID),
  renameDevice: (core, { params, body }) => core.access.renameDevice(params.id, body.name as string),
  revokeDevice: (core, { params }) => core.access.revokeDevice(params.id),
  signOutAllDevices: (core) => core.access.signOutAll(),
  mintPairing: (core, { query }) => core.access.mintPairing((query ?? {}) as never),
  redeemPairing: async (core, { body }) => {
    const redeemed = await core.access.redeemPairing({
      code: body.code as string,
      deviceName: body.deviceName as string,
      peer: "fake",
    });
    return redeemed.kind === "machine"
      ? { deviceId: redeemed.deviceId, secret: redeemed.secret }
      : { deviceId: redeemed.deviceId };
  },
  decideApproval: (core, { params, body }) =>
    core.approvals.decide(params.id, params.toolUseId, body.decision as never),
};

function detach<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function fakeLiveSocket(core: Core, live: LiveHandlers): LiveSocket {
  const watchers = new Map<string, ConversationWatcher>();
  let closed = false;
  const stopChanges = core.onChange((change: Change) => live.onFrame(changedFrame(change)));
  queueMicrotask(() => live.onOpen());

  const subscribe = async (conversationId: string) => {
    if (watchers.has(conversationId)) return;
    try {
      const watcher = await core.conversations.watch(conversationId, async (ops) => {
        if (!closed) live.onFrame({ type: "ops", conversationId, ops: detach(ops) });
      });
      watchers.set(conversationId, watcher);
    } catch (error) {
      if (isAppError(error)) live.onFrame({ type: "ops", conversationId, ops: RETIRED_OPS });
    }
  };

  const unsubscribe = async (conversationId: string) => {
    await watchers.get(conversationId)?.stop();
    watchers.delete(conversationId);
  };

  return {
    send(frame: ClientFrame) {
      void (frame.type === "subscribe" ? subscribe(frame.conversationId) : unsubscribe(frame.conversationId));
    },
    close() {
      closed = true;
      stopChanges();
      for (const watcher of watchers.values()) void watcher.stop();
      watchers.clear();
    },
  };
}

export function createFakeTransport(core: Core): Transport {
  return {
    async request<N extends JsonRouteName>(name: N, input: RouteRequest<N>) {
      try {
        const result = await handlers[name](core, input as unknown as Input);
        return detach(result) as RouteResponse<N>;
      } catch (error) {
        throw isAppError(error) ? new AppError(error.code, error.message) : error;
      }
    },
    live: { open: (live) => fakeLiveSocket(core, live) },
    openStream: (path, handlers) => openFakeStream(core, path, handlers),
  };
}

const READY_PROJECT = "/Users/demo/project";

async function seedReadyState(core: Core): Promise<void> {
  await core.providers.setApiKey("openrouter", "fake");
  const [model] = await core.models.list();
  if (model) await core.settings.setDefaultModel({ provider: model.provider, modelId: model.modelId });
  await core.projects.add({ path: READY_PROJECT });
}

/** The in-browser backend of `VITE_FAKE=1`. Add `?fake=ready` to the URL to start past setup, with a project. */
export async function createDefaultFakeTransport(): Promise<Transport> {
  const ready = new URLSearchParams(window.location.search).get("fake") === "ready";
  const core = createFakeCore({ configured: ready });
  if (ready) await seedReadyState(core);
  return createFakeTransport(core);
}
