import type { UpdateStatus } from "@tau/protocol";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FAILED_BODY, manualBody, manualTitle } from "./update-copy";

export type UpdateDialogKind = "confirm" | "manual" | "failed";

export function ManualUpdateDialog({
  open,
  onOpenChange,
  status,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: UpdateStatus;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{manualTitle}</DialogTitle>
          <DialogDescription>{manualBody(status.install.reason)}</DialogDescription>
        </DialogHeader>
        {status.install.command && <CodeBlock text={status.install.command} copyable />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FailedUpdateDialog({
  open,
  onOpenChange,
  status,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: UpdateStatus;
  onRetry: () => void;
}) {
  const canRetry = status.install.mode === "run" && status.behind;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update failed</DialogTitle>
          <DialogDescription>{status.job.error ?? FAILED_BODY}</DialogDescription>
        </DialogHeader>
        {status.job.logTail && <CodeBlock text={status.job.logTail} aria-label="Update log" />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {canRetry && <Button onClick={onRetry}>Retry</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
