import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export const queryKeys = {
  provider: ["provider"] as const,
  settings: ["settings"] as const,
  models: ["models"] as const,
  projects: ["projects"] as const,
  conversations: (projectId: string) => ["conversations", projectId] as const,
  allConversations: ["conversations", "all"] as const,
  githubStatus: ["github", "status"] as const,
  githubRepos: ["github", "repos"] as const,
  suggestedCodeFolder: ["settings", "suggested-code-folder"] as const,
  iconCandidates: (projectId: string) => ["projects", projectId, "icon-candidates"] as const,
};

export const useProvider = () =>
  useQuery({ queryKey: queryKeys.provider, queryFn: () => api.provider.status() });
export const useSettings = () =>
  useQuery({ queryKey: queryKeys.settings, queryFn: () => api.settings.get() });
export const useProjects = () =>
  useQuery({ queryKey: queryKeys.projects, queryFn: () => api.projects.list() });

export const useModels = () => useQuery({ queryKey: queryKeys.models, queryFn: () => api.provider.models() });

export const useConversations = (projectId: string) =>
  useQuery({
    queryKey: queryKeys.conversations(projectId),
    queryFn: async () => {
      const list = await api.conversations.list(projectId);
      return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
    },
  });

export const useAllConversations = () =>
  useQuery({
    queryKey: queryKeys.allConversations,
    queryFn: async () => {
      const list = await api.conversations.listAll();
      return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
    },
  });

export const useGithubStatus = () =>
  useQuery({ queryKey: queryKeys.githubStatus, queryFn: () => api.github.status() });

export const useGithubRepos = (enabled: boolean) =>
  useQuery({ queryKey: queryKeys.githubRepos, queryFn: () => api.github.repos(), enabled });

export const useSuggestedCodeFolder = () =>
  useQuery({ queryKey: queryKeys.suggestedCodeFolder, queryFn: () => api.settings.suggestedCodeFolder() });

export const useIconCandidates = (projectId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.iconCandidates(projectId),
    queryFn: () => api.projects.iconCandidates(projectId),
    enabled,
  });
