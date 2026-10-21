import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function SidebarToggleButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={open ? "Close conversation sidebar" : "Open conversation sidebar"}
          aria-pressed={open}
          onClick={onToggle}
        >
          <PanelRight />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{open ? "Hide details" : "Show details"}</TooltipContent>
    </Tooltip>
  );
}
