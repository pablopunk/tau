import { useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { queryKeys } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";

export function RefreshReposButton() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const refresh = async () => {
    setPending(true);
    try {
      queryClient.setQueryData(queryKeys.githubRepos, await api.github.refreshRepos());
    } catch {
      await queryClient.invalidateQueries({ queryKey: queryKeys.githubRepos });
    } finally {
      setPending(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh GitHub repos"
          disabled={pending}
          onClick={() => void refresh()}
        >
          <RefreshCwIcon className={pending ? "animate-spin" : undefined} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">Refresh GitHub repos</TooltipContent>
    </Tooltip>
  );
}
