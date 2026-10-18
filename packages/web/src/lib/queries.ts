import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ConversationSummary, ProviderId } from "@tau/protocol";
import { api } from "./api";

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
  goal: (conversationId: string) => ["goal", conversationId] as const,
  processLogs: (processId: string, tail?: number) => ["process-logs", processId, tail ?? null] as const,
  mcpServers: (projectId: string | null) => ["mcp", "servers", projectId] as const,
  allMcpServers: ["mcp"] as const,
};

export const useProviders = () =>
  useQuery({ queryKey: queryKeys.providers, queryFn: () => api.providers.list() });
export const useSettings = () =>
  useQuery({ queryKey: queryKeys.settings, queryFn: () => api.settings.get() });
export const useProjects = () =>
  useQuery({ queryKey: queryKeys.projects, queryFn: () => api.projects.list() });

export const useModels = () => useQuery({ queryKey: queryKeys.models, queryFn: () => api.models.list() });

export const useSkills = (projectId: string | null) =>
  useQuery({ queryKey: queryKeys.skills(projectId), queryFn: () => api.skills.list(projectId) });

export const invalidateProviders = async (queryClient: QueryClient) => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
    queryClient.invalidateQueries({ queryKey: queryKeys.models }),
  ]);
};

export function useSetProviderKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, key }: { id: ProviderId; key: string }) => api.providers.setKey(id, key),
    onSuccess: () => invalidateProviders(queryClient),
  });
}

export function useDisconnectProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: ProviderId) => api.providers.disconnect(id),
    onSuccess: () => invalidateProviders(queryClient),
  });
}

export function useAcknowledgeClaudeCli() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.providers.acknowledgeClaudeCli(),
    onSuccess: () => invalidateProviders(queryClient),
  });
}

export function useRefreshClaudeCli() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.providers.refreshClaudeCli(),
    onSuccess: () => invalidateProviders(queryClient),
  });
}

export function useInstallClaudeCliSdk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.providers.installClaudeCliSdk(),
    onSuccess: () => invalidateProviders(queryClient),
  });
}

export const byActivity = (a: ConversationSummary, b: ConversationSummary): number =>
  b.lastActivityAt - a.lastActivityAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

export const useConversations = (projectId: string) =>
  useQuery({
    queryKey: queryKeys.conversations(projectId),
    queryFn: async () => {
      const list = await api.conversations.list(projectId);
      return [...list].sort(byActivity);
    },
  });

export const useAllConversations = () =>
  useQuery({
    queryKey: queryKeys.allConversations,
    queryFn: async () => {
      const list = await api.conversations.listAll();
      return [...list].sort(byActivity);
    },
  });

export const useGithubStatus = () =>
  useQuery({ queryKey: queryKeys.githubStatus, queryFn: () => api.github.status() });

export const useGithubRepos = (enabled: boolean) =>
  useQuery({ queryKey: queryKeys.githubRepos, queryFn: () => api.github.repos(), enabled });

export const useSuggestedCodeFolder = () =>
  useQuery({ queryKey: queryKeys.suggestedCodeFolder, queryFn: () => api.settings.suggestedCodeFolder() });

export const usePathSuggestions = (prefix: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.pathSuggestions(prefix),
    queryFn: () => api.fs.suggestDirectories({ prefix }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  });

export const useIconCandidates = (projectId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.iconCandidates(projectId),
    queryFn: () => api.projects.iconCandidates(projectId),
    enabled,
  });

export const useWorkspaceStatus = (conversationId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.workspace(conversationId),
    queryFn: () => api.workspaces.status(conversationId),
    enabled,
  });

export const useCheckpoints = (conversationId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.checkpoints(conversationId),
    queryFn: () => api.conversations.checkpoints(conversationId),
    enabled,
  });

export const useProcesses = (conversationId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.processes(conversationId),
    queryFn: () => api.processes.list(conversationId),
    enabled,
  });

export const useTimers = (conversationId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.timers(conversationId),
    queryFn: () => api.timers.list(conversationId),
    enabled,
  });

export const useGoal = (conversationId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.goal(conversationId),
    queryFn: () => api.goals.get(conversationId),
    enabled,
  });

export const useProcessLogs = (processId: string, tail?: number, enabled = true) =>
  useQuery({
    queryKey: queryKeys.processLogs(processId, tail),
    queryFn: () => api.processes.logs(processId, tail),
    enabled,
  });

export const useMcpServers = (projectId: string | null) =>
  useQuery({ queryKey: queryKeys.mcpServers(projectId), queryFn: () => api.mcp.servers(projectId) });
