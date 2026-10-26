import { HANDOFF_INSTRUCTION_MAX_LENGTH, HANDOFF_PREVIEW_CHARS, type HandoffPreview } from "@tau/protocol";
import { type FormEvent, useId, useState } from "react";
import { useSubmit } from "@/app/use-submit";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useOpenThread } from "@/conversation/checkpoints/use-open-thread";
import { newRequestId } from "@/conversation/use-conversation-actions";
import { errorMessage } from "@/lib/error-message";
import { useHandoffPreview } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";
import { handoffLossLines } from "./loss-lines";

export const HANDOFF_DIALOG_TITLE = "Continue in Claude Code";
export const HANDOFF_NEW_THREAD_NOTE = "Creates a new thread. This thread is not changed.";
const UNAVAILABLE_FALLBACK = "A handoff is not possible right now.";

function Losses({ preview }: { preview: HandoffPreview }) {
  return (
    <ul aria-label="What is left out" className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
      {handoffLossLines(preview.losses).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function PreviewBody({ preview }: { preview: HandoffPreview }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <CodeBlock text={preview.preview} />
      {preview.preview.length >= HANDOFF_PREVIEW_CHARS ? (
        <p className="text-xs text-muted-foreground">Showing the start of what Claude Code receives.</p>
      ) : null}
      <Losses preview={preview} />
    </div>
  );
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function PreviewSection({ conversationId }: { conversationId: string }) {
  const preview = useHandoffPreview(conversationId);
  if (preview.isPending) return <Spinner aria-label="Loading preview" />;
  if (preview.isError) return <ErrorAlert message={errorMessage(preview.error)} />;
  if (!preview.data.canHandoff) {
    return (
      <Alert>
        <AlertDescription>{preview.data.reason ?? UNAVAILABLE_FALLBACK}</AlertDescription>
      </Alert>
    );
  }
  return <PreviewBody preview={preview.data} />;
}

interface HandoffDialogProps {
  conversationId: string;
  onClose: () => void;
}

/** Mount it only while open: the request id and the typed instruction last for one opening. */
export function HandoffDialog({ conversationId, onClose }: HandoffDialogProps) {
  const api = useApi();
  const openThread = useOpenThread();
  const instructionId = useId();
  const [requestId] = useState(newRequestId);
  const [instruction, setInstruction] = useState("");
  const preview = useHandoffPreview(conversationId);
  const { run, error, pending } = useSubmit();
  const ready = preview.data?.canHandoff === true;
  const refused = preview.data !== undefined && !preview.data.canHandoff;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = instruction.trim();
    const sent = await run(async () => {
      const thread = await api.conversations.handoff(conversationId, {
        requestId,
        ...(text === "" ? {} : { instruction: text }),
      });
      await openThread(thread);
    });
    if (sent) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{HANDOFF_DIALOG_TITLE}</DialogTitle>
            <DialogDescription>{HANDOFF_NEW_THREAD_NOTE}</DialogDescription>
          </DialogHeader>
          <PreviewSection conversationId={conversationId} />
          {ready ? (
            <Field>
              <FieldLabel htmlFor={instructionId}>Instruction (optional)</FieldLabel>
              <Textarea
                id={instructionId}
                value={instruction}
                maxLength={HANDOFF_INSTRUCTION_MAX_LENGTH}
                placeholder="What should Claude Code do first?"
                onChange={(event) => setInstruction(event.target.value)}
              />
              <FieldDescription>Sent to Claude Code with the history above.</FieldDescription>
            </Field>
          ) : null}
          {error ? <ErrorAlert message={error} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {refused ? null : (
              <Button type="submit" disabled={!ready || pending}>
                Create thread
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
