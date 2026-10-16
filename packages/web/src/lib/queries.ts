import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export const queryKeys = {
  provider: ["provider"] as const,
  settings: ["settings"] as const,
  models: ["models"] as const,
  projects: ["projects"] as const,
  conversations: (projectId: string) => ["conversations", projectId] as const,
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
