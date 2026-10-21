import { useProcesses } from "@/lib/queries";
import { ProcessRow } from "@/processes/ProcessRow";
import { runningCount } from "@/processes/process-state";
import { SidebarSection } from "./SidebarSection";

export function ProcessesSection({ conversationId }: { conversationId: string }) {
  const processes = useProcesses(conversationId, true).data ?? [];
  const running = runningCount(processes);
  return (
    <SidebarSection title="Processes" count={running} defaultOpen={processes.length > 0}>
      {processes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No background processes.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {processes.map((process) => (
            <ProcessRow key={process.id} process={process} />
          ))}
        </ul>
      )}
    </SidebarSection>
  );
}
