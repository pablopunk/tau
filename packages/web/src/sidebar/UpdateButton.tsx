import { hasRunningWork, runningWorkOf, type UpdateStatus } from "@tau/protocol";
import { DownloadIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/error-message";
import { useAllConversations, useStartUpdate, useUpdateStatus } from "@/lib/queries";
import {
  isJobActive,
  markUpdateStartedHere,
  RESTART_GIVE_UP_MS,
  rememberUpdateForToast,
  showsUpdateButton,
  takeUpdatedVersion,
  versionChanged,
} from "@/lib/updates";
import { FailedUpdateDialog, ManualUpdateDialog, type UpdateDialogKind } from "./UpdateDialog";
import {
  confirmLabel,
  GAVE_UP,
  progressLabel,
  runningWorkText,
  updateBody,
  updatedToast,
  updateTitle,
} from "./update-copy";

/** Reloads once when the version changes under this page, and announces a finished update after the reload. */
function useVersionWatch(status: UpdateStatus | undefined) {
  useEffect(() => {
    const version = takeUpdatedVersion();
    if (version) toast.success(updatedToast(version));
  }, []);
  useEffect(() => {
    if (!status || !versionChanged(status.current)) return;
    rememberUpdateForToast(status);
    window.location.reload();
  }, [status]);
}

function useRestartGiveUp(restarting: boolean) {
  useEffect(() => {
    if (!restarting) return;
    const timer = setTimeout(() => toast.error(GAVE_UP), RESTART_GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [restarting]);
}

function ButtonFace({ status }: { status: UpdateStatus }) {
  if (isJobActive(status.job))
    return (
      <>
        <Spinner aria-hidden />
        Updating…
      </>
    );
  if (status.job.state === "failed")
    return (
      <>
        <TriangleAlertIcon />
        Update failed
      </>
    );
  return (
    <>
      <DownloadIcon />
      Update
    </>
  );
}

export function UpdateButton() {
  const status = useUpdateStatus().data;
  const conversations = useAllConversations().data;
  const start = useStartUpdate();
  const [dialog, setDialog] = useState<UpdateDialogKind | null>(null);
  useVersionWatch(status);
  useRestartGiveUp(status?.job.state === "restarting");
  if (!showsUpdateButton(status)) return null;

  const work = runningWorkOf(conversations ?? []);
  const hasWork = hasRunningWork(work);
  const running = isJobActive(status.job);
  const latest = status.latest ?? status.current;

  const open = () => {
    if (status.job.state === "failed") setDialog("failed");
    else setDialog(status.install.mode === "run" ? "confirm" : "manual");
  };
  const runUpdate = () => {
    markUpdateStartedHere();
    start.mutate(
      { target: latest, force: hasWork },
      { onError: (error) => toast.error(errorMessage(error)) },
    );
  };
  const workText = runningWorkText(work);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="min-w-0 shrink-0"
        disabled={running}
        title={running ? progressLabel(status.job) : `Update to ${latest}`}
        onClick={open}
      >
        <ButtonFace status={status} />
      </Button>
      <ConfirmDialog
        open={dialog === "confirm"}
        onOpenChange={(next) => !next && setDialog(null)}
        title={updateTitle(latest)}
        description={
          <>
            {updateBody(status.current, status.install.reason)}
            {workText && <span className="mt-2 block">{workText}</span>}
          </>
        }
        confirmLabel={confirmLabel(hasWork)}
        destructive={hasWork}
        onConfirm={runUpdate}
      />
      <ManualUpdateDialog
        open={dialog === "manual"}
        onOpenChange={(next) => !next && setDialog(null)}
        status={status}
      />
      <FailedUpdateDialog
        open={dialog === "failed"}
        onOpenChange={(next) => !next && setDialog(null)}
        status={status}
        onRetry={() => setDialog("confirm")}
      />
    </>
  );
}
