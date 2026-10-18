import { MoreHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProviderListActions } from "@/components/ui/provider-list";

export interface ProviderActionItem {
  id: string;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** The first action is the primary button; the rest go in the overflow menu. */
export function ProviderActionButtons({ name, actions }: { name: string; actions: ProviderActionItem[] }) {
  const [primary, ...secondary] = actions;
  const nameFor = (action: ProviderActionItem) => `${action.label} for ${name}`;
  return (
    <ProviderListActions>
      {primary ? (
        <Button
          variant="outline"
          size="sm"
          disabled={primary.disabled}
          aria-label={nameFor(primary)}
          onClick={primary.onSelect}
        >
          {primary.label}
        </Button>
      ) : null}
      {secondary.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${name}`}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            {secondary.map((action) => (
              <DropdownMenuItem
                key={action.id}
                variant={action.destructive ? "destructive" : "default"}
                disabled={action.disabled}
                aria-label={nameFor(action)}
                onSelect={action.onSelect}
              >
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span aria-hidden className="hidden size-7 sm:block" />
      )}
    </ProviderListActions>
  );
}
