import type { McpServerConfig } from "@pi-everywhere/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";

function useInvalidateMcp() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.allMcpServers });
}

export function useSaveMcpServer() {
  const invalidate = useInvalidateMcp();
  return useMutation({
    mutationFn: (config: McpServerConfig) => api.mcp.save(config),
    onSuccess: invalidate,
  });
}

export function useRemoveMcpServer() {
  const invalidate = useInvalidateMcp();
  return useMutation({ mutationFn: (name: string) => api.mcp.remove(name), onSuccess: invalidate });
}
