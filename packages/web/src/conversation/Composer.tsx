import { ArrowUp, Square } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export interface ComposerProps {
  readonly busy: boolean;
  readonly onSend: (text: string) => Promise<void>;
  readonly onStop: () => Promise<void>;
  /** Called right after a message is handed to `onSend`, e.g. to scroll to it. */
  readonly onSent?: () => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Could not reach the server.";
}

function isPlainEnter(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing;
}

export function Composer({ busy, onSend, onStop, onSent }: ComposerProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [stopping, setStopping] = useState(false);
  const canSend = text.trim().length > 0;

  const submit = () => {
    const message = text.trim();
    if (!message) return;
    setText("");
    setError(undefined);
    onSent?.();
    onSend(message).catch((failure: unknown) => {
      setText((current) => current || message);
      setError(errorText(failure));
    });
  };

  const stop = () => {
    setStopping(true);
    onStop()
      .catch((failure: unknown) => setError(errorText(failure)))
      .finally(() => setStopping(false));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isPlainEnter(event)) return;
    event.preventDefault();
    submit();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <Textarea
          aria-label="Message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={busy ? "Steer the agent…" : "Message the agent…"}
          rows={1}
          className="max-h-48 min-h-9 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        {busy ? (
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
    </form>
  );
}
