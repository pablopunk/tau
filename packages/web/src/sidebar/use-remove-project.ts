import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queries";
import { useApi } from "@/machines/machine-context";

export function useRemoveProject(projectId: string, onRemoved: () => void) {
  const api = useApi();
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
