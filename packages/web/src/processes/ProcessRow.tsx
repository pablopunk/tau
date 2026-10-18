import { useQueryClient } from "@tanstack/react-query";
import type { ProcessInfo } from "@tau/protocol";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/queries";
import { ProcessLogs } from "./ProcessLogs";
import { stateLabel } from "./process-state";

function useStopProcess(process: ProcessInfo) {
  const queryClient = useQueryClient();
  return () =>
    api.processes
      .stop(process.id)
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.processes(process.conversationId) }))
      .catch((error) => void toast.error(errorMessage(error)));
}

export function ProcessRow({ process }: { process: ProcessInfo }) {
  const stop = useStopProcess(process);
  const running = process.state === "running";
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{process.name}</span>
        <Badge variant={running ? "default" : "secondary"}>{stateLabel(process)}</Badge>
        {running ? (
          <Button size="sm" variant="outline" onClick={() => void stop()}>
            Stop
          </Button>
        ) : null}
      </div>
      <code className="block truncate font-mono text-xs text-muted-foreground">{process.command}</code>
      {process.urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" className="block truncate text-xs underline">
          {url}
        </a>
      ))}
      <ProcessLogs processId={process.id} live={running} />
    </li>
  );
}
