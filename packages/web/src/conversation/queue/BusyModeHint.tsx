import { useSettings } from "@/lib/queries";
import { busyHintOf, whenBusyOf } from "./queued-mode";

export function BusyModeHint({ busy }: { busy: boolean }) {
  const messageMode = useSettings().data?.messageMode;
  if (!busy || !messageMode) return null;
  return (
    <span className="mr-1 shrink-0 self-center text-[11px] leading-none whitespace-nowrap text-muted-foreground/60">
      {busyHintOf(whenBusyOf(messageMode))}
    </span>
  );
}
