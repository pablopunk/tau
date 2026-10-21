import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function SidebarToggleButton({
  open,
  onToggle,
  disabled,
}: {
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={open ? "Close conversation sidebar" : "Open conversation sidebar"}
          aria-pressed={open}
          onClick={onToggle}
          disabled={disabled}
        >
          <PanelRight />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{open ? "Hide details" : "Show details"}</TooltipContent>
    </Tooltip>
  );
}
