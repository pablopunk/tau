import type { RetryInfo } from "@tau/protocol";
import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useNow } from "../use-now";

export function ErrorNotice({ message }: { message: string | undefined }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">The model returned an error</p>
        {message ? <p className="break-words text-destructive/90">{message}</p> : null}
      </div>
    </div>
  );
}

function secondsUntil(at: number, now: number): number {
  return Math.max(0, Math.ceil((at - now) / 1000));
}

export function RetryNotice({ retry }: { retry: RetryInfo }) {
  const now = useNow(1000);
  const seconds = secondsUntil(retry.at, now);
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
    >
      <RotateCw aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0">
        <p className="font-medium">
          {seconds > 0 ? `Retrying in ${seconds}s` : "Retrying now"} (attempt {retry.attempt + 1})
        </p>
        <p className="break-words text-muted-foreground">{retry.error}</p>
      </div>
    </div>
  );
}

export function CompactedDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <Separator className="flex-1" />
      <span>Context compacted</span>
      <Separator className="flex-1" />
    </div>
  );
}

export function CompactingNotice() {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 aria-hidden className="size-3.5 animate-spin" />
      Compacting context…
    </p>
  );
}

export function RetriedDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <Separator className="flex-1" />
      <span>Retried</span>
      <Separator className="flex-1" />
    </div>
  );
}
