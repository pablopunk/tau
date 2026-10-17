import type { ProcessInfo } from "@pi-everywhere/protocol";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ProcessRow } from "./ProcessRow";

export function ProcessesSheet({
  processes,
  open,
  onOpenChange,
}: {
  processes: readonly ProcessInfo[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Background processes</SheetTitle>
          <SheetDescription>Started by the agent in this thread.</SheetDescription>
        </SheetHeader>
        <ul className="divide-y">
          {processes.map((process) => (
            <ProcessRow key={process.id} process={process} />
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
