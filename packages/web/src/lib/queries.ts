import {
  keepPreviousData,
  type QueryClient,
  type QueryFunctionContext,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type Approval,
  type ApprovalDecision,
  type ClaudeConnectorSettings,
  type CompactionSettings,
  type ConversationSummary,
  DEFAULT_SANDBOX_SETTINGS,
  type MintPairingInput,
  type ProviderId,
  type RemoteStatus,
  type ResourceSettings,
  type SandboxSettings,
  type Settings,
  type UpdateStatus,
} from "@tau/protocol";
import { useCallback } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { isJobActive } from "@/lib/updates";
import { useApi } from "@/nodes/node-context";
import type { Api } from "./api";

const RUNTIMES_STALE_MS = 60_000;

export const queryKeys = {
  providers: ["providers"] as const,
  settings: ["settings"] as const,
  models: ["models"] as const,
  runtimes: ["runtimes"] as const,
  skills: (projectId: string | null) => ["skills", projectId] as const,
  projects: ["projects"] as const,
  conversations: (projectId: string) => ["conversations", projectId] as const,
  allConversations: ["conversations", "all"] as const,
  githubStatus: ["github", "status"] as const,
  githubRepos: ["github", "repos"] as const,
  suggestedCodeFolder: ["settings", "suggested-code-folder"] as const,
  voiceOptions: ["voice", "options"] as const,
  pathSuggestions: (prefix: string) => ["fs", "suggest", prefix] as const,
  iconCandidates: (projectId: string) => ["projects", projectId, "icon-candidates"] as const,
  workspace: (conversationId: string) => ["workspace", conversationId] as const,
  handoffPreview: (conversationId: string) => ["handoff-preview", conversationId] as const,
  checkpoints: (conversationId: string) => ["checkpoints", conversationId] as const,
  processes: (conversationId: string) => ["processes", conversationId] as const,
  allProcesses: ["processes"] as const,
  resourceSupport: ["resources", "support"] as const,
  resourceActivity: ["resources", "activity"] as const,
  timers: (conversationId: string) => ["timers", conversationId] as const,
  approvals: (conversationId: string) => ["approvals", conversationId] as const,
  goal: (conversationId: string) => ["goal", conversationId] as const,
  processLogs: (processId: string, tail?: number) => ["process-logs", processId, tail ?? null] as const,
  mcpServers: (projectId: string | null) => ["mcp", "servers", projectId] as const,
  allMcpServers: ["mcp"] as const,
  remoteStatus: ["remote"] as const,
  devices: ["devices"] as const,
  /** `["nodes"]` is the list of this tau's peers; `["nodes", "self"]` is this tau itself. */
  nodes: ["nodes"] as const,
  nodeSelf: ["nodes", "self"] as const,
  /** The group as this node sees it (neighbours and routed nodes). */
  nodeDirectory: ["nodes", "directory"] as const,
  expulsions: ["nodes", "expulsions"] as const,
  /** This tau's version against the latest published one (the hub's own, never a node's). */
  updateStatus: ["update"] as const,
  /** Another node's data, cached in the hub's client by components outside that node's provider. */
  nodeData: (nodeId: string) => ["node-data", nodeId] as const,
};

export const useProviders = () => {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.providers, queryFn: () => api.providers.list() });
};

export const useSettings = () => {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.settings, queryFn: () => api.settings.get() });
};

export const useProjects = () => {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.projects, queryFn: () => api.projects.list() });
};

export const useModels = () => {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.models, queryFn: () => api.models.list() });
};

/** Which engines this node offers a new thread. A failing or old node just has no answer: callers fall back to Pi. */
export const useRuntimes = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.runtimes,
    queryFn: () => api.runtimes.list(),
    retry: false,
    staleTime: RUNTIMES_STALE_MS,
    enabled,
  });
};

/** What a handoff of this thread would carry and lose; always fresh, never kept after the dialog closes. */
export const useHandoffPreview = (conversationId: string) => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.handoffPreview(conversationId),
    queryFn: () => api.conversations.handoffPreview(conversationId),
    retry: false,
    gcTime: 0,
    staleTime: 0,
  });
};

export const useSkills = (projectId: string | null) => {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.skills(projectId), queryFn: () => api.skills.list(projectId) });
};

export const invalidateProviders = async (queryClient: QueryClient) => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
    queryClient.invalidateQueries({ queryKey: queryKeys.models }),
  ]);
};

export function useSetProviderKey() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, key }: { id: ProviderId; key: string }) => api.providers.setKey(id, key),
    onSuccess: () => invalidateProviders(queryClient),
  });
}

