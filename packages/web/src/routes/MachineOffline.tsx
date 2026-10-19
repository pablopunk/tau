import type { Machine } from "@tau/protocol";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { MachineAvatar } from "@/components/ui/machine-avatar";
import { agoText, updateCommand } from "@/machines/machine-text";

function OfflineBody({ machine }: { machine: Machine }) {
  if (machine.status === "update-required") {
    return (
      <>
        <h2 className="text-base font-medium">Update tau on {machine.name}</h2>
        <p className="text-sm text-muted-foreground">
          This machine runs tau {machine.tauVersion}, which does not match this one. Run the command on{" "}
          {machine.name}, then it comes back by itself.
        </p>
        <div className="flex items-center gap-1">
          <code className="rounded-md bg-muted px-2 py-1 text-xs">{updateCommand}</code>
          <CopyButton text={updateCommand} label="Copy update command" />
        </div>
      </>
    );
  }
  return (
    <>
      <h2 className="text-base font-medium">This machine is offline</h2>
      <p className="text-sm text-muted-foreground">
        {machine.name} was last seen {agoText(machine.lastSeenAt, Date.now())}. Its threads come back when it
        connects again.
      </p>
    </>
  );
}

/** Calm state for a thread (or a page) of a machine that cannot be reached. */
export function MachineOffline({ machine }: { machine: Machine }) {
  return (
    <div
      role="status"
      data-testid="machine-offline"
      className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <MachineAvatar os={machine.os} status={machine.status} className="size-6" />
      <OfflineBody machine={machine} />
      <Button asChild variant="outline" size="sm">
        <Link to="/">Back to new thread</Link>
      </Button>
    </div>
  );
}

export function MachineUnknown() {
  return (
    <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h2 className="text-base font-medium">This machine is not linked</h2>
      <p className="text-sm text-muted-foreground">It was disconnected, or this link is old.</p>
      <Button asChild variant="outline" size="sm">
        <Link to="/">Back to new thread</Link>
      </Button>
    </div>
  );
}
