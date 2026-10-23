import type { ReactNode } from "react";
import { PendingFirstMessage } from "@/conversation/PendingFirstMessage";
import { ThreadHeader } from "@/conversation/ThreadHeader";
import type { FirstMessage } from "./first-message";

export function StartingThread({
  message,
  normalContent,
  composer,
}: {
  message?: FirstMessage;
  normalContent: ReactNode;
  composer: ReactNode;
}) {
  const starting = message !== undefined;
  return (
    <div
      className={
        starting
          ? "relative flex h-full min-h-0 flex-col bg-background"
          : "flex flex-1 flex-col items-center justify-center gap-4 p-6"
      }
    >
      {starting ? <ThreadHeader id="new-thread" title="New thread" /> : normalContent}
      <div className={starting ? "flex min-h-0 flex-1" : "contents"}>
        <div className={starting ? "relative flex min-h-0 min-w-0 flex-1 flex-col" : "contents"}>
          <div
            className={
              starting ? "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain" : "contents"
            }
          >
            {message ? (
              <div className="relative mx-auto w-full min-w-0 max-w-3xl px-4 py-6">
                <section aria-label="Conversation" aria-live="polite" aria-relevant="additions">
                  <PendingFirstMessage message={message} />
                </section>
              </div>
            ) : null}
          </div>
          {composer}
        </div>
      </div>
    </div>
  );
}