export function useDisconnectProvider() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: ProviderId) => api.providers.disconnect(id),
    onSuccess: () => invalidateProviders(queryClient),
  });
}

export function useAcknowledgeClaudeCli() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.providers.acknowledgeClaudeCli(),
    onSuccess: () => invalidateProviders(queryClient),
  });
}

export function useRefreshClaudeCli() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.providers.refreshClaudeCli(),
    onSuccess: () => invalidateProviders(queryClient),
  });
}

export function useInstallClaudeCliSdk() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.providers.installClaudeCliSdk(),
    onSuccess: () => invalidateProviders(queryClient),
  });
}

export const byActivity = (a: ConversationSummary, b: ConversationSummary): number =>
  b.lastActivityAt - a.lastActivityAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

export const useConversations = (projectId: string) => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.conversations(projectId),
    queryFn: async () => {
      const list = await api.conversations.list(projectId);
      return [...list].sort(byActivity);
    },
  });
};

export const useAllConversations = () => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.allConversations,
    queryFn: async () => {
      const list = await api.conversations.listAll();
      return [...list].sort(byActivity);
    },
  });
};

export const useGithubStatus = () => {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.githubStatus, queryFn: () => api.github.status() });
};

export const useGithubRepos = (enabled: boolean) => {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.githubRepos, queryFn: () => api.github.repos(), enabled });
};

const VOICE_DOWNLOAD_POLL_MS = 2_000;

/** Polls only while the local model is downloading; `null` data means the node predates voice support. */
export const useVoiceOptions = (enabled = true) => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.voiceOptions,
    queryFn: () => api.voice.options(),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.local.state === "downloading" ? VOICE_DOWNLOAD_POLL_MS : false,
  });
};

export const useSuggestedCodeFolder = () => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.suggestedCodeFolder,
    queryFn: () => api.settings.suggestedCodeFolder(),
  });
};

export const usePathSuggestions = (prefix: string, enabled = true) => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.pathSuggestions(prefix),
    queryFn: () => api.fs.suggestDirectories({ prefix }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  });
};

export const useIconCandidates = (projectId: string, enabled = true) => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.iconCandidates(projectId),
    queryFn: () => api.projects.iconCandidates(projectId),
    enabled,
  });
};

export const workspaceStatusOptions = (api: Api, conversationId: string) => ({
  queryKey: queryKeys.workspace(conversationId),
  queryFn: ({ signal }: QueryFunctionContext) => api.workspaces.status(conversationId, { signal }),
  staleTime: 5_000,
});

export const useWorkspaceStatus = (conversationId: string, enabled = true) => {
  const api = useApi();
  return useQuery({ ...workspaceStatusOptions(api, conversationId), enabled });
};

export const checkpointsOptions = (api: Api, conversationId: string) => ({
  queryKey: queryKeys.checkpoints(conversationId),
  queryFn: () => api.conversations.checkpoints(conversationId),
});

export const useCheckpoints = (conversationId: string, enabled = true) => {
  const api = useApi();
  return useQuery({ ...checkpointsOptions(api, conversationId), enabled });
};

export const processesOptions = (api: Api, conversationId: string) => ({
  queryKey: queryKeys.processes(conversationId),
  queryFn: () => api.processes.list(conversationId),
});

export const useProcesses = (conversationId: string, enabled = true) => {
  const api = useApi();
  return useQuery({ ...processesOptions(api, conversationId), enabled });
};

export const timersOptions = (api: Api, conversationId: string) => ({
  queryKey: queryKeys.timers(conversationId),
  queryFn: () => api.timers.list(conversationId),
});

export const useTimers = (conversationId: string, enabled = true) => {
  const api = useApi();
  return useQuery({ ...timersOptions(api, conversationId), enabled });
};

export const approvalsOptions = (api: Api, conversationId: string) => ({
  queryKey: queryKeys.approvals(conversationId),
  queryFn: () => api.approvals.list(conversationId),
});

export const useApprovals = (conversationId: string, enabled = true) => {
  const api = useApi();
  return useQuery({ ...approvalsOptions(api, conversationId), enabled });
};

export function useDecideApproval(conversationId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { toolUseId: string; decision: ApprovalDecision }) =>
      api.approvals.decide(conversationId, input.toolUseId, input.decision),
    // The card leaves at the tap and the composer stops yielding to it; a
    // failed decision puts it back with the reason.
    onMutate: async ({ toolUseId }) => {
      const queryKey = queryKeys.approvals(conversationId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Approval[]>(queryKey);
      if (previous) {
        queryClient.setQueryData(
          queryKey,
          previous.filter((approval) => approval.toolUseId !== toolUseId),
        );
      }
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.approvals(conversationId), context.previous);
      toast.error(errorMessage(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.approvals(conversationId) }),
  });
}

