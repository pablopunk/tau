import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/queries";
import { useApi } from "@/machines/machine-context";

interface CloneFailedProps {
  projectId: string;
  error: string | undefined;
  onRemove: () => void;
}

export function CloneFailed({ projectId, error, onRemove }: CloneFailedProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const retry = async () => {
    await api.projects.retryClone(projectId);
    await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
  };

  return (
    <div className="flex flex-col gap-2 px-2 py-1">
      <Badge variant="destructive" className="w-fit">
        Clone failed
      </Badge>
      {error && <p className="text-xs text-muted-foreground">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={retry}>
          Retry
        </Button>
        <Button size="sm" variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}
