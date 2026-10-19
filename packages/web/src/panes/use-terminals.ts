import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { terminalPath } from "@/lib/paths";
import { useApi, useMachineId } from "@/machines/machine-context";

export const terminalKeys = {
  available: ["terminals", "available"] as const,
  list: (conversationId: string) => ["terminals", conversationId] as const,
};

const DEFAULT_SIZE = { cols: 80, rows: 24 };

export const useTerminalsAvailable = () => {
  const api = useApi();
  return useQuery({
    queryKey: terminalKeys.available,
    queryFn: () => api.terminals.available(),
    staleTime: Infinity,
  });
};

export function useTerminals(conversationId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: terminalKeys.list(conversationId),
    queryFn: () => api.terminals.list(conversationId),
    enabled,
  });
}

export function useOpenTerminal(conversationId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.terminals.open(conversationId, DEFAULT_SIZE),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: terminalKeys.list(conversationId) }),
  });
}

export function useCloseTerminal(conversationId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.terminals.close(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: terminalKeys.list(conversationId) }),
  });
}

/** Opens a terminal in the thread and focuses it through the URL. */
export function useOpenAndFocusTerminal(projectId: string, conversationId: string) {
  const machineId = useMachineId();
  const open = useOpenTerminal(conversationId);
  const navigate = useNavigate();
  const run = () =>
    open.mutate(undefined, {
      onSuccess: (terminal) => navigate(terminalPath(projectId, conversationId, terminal.id, machineId)),
      onError: (error) => void toast.error(errorMessage(error)),
    });
  return { run, pending: open.isPending };
}
