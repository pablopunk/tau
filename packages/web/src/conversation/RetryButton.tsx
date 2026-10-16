import { RotateCw } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { newRequestId } from "./use-conversation-actions";

export function RetryButton({ onRetry }: { onRetry(requestId: string): Promise<void> }) {
  const requestId = useRef<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const retry = () => {
    requestId.current ??= newRequestId();
    setPending(true);
    setError(undefined);
    onRetry(requestId.current)
      .then(() => {
        requestId.current = undefined;
      })
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "Could not retry."))
      .finally(() => setPending(false));
  };

  return (
    <div className="space-y-1">
      <Button variant="outline" size="sm" disabled={pending} onClick={retry}>
        <RotateCw /> Retry
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
