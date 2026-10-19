import type { Machine } from "@tau/protocol";
import { isBehind } from "@tau/protocol";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import type { MachineVersionState } from "@/components/ui/machine-row";
import { useRefreshUpdate, useUpdateStatus } from "@/lib/queries";
import { agoText, updateCommand } from "@/machines/machine-text";

export const tauUpdateCommand = "tau update";

/** Total: an empty or garbage version, or an unknown latest, is "unknown". */
export function versionState(version: string, latest: string | null | undefined): MachineVersionState {
  if (!latest) return "unknown";
  const behind = isBehind(version, latest);
  if (behind === undefined) return "unknown";
  return behind ? "behind" : "current";
}

export function behindCount(
  machines: readonly Machine[],
  hubVersion: string,
  latest: string | null | undefined,
) {
  const hub = versionState(hubVersion, latest) === "behind" ? 1 : 0;
  return hub + machines.filter((machine) => versionState(machine.tauVersion, latest) === "behind").length;
}

export function UpdateCommand() {
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <code className="rounded-md bg-muted px-2 py-1">{tauUpdateCommand}</code>
      <CopyButton text={tauUpdateCommand} label="Copy update command" />
      <span className="text-muted-foreground">or</span>
      <code className="rounded-md bg-muted px-2 py-1">{updateCommand}</code>
    </div>
  );
}

function CheckAgain({ latest, checkedAt }: { latest: string | null; checkedAt: number | null }) {
  const refresh = useRefreshUpdate();
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>
        {latest ? `Latest known: ${latest}` : "Latest unknown"}
        {checkedAt ? `, checked ${agoText(checkedAt, Date.now())}` : ""}
      </span>
      <Button variant="outline" size="xs" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
        Check again
      </Button>
    </div>
  );
}

/** "N machines are behind" with the command, or just the latest known when nothing is behind. */
export function MachinesUpdateBar({ machines }: { machines: readonly Machine[] }) {
  const status = useUpdateStatus().data;
  if (!status) return null;
  const count = behindCount(machines, status.current, status.latest);
  const check = <CheckAgain latest={status.latest} checkedAt={status.checkedAt} />;
  if (count === 0) return check;
  return (
    <Alert>
      <AlertTitle>{count === 1 ? "1 machine is behind" : `${count} machines are behind`}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>Run this on each one, they must run the same tau as this hub.</span>
        <UpdateCommand />
        {check}
      </AlertDescription>
    </Alert>
  );
}