/** "Use my other nodes": sets `Settings.setupSkipped` on this node (the gate in `app/App.tsx` reads it). */
export function useSetSetupSkipped() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (skipped: boolean) => api.settings.setSetupSkipped(skipped),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
  });
}

/**
 * A settings change shows in the cache the moment it is made, so the control moves at once. A refused change
 * puts back only the fields it touched (a later change to other fields stays), and the server's own answer
 * replaces the guess once it settles.
 */
async function applySettingsPatch(queryClient: QueryClient, patch: Partial<Settings>) {
  await queryClient.cancelQueries({ queryKey: queryKeys.settings });
  const current = queryClient.getQueryData<Settings>(queryKeys.settings);
  if (!current) return { previous: undefined };
  const previous: Partial<Settings> = {};
  for (const key of Object.keys(patch) as (keyof Settings)[])
    Object.assign(previous, { [key]: current[key] });
  queryClient.setQueryData<Settings>(queryKeys.settings, { ...current, ...patch });
  return { previous };
}

function revertSettingsPatch(queryClient: QueryClient, previous: Partial<Settings> | undefined) {
  if (!previous) return;
  queryClient.setQueryData<Settings>(queryKeys.settings, (current) =>
    current ? { ...current, ...previous } : current,
  );
}

/** `save(patch, action)`: shows `patch` now, runs `action`, reverts the patch and rethrows if it fails. */
export function useSettingsSave() {
  const queryClient = useQueryClient();
  return useCallback(
    async (patch: Partial<Settings>, action: () => Promise<unknown>) => {
      const { previous } = await applySettingsPatch(queryClient, patch);
      try {
        await action();
      } catch (error) {
        revertSettingsPatch(queryClient, previous);
        throw error;
      } finally {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      }
    },
    [queryClient],
  );
}

function useSettingsMutation<V>(
  mutationFn: (value: V) => Promise<unknown>,
  patchOf: (value: V) => Partial<Settings>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onMutate: (value: V) => applySettingsPatch(queryClient, patchOf(value)),
    onError: (error, _value, context) => {
      revertSettingsPatch(queryClient, context?.previous);
      toast.error(errorMessage(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
  });
}

export function useSetClaudeConnectors() {
  const api = useApi();
  return useSettingsMutation(
    (value: ClaudeConnectorSettings) => api.settings.setClaudeConnectors(value),
    (value) => ({ claudeConnectors: value }),
  );
}

export function useSetCompaction() {
  const api = useApi();
  return useSettingsMutation(
    (value: CompactionSettings) => api.settings.setCompaction(value),
    (value) => ({ compaction: value }),
  );
}

/**
 * The persisted sandbox switch from `useSettings` (real data path via `settings.get`).
 * `data` is the shipped default when the node predates the switch; the group reads
 * `useSettings` directly so it can tell “unsupported” apart from “off”.
 */
export const useSandboxSettings = () => {
  const settings = useSettings();
  return { ...settings, data: settings.data?.sandbox ?? DEFAULT_SANDBOX_SETTINGS };
};

/** Saves the sandbox switch (`PUT /api/settings/sandbox`); the UI is `SandboxGroup`. */
export function useSetSandbox() {
  const api = useApi();
  return useSettingsMutation(
    (value: SandboxSettings) => api.settings.setSandbox(value),
    (value) => ({ sandbox: value }),
  );
}

/** `null` data: the node is older than resource control. */
export const useResourceSupport = () => {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.resourceSupport, queryFn: () => api.settings.resourceSupport() });
};

/** Invalidated by `Change { resource: "resources" }`. `null` data: the node is older than resource control. */
export const useResourceActivity = (enabled = true) => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.resourceActivity,
    queryFn: () => api.settings.resourceActivity(),
    enabled,
  });
};

export function useSetResources() {
  const api = useApi();
  return useSettingsMutation(
    (value: ResourceSettings) => api.settings.setResources(value),
    (value) => ({ resources: value }),
  );
}

export function useStopResourceCommand() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => api.settings.stopResourceCommand(entryId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.resourceActivity }),
  });
}

export const goalOptions = (api: Api, conversationId: string) => ({
  queryKey: queryKeys.goal(conversationId),
  queryFn: () => api.goals.get(conversationId),
});

