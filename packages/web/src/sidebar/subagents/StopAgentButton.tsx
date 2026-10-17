import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";

export function StopAgentButton({ childId }: { childId: string }) {
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
