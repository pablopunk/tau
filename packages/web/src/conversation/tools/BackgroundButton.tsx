import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";

/** Lets a running command go on without the call: the same process, now in the thread's background processes. */
export function BackgroundButton({ conversationId, callId }: { conversationId: string; callId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const background = useMutation({
    mutationFn: () => api.processes.background(conversationId, callId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.processes(conversationId) }),
    onError: (error) => void toast.error(errorMessage(error)),
  });
  return (
    <Button size="xs" variant="outline" disabled={background.isPending} onClick={() => background.mutate()}>
      <ArrowDownToLine />
      Run in background
    </Button>
  );
}
