import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";

/** Kills a running command's process group; the call settles as stopped. */
export function StopToolCallButton({ conversationId, callId }: { conversationId: string; callId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const stop = useMutation({
    mutationFn: () => api.processes.stopCall(conversationId, callId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.processes(conversationId) }),
    onError: (error) => void toast.error(errorMessage(error)),
  });
  return (
    <Button
      size="xs"
      variant="outline"
      aria-label="Stop command"
      disabled={stop.isPending}
      onClick={() => stop.mutate()}
    >
      <Square />
      Stop
    </Button>
  );
}
