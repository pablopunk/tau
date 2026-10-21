import { useProcesses } from "@/lib/queries";
import { ProcessRow } from "@/processes/ProcessRow";
import { runningCount } from "@/processes/process-state";
import { SidebarSection } from "./SidebarSection";
import { useAutoExpand } from "./use-auto-expand";

export function ProcessesSection({ conversationId }: { conversationId: string }) {
  const processes = useProcesses(conversationId, true).data ?? [];
  const running = runningCount(processes);
  const expanded = useAutoExpand(processes.length > 0);
  if (processes.length === 0) return null;
  return (
    <SidebarSection
      title="Processes"
      count={running}
      open={expanded.open}
      onOpenChange={expanded.onOpenChange}
    >
      <ul className="divide-y rounded-md border">
        {processes.map((process) => (
          <ProcessRow key={process.id} process={process} />
        ))}
      </ul>
    </SidebarSection>
  );
}
