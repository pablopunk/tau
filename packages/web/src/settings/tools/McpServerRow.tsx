import type { McpServerStatus } from "@pi-everywhere/protocol";
import { useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldDescription } from "@/components/ui/field";
import { useRemoveMcpServer } from "./use-mcp-mutations";

export function statusLabel(server: McpServerStatus): string {
  if (server.state === "error") return "Error";
  if (server.state === "connected") {
    return server.toolCount === null
      ? "Connected"
      : `${server.toolCount} ${server.toolCount === 1 ? "tool" : "tools"}`;
  }
  return "Not started";
}

function RemoveButton({ name }: { name: string }) {
  const [confirming, setConfirming] = useState(false);
  const remove = useRemoveMcpServer();
  const { run, error, pending } = useSubmit();
  if (!confirming) {
    return (
      <Button variant="outline" size="sm" aria-label={`Remove ${name}`} onClick={() => setConfirming(true)}>
        Remove
      </Button>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() => run(async () => void (await remove.mutateAsync(name)))}
        >
          Confirm remove
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
      <FormError message={error} />
    </div>
  );
}

interface McpServerRowProps {
  readonly server: McpServerStatus;
  readonly onEdit?: (name: string) => void;
}

export function McpServerRow({ server, onEdit }: McpServerRowProps) {
  return (
    <li aria-label={server.name} className="flex flex-col gap-1 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{server.name}</span>
          <Badge variant={server.state === "error" ? "destructive" : "secondary"}>
            {statusLabel(server)}
          </Badge>
          <Badge variant="outline">{server.transport === "stdio" ? "command" : "url"}</Badge>
        </div>
        {onEdit ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-label={`Edit ${server.name}`}
              onClick={() => onEdit(server.name)}
            >
              Edit
            </Button>
            <RemoveButton name={server.name} />
          </div>
        ) : null}
      </div>
      {server.error ? <FieldDescription className="text-destructive">{server.error}</FieldDescription> : null}
    </li>
  );
}