export const useGoal = (conversationId: string, enabled = true) => {
  const api = useApi();
  return useQuery({ ...goalOptions(api, conversationId), enabled });
};

export const useProcessLogs = (processId: string, tail?: number, enabled = true) => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.processLogs(processId, tail),
    queryFn: () => api.processes.logs(processId, tail),
    enabled,
  });
};

export const useMcpServers = (projectId: string | null) => {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.mcpServers(projectId), queryFn: () => api.mcp.servers(projectId) });
};

export const useRemoteStatus = () => {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.remoteStatus, queryFn: () => api.remote.status() });
};

export const useDevices = () => {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.devices, queryFn: () => api.access.devices() });
};

function useRemoteMutation(run: () => Promise<RemoteStatus>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.remoteStatus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices });
    },
  });
}

export const useEnableRemote = () => {
  const api = useApi();
  return useRemoteMutation(() => api.remote.enable());
};

export const useDisableRemote = () => {
  const api = useApi();
  return useRemoteMutation(() => api.remote.disable());
};

export const useRecreateRemote = () => {
  const api = useApi();
  return useRemoteMutation(() => api.remote.recreate());
};

export const useMintPairing = () => {
  const api = useApi();
  return useMutation({ mutationFn: (input: MintPairingInput) => api.access.mintPairing(input) });
};

function useDeviceMutation<V>(run: (value: V) => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
  });
}

export const useRenameDevice = () => {
  const api = useApi();
  return useDeviceMutation(({ id, name }: { id: string; name: string }) => api.access.renameDevice(id, name));
};

export const useRevokeDevice = () => {
  const api = useApi();
  return useDeviceMutation((id: string) => api.access.revokeDevice(id));
};

export const useSignOutAllDevices = () => {
  const api = useApi();
  return useDeviceMutation(() => api.access.signOutAll());
};

export const useNodeSummary = (nodeId: string) => {
  const api = useApi();
  return useQuery({
    queryKey: ["nodes", "summary", nodeId] as const,
    queryFn: () => api.nodes.summary(nodeId),
    retry: false,
  });
};

export const useNodeSelf = () => {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.nodeSelf, queryFn: () => api.nodes.self() });
};

function useNodeMutation<V>(run: (value: V) => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.nodes }),
  });
}

export const useRenameNode = () => {
  const api = useApi();
  return useNodeMutation(({ id, name }: { id: string; name: string }) => api.nodes.rename(id, name));
};

export const useDisconnectNode = () => {
  const api = useApi();
  return useNodeMutation((id: string) => api.nodes.disconnect(id));
};

export const useForgetNode = () => {
  const api = useApi();
  return useNodeMutation((id: string) => api.nodes.forget(id));
};

export const useRemoveNode = () => {
  const api = useApi();
  return useNodeMutation(({ id, confirm }: { id: string; confirm: string }) => api.nodes.remove(id, confirm));
};

export const useResetNodeIdentity = () => {
  const api = useApi();
  return useNodeMutation(() => api.nodes.resetIdentity());
};

const UPDATE_POLL_UNKNOWN_MS = 5_000;
const UPDATE_POLL_MS = 60_000;
const UPDATE_POLL_JOB_MS = 2_000;

/** Polls every 2 s (no retries) while a job runs, fast while the latest is unknown, every minute after. */
export const useUpdateStatus = () => {
  const api = useApi();
  const queryClient = useQueryClient();
  const jobRuns = () => {
    const data = queryClient.getQueryData<UpdateStatus>(queryKeys.updateStatus);
    return data !== undefined && isJobActive(data.job);
  };
  return useQuery({
    queryKey: queryKeys.updateStatus,
    queryFn: () => api.updates.status(),
    retry: (failures) => !jobRuns() && failures < 3,
    refetchInterval: (query) =>
      query.state.data && isJobActive(query.state.data.job)
        ? UPDATE_POLL_JOB_MS
        : query.state.data?.latest == null
          ? UPDATE_POLL_UNKNOWN_MS
          : UPDATE_POLL_MS,
  });
};

export const useStartUpdate = () => {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { target: string; force: boolean }) => api.updates.start(body),
    onSuccess: (status) => queryClient.setQueryData(queryKeys.updateStatus, status),
    onError: () => queryClient.invalidateQueries({ queryKey: queryKeys.updateStatus }),
  });
};

export const useRefreshUpdate = () => {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.updates.refresh(),
    onSuccess: (status) => queryClient.setQueryData(queryKeys.updateStatus, status),
  });
};
