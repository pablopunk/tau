import type { ConversationSummary, ProviderId } from "@pi-everywhere/protocol";
import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
