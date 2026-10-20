import type { ConversationWatcher, UpdateStartBody } from "@tau/protocol";
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
import { createFakeCore, type FakeCore } from "@tau/testkit";
import { readSummaryCache, writeSummaryCache } from "@/nodes/summary-cache";
import { openFakeStream } from "./fake-terminal-stream";
import type { LiveHandlers, LiveSocket, RouteRequest, RouteResponse, Transport } from "./types";

type Input = {
  params: {
    id: string;
    sid: string;
    itemId: string;
    toolUseId: string;
    callId: string;
    cid: string;
    name: string;
  };
  query: { projectId?: string; path: string; tail?: string; force?: "true" | "false" };
  body: Record<string, unknown>;
};

const FAKE_UPDATE_STEP_MS = 3_000;

/** Moves a started fake update through installing → restarting → done, one step every few seconds. */
function walkFakeUpdate(core: Core): void {
  const control = (core as Partial<FakeCore>).updatesControl;
  const timer = setInterval(() => {
    if (!control?.advance()) clearInterval(timer);
  }, FAKE_UPDATE_STEP_MS);
}

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
  backgroundToolCall: (core, { params }) => core.processes.background(params.id, params.callId),
  stopToolCall: (core, { params }) => core.processes.stopToolCall(params.id, params.callId),
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
  setResources: (core, { body }) => core.settings.setResources(body as never),
  setCompaction: (core, { body }) => core.settings.setCompaction(body as never),
  getResourceSupport: (core) => core.settings.resourceSupport(),
  getResourceActivity: (core) => core.settings.resourceActivity(),
  stopResourceCommand: (core, { params }) => core.settings.stopResourceCommand(params.id),
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
    return redeemed.kind === "node"
      ? { deviceId: redeemed.deviceId, secret: redeemed.secret, nodeId: redeemed.nodeId }
      : { deviceId: redeemed.deviceId };
  },
  listNodes: (core) => core.nodes.list(),
  renameNode: (core, { params, body }) => core.nodes.rename(params.id, body.name as string),
  getNodeSummary: async (core, { params }) => {
    const summary = await core.nodes.readSummary(params.id);
    if (!summary) throw new AppError("not_found", "No summary for this node.");
    return summary;
  },
  disconnectNode: (core, { params }) => core.nodes.disconnect(params.id),
  getNodeSelf: (core) => core.nodes.self(),
  forgetNode: (core, { params }) => core.nodes.forget(params.id),
  getNodeDirectory: (core) => core.nodes.directory(),
  listExpulsions: (core) => core.nodes.expulsions(),
  removeNode: async (core, { params, body }) => {
    await core.nodes.group.createExpel(params.id, body.confirm as string);
  },
  rotateAccess: async (core, { body }) => ({
    revoked: await core.access.rotate({ keep: (body.keep as string[] | undefined) ?? [] }),
    token: "fake-rotated-token",
  }),
  resetNodeIdentity: (core) => core.nodes.resetIdentity(),
  setSetupSkipped: (core, { body }) => core.settings.setSetupSkipped(body.skipped as boolean),
  getUpdateStatus: (core) => core.updates.status(),
  refreshUpdateStatus: (core) => core.updates.refresh(),
  startUpdate: async (core, { body }) => {
    const status = await core.updates.start(body as UpdateStartBody);
    walkFakeUpdate(core);
    return status;
  },
  linkNode: async () => {
    throw new AppError("not_found", "The node link is a socket, not an HTTP call.");
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

/** `?fake=ready&seed=rich`: a crowded sidebar — many projects, threads, subagents, a goal, a loop and archived threads. */
const RICH_THREADS: { name: string; path: string; threads: string[] }[] = [
  {
    name: "tau",
    path: "/Users/demo/src/tau",
    threads: [
      "Fix sidebar selected color",
      "Release 0.10 checklist",
      "Flaky e2e on CI",
      "Refactor node sync",
      "Onboarding empty states",
      "Dark mode contrast pass",
    ],
  },
  {
    name: "website",
    path: "/Users/demo/other",
    threads: ["New landing hero", "Docs IA rework", "Blog: 0.9 launch notes", "Fix mobile nav overlap"],
  },
  {
    name: "api",
    path: "/Users/demo/src/sandbox",
    threads: [
      "Rate limit tuning",
      "Webhook retries",
      "Add request id tracing",
      "Cache invalidation bug",
      "Postgres index review",
    ],
  },
  {
    name: "docs",
    path: "/Users/demo/Documents",
    threads: ["Settings reference", "CLI install guide", "Old pricing draft"],
  },
  {
    name: "infra",
    path: "/Users/demo/src/scratch",
    threads: ["Spike: CRDT sync", "Backup retention policy", "Staging env drift", "Log volume alert"],
  },
  {
    name: "playground",
    path: "/Users/demo/src",
    threads: ["Try agentic loops", "Prompt scratchpad", "Model comparison", "Icon experiments"],
  },
];

async function seedRichState(core: Core): Promise<void> {
  const byTitle = new Map<string, string>();
  for (const { name, path, threads } of RICH_THREADS) {
    const project = await core.projects.add({ path, name });
    for (const [index, title] of threads.entries()) {
      const thread = await core.conversations.start({
        projectId: project.id,
        text: title,
        requestId: `rich-${project.id}-${index}`,
      });
      await core.conversations.rename(thread.id, title);
      byTitle.set(title, thread.id);
    }
  }
  const send = (title: string, text: string, n: number) => {
    const id = byTitle.get(title);
    if (!id) return Promise.resolve();
    return core.conversations.send(id, { text, requestId: `rich-send-${n}` });
  };
  await send("Fix sidebar selected color", "agent explore the accent tokens", 1);
  await send("Fix sidebar selected color", "agent probe the hover states", 2);
  await send("Rate limit tuning", "agent benchmark the limiter", 3);
  await send("New landing hero", "agent draft three hero variants", 4);
  const goal = byTitle.get("Release 0.10 checklist");
  if (goal) await core.goals.set(goal, "Ship the 0.10 release");
  const loop = byTitle.get("Flaky e2e on CI");
  if (loop) await core.timers.loop(loop, { every: "1h", prompt: "Check CI status and report" });
  for (const title of ["Spike: CRDT sync", "Old pricing draft"]) {
    const id = byTitle.get(title);
    if (id) await core.conversations.archive(id, true);
  }
}

/** A fake node gets a thread of its own, so its sidebar group and its offline cache have something to show. */
async function seedNodeThread(core: Core, title: string): Promise<void> {
  const [project] = await core.projects.list();
  if (!project) return;
  const thread = await core.conversations.start({
    projectId: project.id,
    text: title,
    requestId: `seed-${title}`,
  });
  await core.conversations.rename(thread.id, title);
}

/** What a browser would have seen of an offline fake node while it was online: written once, like the hub's `summary.json`. */
async function cacheOfflineSummaries(hub: FakeCore): Promise<void> {
  for (const node of await hub.nodes.list()) {
    const core = hub.nodeCores.get(node.id);
    if (node.status !== "offline" || !core || readSummaryCache(node.id)) continue;
    const [projects, threads] = await Promise.all([core.projects.list(), core.conversations.listAll()]);
    writeSummaryCache(node.id, {
      savedAt: node.lastSeenAt,
      projects: projects.map(({ id, name }) => ({ id, name })),
      threads: threads.map(({ id, projectId, title, updatedAt }) => ({ id, projectId, title, updatedAt })),
    });
  }
}

/** `?fake=update` (behind, runs), `update-fail`, `update-manual` (manual command): ready, 0.9.0 with 0.10.12 published. */
function updateScenarioOf(name: string | null): Parameters<typeof createFakeCore>[0] | undefined {
  const base = { currentVersion: "0.9.0", latestVersion: "0.10.12" };
  const manual = {
    mode: "manual",
    command: "tau update",
    reason: "it was started from a custom path",
  } as const;
  if (name === "update") return base;
  if (name === "update-fail") return { ...base, updates: { failUpdate: true } };
  if (name === "update-manual") return { ...base, updates: { install: manual } };
  return undefined;
}

let hub: Promise<FakeCore> | undefined;

/**
 * One fake hub per page, shared by the local transport and every node transport:
 * `?fake=ready` starts past setup with remote on (`&remote=off` starts with it off), and `&nodes=2`
 * (or `&nodes`) links the two fake nodes (`Homelab` online, `Work laptop` offline), with or without
 * `fake=ready`: `?fake=setup&nodes` is an unconfigured local node that knows peers.
 */
function fakeHub(): Promise<FakeCore> {
  hub ??= (async () => {
    const params = new URLSearchParams(window.location.search);
    const scenario = updateScenarioOf(params.get("fake"));
    const ready = params.get("fake") === "ready" || scenario !== undefined;
    const remote = ready && params.get("remote") !== "off";
    const nodes = params.has("nodes");
    const core = createFakeCore({ configured: ready, remote, nodes, ...scenario });
    if (ready) await seedReadyState(core);
    if (ready && params.get("seed") === "rich") await seedRichState(core);
    for (const [nodeId, node] of core.nodeCores) {
      await seedReadyState(node);
      const name = (await core.nodes.list()).find((listed) => listed.id === nodeId)?.name ?? "Node";
      await seedNodeThread(node, `${name} thread`);
    }
    await cacheOfflineSummaries(core);
    return core;
  })();
  return hub;
}

const OFFLINE = "This node is offline.";

function fakeNodeCore(core: FakeCore, nodeId: string): Core {
  const nodeCore = core.nodeCores.get(nodeId);
  if (!nodeCore) throw new AppError("not_found", `No node ${nodeId}.`);
  return nodeCore;
}

/** The transport of one fake node: its own fake core, or `not_found` while the hub lists it offline. */
export async function createDefaultFakeNodeTransport(nodeId: string): Promise<Transport> {
  const core = await fakeHub();
  const nodeCore = fakeNodeCore(core, nodeId);
  const inner = createFakeTransport(nodeCore);
  const listed = async () => (await core.nodes.list()).find((node) => node.id === nodeId);
  return {
    async request(name, input) {
      const node = await listed();
      if (node?.status !== "online") throw new AppError("not_found", OFFLINE);
      return inner.request(name, input);
    },
    live: inner.live,
    openStream: inner.openStream,
  };
}

/** The in-browser backend of `VITE_FAKE=1`. See `fakeHub` for the URL switches. */
export async function createDefaultFakeTransport(): Promise<Transport> {
  return createFakeTransport(await fakeHub());
}
