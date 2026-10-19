import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/error-message";
import { useApi } from "@/machines/machine-context";
import type { MessageEntry } from "../messages/message-actions";
import { useOpenThread } from "./use-open-thread";

const ACTION_LABELS = { write: "Restore", delete: "Delete" } as const;

function PreviewList({ entry }: { entry: MessageEntry }) {
  const api = useApi();
  const preview = useQuery({
    queryKey: ["rewind-preview", entry.conversationId, entry.entryId],
    queryFn: () => api.conversations.rewindPreview(entry.conversationId, entry.entryId),
    gcTime: 0,
  });
  if (preview.isPending) return <Spinner aria-label="Loading changes" />;
  if (preview.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(preview.error)}</AlertDescription>
      </Alert>
    );
  }
  if (preview.data.changes.length === 0) {
    return <p className="text-sm text-muted-foreground">No files change. Only the conversation rewinds.</p>;
  }
  return (
    <ul aria-label="Files that change" className="max-h-60 space-y-1 overflow-auto font-mono text-xs">
      {preview.data.changes.map((change) => (
        <li key={change.path} className="flex gap-2">
          <span className="w-14 shrink-0 text-muted-foreground">{ACTION_LABELS[change.action]}</span>
          <span className="min-w-0 break-all">{change.path}</span>
        </li>
      ))}
    </ul>
  );
}

export function RewindDialog({
  entry,
  open,
  onOpenChange,
}: {
  entry: MessageEntry;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const api = useApi();
  const openThread = useOpenThread();
  const rewind = useMutation({
    mutationFn: () => api.conversations.rewind(entry.conversationId, entry.entryId),
    onSuccess: async ({ conversation, draft }) => {
      onOpenChange(false);
      await openThread(conversation, draft);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry.startsConversation ? "Rewind to start?" : "Rewind to here?"}</DialogTitle>
          <DialogDescription>
            Files go back to how they were before this message. A new thread opens with the conversation up to
            this point, and the message waits in its composer.
          </DialogDescription>
        </DialogHeader>
        {open ? <PreviewList entry={entry} /> : null}
        <p className="text-sm text-muted-foreground">
          Ignored files (such as node_modules) and anything outside this folder are not undone.
        </p>
        {rewind.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(rewind.error)}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={rewind.isPending} onClick={() => rewind.mutate()}>
            Rewind
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
