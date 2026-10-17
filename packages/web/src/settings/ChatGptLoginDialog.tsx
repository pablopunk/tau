import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { FormError } from "@/app/FormError";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { invalidateProviders } from "@/lib/queries";
import { CallbackUrlField } from "./CallbackUrlField";
import { CHATGPT_COPY } from "./provider-status";
import { useChatGptLogin } from "./use-chatgpt-login";

function LoginBody({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const { session, startError, update, retry } = useChatGptLogin();
  const state = session?.state;

  useEffect(() => {
    if (state !== "done") return;
    void invalidateProviders(queryClient);
    onDone();
  }, [state, queryClient, onDone]);

  if (startError) return <FormError message={startError} />;
  if (!session) return <Skeleton className="h-9 w-full" />;
  if (state === "failed" || state === "cancelled") {
    return (
      <div className="flex flex-col gap-3">
        <FormError message={session.error ?? "Sign-in ended."} />
        <Button onClick={retry}>Try again</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Button disabled={!session.authUrl} asChild={Boolean(session.authUrl)}>
        {session.authUrl ? (
          <a href={session.authUrl} target="_blank" rel="noreferrer">
            Open sign-in page
          </a>
        ) : (
          "Open sign-in page"
        )}
      </Button>
      <CallbackUrlField sessionId={session.id} serverError={session.error} onSession={update} />
    </div>
  );
}

export function ChatGptLoginDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign in with ChatGPT</DialogTitle>
          <DialogDescription>{CHATGPT_COPY}</DialogDescription>
        </DialogHeader>
        <LoginBody onDone={onClose} />
      </DialogContent>
    </Dialog>
  );
}
