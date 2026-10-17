import { Server } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useProcesses } from "@/lib/queries";
import { ProcessesSheet } from "./ProcessesSheet";
import { runningCount } from "./process-state";

export function ProcessesChip({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const processes = useProcesses(conversationId).data ?? [];
  const running = runningCount(processes);
  if (running === 0 && !open) return null;
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label={`${running} running processes`}
        onClick={() => setOpen(true)}
      >
        <Server />
        {running}
      </Button>
      <ProcessesSheet processes={processes} open={open} onOpenChange={setOpen} />
    </>
  );
}
