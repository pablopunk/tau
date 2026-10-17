import { useSettings } from "@/lib/queries";
import { busyHintOf, whenBusyOf } from "./queued-mode";

export function BusyModeHint({ busy }: { busy: boolean }) {
  const messageMode = useSettings().data?.messageMode;
  if (!busy || !messageMode) return null;
  return <p className="px-1 text-xs text-muted-foreground">{busyHintOf(whenBusyOf(messageMode))}</p>;
}
