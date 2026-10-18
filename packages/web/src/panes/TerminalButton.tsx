import { SquareTerminal } from "lucide-react";
import { useOpenConversation } from "@/activity";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOpenAndFocusTerminal, useTerminalsAvailable } from "./use-terminals";

/** Opens a terminal in the thread and focuses it. Hidden when this machine cannot run terminals. */
export function TerminalButton({ projectId, conversationId }: { projectId: string; conversationId: string }) {
  const available = useTerminalsAvailable().data === true;
  const open = useOpenAndFocusTerminal(projectId, conversationId);
  if (!available) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Terminal"
          onClick={open.run}
          disabled={open.pending}
        >
          <SquareTerminal />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Terminal</TooltipContent>
    </Tooltip>
  );
}

/** For the thread toolbar: reads the ids from the URL. */
export function ThreadTerminalButton() {
  const { projectId, conversationId } = useOpenConversation();
  if (!projectId || !conversationId) return null;
  return <TerminalButton projectId={projectId} conversationId={conversationId} />;
}
