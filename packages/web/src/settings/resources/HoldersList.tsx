import type { ResourceActivity, ResourceCommand } from "@tau/protocol";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { RelativeTime } from "@/components/ui/relative-time";
import { useStopResourceCommand } from "@/lib/queries";

function CommandRow({ command, state }: { command: ResourceCommand; state: "Running" | "Waiting" }) {
  const stop = useStopResourceCommand();
  return (
    <li className="flex items-center gap-2 text-sm">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{command.conversationTitle}</span>
        <code className="truncate text-xs text-muted-foreground">{command.command}</code>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {state} <RelativeTime at={command.since} />
      </span>
      <Button
        size="xs"
        variant="outline"
        disabled={stop.isPending}
        aria-label={`Stop ${command.command}`}
        onClick={() => stop.mutate(command.entryId)}
      >
        Stop
      </Button>
    </li>
  );
}

export function HoldersList({ activity }: { activity: ResourceActivity | null | undefined }) {
  const holders = activity?.holders ?? [];
  const waiting = activity?.waiting ?? [];
  return (
    <Field>
      <FieldLabel>Heavy commands</FieldLabel>
      {holders.length + waiting.length === 0 ? (
        <FieldDescription>No heavy commands are running or waiting.</FieldDescription>
      ) : (
        <ul className="flex flex-col gap-2">
          {holders.map((c) => (
            <CommandRow key={c.entryId} command={c} state="Running" />
          ))}
          {waiting.map((c) => (
            <CommandRow key={c.entryId} command={c} state="Waiting" />
          ))}
        </ul>
      )}
    </Field>
  );
}
