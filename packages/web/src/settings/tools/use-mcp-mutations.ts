import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { McpServerConfig } from "@tau/protocol";
import { queryKeys } from "@/lib/queries";
import { useApi } from "@/machines/machine-context";

function useInvalidateMcp() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.allMcpServers });
}

export function useSaveMcpServer() {
  const api = useApi();
  const invalidate = useInvalidateMcp();
  return useMutation({
    mutationFn: (config: McpServerConfig) => api.mcp.save(config),
    onSuccess: invalidate,
  });
}

export function useRemoveMcpServer() {
  const api = useApi();
  const invalidate = useInvalidateMcp();
  return useMutation({ mutationFn: (name: string) => api.mcp.remove(name), onSuccess: invalidate });
}
