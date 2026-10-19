import { useQuery } from "@tanstack/react-query";
import type { Checkpoint } from "@tau/protocol";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/error-message";
import { useCheckpoints } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";
import { DiffView } from "../tools/DiffView";

type ChangedFile = Checkpoint["files"][number];

const filesLabel = (count: number) => `${count} ${count === 1 ? "file" : "files"} changed`;

function FileDiff({
  conversationId,
  checkpointId,
  path,
}: {
  conversationId: string;
  checkpointId: string;
  path: string;
}) {
  const api = useApi();
  const diff = useQuery({
    queryKey: ["checkpoint-diff", conversationId, checkpointId, path],
    queryFn: () => api.conversations.checkpointDiff(conversationId, checkpointId, path),
  });
  if (diff.isPending) return <Spinner aria-label="Loading diff" />;
  if (diff.isError) return <p className="text-sm text-destructive">{errorMessage(diff.error)}</p>;
  return diff.data ? (
    <DiffView diff={diff.data} contained={false} />
  ) : (
    <p className="text-sm text-muted-foreground">No changes.</p>
  );
}

function FileRow({
  file,
  conversationId,
  checkpointId,
}: {
  file: ChangedFile;
  conversationId: string;
  checkpointId: string;
}) {
  return (
    <Collapsible className="group/file">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded px-1 py-1 text-left font-mono text-xs outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/file:rotate-90"
        />
        <span className="min-w-0 flex-1 truncate">{file.path}</span>
        <span className="shrink-0 text-success">+{file.added}</span>
        <span className="shrink-0 text-destructive">-{file.removed}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1">
        <FileDiff conversationId={conversationId} checkpointId={checkpointId} path={file.path} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The "N files changed" row of one turn, placed after that turn's last answer. `entryId` is the turn's user message. */
export function TurnChanges({ conversationId, entryId }: { conversationId: string; entryId: string }) {
  const checkpoints = useCheckpoints(conversationId);
  const after = checkpoints.data?.find((item) => item.kind === "after" && item.entryId === entryId);
  if (!after || after.files.length === 0) return null;
  return (
    <Collapsible className="group/turn overflow-hidden rounded-lg border bg-card text-card-foreground">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/turn:rotate-90"
        />
        <span className="font-medium">{filesLabel(after.files.length)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1 border-t p-2">
        {after.files.map((file) => (
          <FileRow key={file.path} file={file} conversationId={conversationId} checkpointId={after.id} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
