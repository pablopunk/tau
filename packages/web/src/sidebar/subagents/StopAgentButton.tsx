import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";

export function StopAgentButton({ childId }: { childId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const stop = async () => {
    await api.conversations.stopAgent(childId);
    await queryClient.invalidateQueries({ queryKey: queryKeys.allConversations });
  };
  return (
    <Button variant="outline" size="sm" onClick={stop}>
      Stop
    </Button>
  );
}
