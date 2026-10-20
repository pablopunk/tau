import { ArchiveIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNodesData } from "@/nodes";

interface ArchiveButtonProps {
  show: boolean;
  onToggle: () => void;
}

/** The global archive toggle: shows archived threads inline in the sidebar, in their normal order. */
export function ArchiveButton({ show, onToggle }: ArchiveButtonProps) {
  const nodes = useNodesData();
  const count = nodes.reduce(
    (total, node) =>
      total + node.conversations.filter((conversation) => conversation.archivedAt !== null).length,
    0,
  );
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="relative shrink-0 aria-pressed:bg-sidebar-accent aria-pressed:text-foreground"
      aria-label={
        count === 0
          ? "Show archived threads"
          : show
            ? `Hide archived threads, ${count}`
            : `Show archived threads, ${count}`
      }
      aria-pressed={show}
      title={show ? "Hide archived threads" : "Show archived threads"}
      onClick={onToggle}
    >
      <ArchiveIcon />
      {count > 0 && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-medium text-primary-foreground"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Button>
  );
}
