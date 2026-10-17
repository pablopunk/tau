import { TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function UnmergedWarning({ message }: { message: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="destructive" className="mx-2 mb-1" data-testid="unmerged-warning">
          <TriangleAlertIcon />
          Unmerged work
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{message}</TooltipContent>
    </Tooltip>
  );
}
