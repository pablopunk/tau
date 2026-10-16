import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";

export function useRemoveProject(projectId: string, onRemoved: () => void) {
  const queryClient = useQueryClient();
  return async () => {
    await api.projects.remove(projectId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      queryClient.invalidateQueries({ queryKey: queryKeys.allConversations }),
    ]);
    onRemoved();
  };
}
