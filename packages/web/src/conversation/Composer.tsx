import type { ImageInput } from "@pi-everywhere/protocol";
import { ArrowUp, Paperclip, Square } from "lucide-react";
import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { DropZone } from "@/components/ui/drop-zone";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AttachmentRow } from "./composer/AttachmentRow";
import { loadDraft, saveDraft } from "./composer/drafts";
import { usePageDrag } from "./composer/use-page-drop";
import { useAttachments } from "./images/use-attachments";

export interface ComposerProps {
  /** Draft key: `"new"` for the new thread page, the conversation id in a thread. */
  target: "new" | string;
  imagesAllowed: boolean;
  busy?: boolean;
  /** Rendered under the input box, e.g. the project picker. */
  footer?: ReactNode;
  /** Rendered inside the input box toolbar after the attach button, e.g. model and thinking. */
  toolbar?: ReactNode;
  onSend(input: { text: string; images: ImageInput[] }): Promise<void>;
  onStop?(): Promise<void>;
  /** Called right after a message is handed to `onSend`, e.g. to scroll to it. */
  onSent?(): void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Could not reach the server.";
}

function isPlainEnter(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing;
}

function pastedFiles(event: ClipboardEvent): File[] {
  return Array.from(event.clipboardData.files);
}

function ComposerForm({
  target,
  imagesAllowed,
  busy = false,
  footer,
  toolbar,
  onSend,
  onStop,
  onSent,
}: ComposerProps) {
  const [text, setTextState] = useState(() => loadDraft(target));
  const [error, setError] = useState<string>();
  const [stopping, setStopping] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const { attachments, preparing, addFiles, remove, replace } = useAttachments(target, imagesAllowed);
  const [pageDragging, endPageDrag] = usePageDrag(true);
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !preparing;

  const setText = (value: string) => {
    saveDraft(target, value);
    setTextState(value);
  };

  const submit = () => {
    const message = text.trim();
    const sent = attachments;
    if (!canSend) return;
    setText("");
    replace([]);
    setError(undefined);
    onSent?.();
    onSend({ text: message, images: sent.map((item) => item.image) }).catch((failure: unknown) => {
      setText(message);
      replace(sent);
      setError(errorText(failure));
    });
  };

  const stop = () => {
    if (!onStop) return;
    setStopping(true);
    onStop()
      .catch((failure: unknown) => setError(errorText(failure)))
      .finally(() => setStopping(false));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && busy) return stop();
    if (!isPlainEnter(event)) return;
    event.preventDefault();
    submit();
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = pastedFiles(event).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  };

  const onPicked = (files: FileList | null) => {
    addFiles(Array.from(files ?? []));
    if (picker.current) picker.current.value = "";
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      {pageDragging ? (
        <DropZone
          className="fixed inset-0 z-50"
          onFiles={(files) => {
            endPageDrag();
            addFiles(files);
          }}
        >
          <span className="sr-only">Drop images to attach</span>
        </DropZone>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="rounded-2xl border bg-card p-2 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <AttachmentRow attachments={attachments} onRemove={remove} />
        <Textarea
          aria-label="Message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={busy ? "Steer the agent…" : "Message the agent…"}
          rows={1}
          className="max-h-48 min-h-9 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center gap-1">
          {imagesAllowed ? (
            <>
              <Input
                ref={picker}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                tabIndex={-1}
                aria-label="Choose images"
                className="hidden"
                onChange={(event) => onPicked(event.target.files)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Attach images"
                onClick={() => picker.current?.click()}
              >
                <Paperclip />
              </Button>
            </>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-1">{toolbar}</div>
          {busy && onStop ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Stop"
              disabled={stopping}
              onClick={stop}
            >
              <Square className="fill-current" />
            </Button>
          ) : null}
          <Button type="submit" size="icon" aria-label={busy ? "Send as steer" : "Send"} disabled={!canSend}>
            <ArrowUp />
          </Button>
        </div>
      </div>
      {footer}
    </form>
  );
}

export function Composer(props: ComposerProps) {
  return <ComposerForm key={props.target} {...props} />;
}
