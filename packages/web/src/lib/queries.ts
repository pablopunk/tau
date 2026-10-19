import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ApprovalDecision,
  ClaudeConnectorSettings,
  ConversationSummary,
  MintPairingInput,
  ProviderId,
  RemoteStatus,
  UpdateStatus,
} from "@tau/protocol";
import { useApi } from "@/nodes/node-context";

export const queryKeys = {
  providers: ["providers"] as const,
  settings: ["settings"] as const,
  models: ["models"] as const,
  skills: (projectId: string | null) => ["skills", projectId] as const,
  projects: ["projects"] as const,
  conversations: (projectId: string) => ["conversations", projectId] as const,
  allConversations: ["conversations", "all"] as const,
  githubStatus: ["github", "status"] as const,
  githubRepos: ["github", "repos"] as const,
  suggestedCodeFolder: ["settings", "suggested-code-folder"] as const,
  pathSuggestions: (prefix: string) => ["fs", "suggest", prefix] as const,
  iconCandidates: (projectId: string) => ["projects", projectId, "icon-candidates"] as const,
  workspace: (conversationId: string) => ["workspace", conversationId] as const,
  checkpoints: (conversationId: string) => ["checkpoints", conversationId] as const,
  processes: (conversationId: string) => ["processes", conversationId] as const,
  allProcesses: ["processes"] as const,
  timers: (conversationId: string) => ["timers", conversationId] as const,
  approvals: (conversationId: string) => ["approvals", conversationId] as const,
  goal: (conversationId: string) => ["goal", conversationId] as const,
  processLogs: (processId: string, tail?: number) => ["process-logs", processId, tail ?? null] as const,
  mcpServers: (projectId: string | null) => ["mcp", "servers", projectId] as const,
  allMcpServers: ["mcp"] as const,
  remoteStatus: ["remote"] as const,
  devices: ["devices"] as const,
  /** `["nodes"]` is the hub's list; `["nodes", "hub"]` is this tau's own link to a hub. */
  nodes: ["nodes"] as const,
  hubLink: ["nodes", "hub"] as const,
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

export const useWorkspaceStatus = (conversationId: string, enabled = true) => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.workspace(conversationId),
    queryFn: () => api.workspaces.status(conversationId),
    enabled,
  });
};

export const useCheckpoints = (conversationId: string, enabled = true) => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.checkpoints(conversationId),
    queryFn: () => api.conversations.checkpoints(conversationId),
    enabled,
  });
};

export const useProcesses = (conversationId: string, enabled = true) => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.processes(conversationId),
    queryFn: () => api.processes.list(conversationId),
    enabled,
  });
};

export const useTimers = (conversationId: string, enabled = true) => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.timers(conversationId),
    queryFn: () => api.timers.list(conversationId),
    enabled,
  });
};

export const useApprovals = (conversationId: string, enabled = true) => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.approvals(conversationId),
    queryFn: () => api.approvals.list(conversationId),
    enabled,
  });
};

export function useDecideApproval(conversationId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { toolUseId: string; decision: ApprovalDecision }) =>
      api.approvals.decide(conversationId, input.toolUseId, input.decision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.approvals(conversationId) }),
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

export function useSetClaudeConnectors() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (value: ClaudeConnectorSettings) => api.settings.setClaudeConnectors(value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
  });
}

export const useGoal = (conversationId: string, enabled = true) => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.goal(conversationId),
    queryFn: () => api.goals.get(conversationId),
    enabled,
  });
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

export const useHubLink = () => {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.hubLink, queryFn: () => api.nodes.hubLink() });
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

export const useDisconnectHub = () => {
  const api = useApi();
  return useNodeMutation(() => api.nodes.disconnectHub());
};

const UPDATE_POLL_UNKNOWN_MS = 5_000;
const UPDATE_POLL_KNOWN_MS = 10 * 60_000;

/** Polls fast while the latest is still unknown (the first check runs in the background), slowly after. */
export const useUpdateStatus = () => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.updateStatus,
    queryFn: () => api.updates.status(),
    refetchInterval: (query) =>
      query.state.data?.latest == null ? UPDATE_POLL_UNKNOWN_MS : UPDATE_POLL_KNOWN_MS,
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
