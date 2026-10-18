import { SquareTerminal } from "lucide-react";
import { useOpenConversation } from "@/activity";
import { Button } from "@/components/ui/button";
import { useOpenAndFocusTerminal, useTerminalsAvailable } from "./use-terminals";

/** Opens a terminal in the thread and focuses it. Hidden when this machine cannot run terminals. */
export function TerminalButton({ projectId, conversationId }: { projectId: string; conversationId: string }) {
  const available = useTerminalsAvailable().data === true;
  const open = useOpenAndFocusTerminal(projectId, conversationId);
  if (!available) return null;
  return (
    <Button variant="outline" size="sm" onClick={open.run} disabled={open.pending}>
      <SquareTerminal /> Terminal
    </Button>
  );
}

/** For the thread toolbar: reads the ids from the URL. */
export function ThreadTerminalButton() {
  const { projectId, conversationId } = useOpenConversation();
  if (!projectId || !conversationId) return null;
  return <TerminalButton projectId={projectId} conversationId={conversationId} />;
}
