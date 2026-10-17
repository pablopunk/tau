import type { LoginSession } from "@pi-everywhere/protocol";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";

const POLL_MS = 1000;
const isActive = (session: LoginSession) => session.state === "starting" || session.state === "waiting";

function useStartedSession(attempt: number, onFailure: (message: string) => void) {
  const [session, setSession] = useState<LoginSession | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new login only starts on a new attempt.
  useEffect(() => {
    let alive = true;
    let startedId: string | undefined;
    api.logins
      .start()
      .then((started) => {
        startedId = started.id;
        if (alive) setSession(started);
        else void api.logins.cancel(started.id).catch(() => {});
      })
      .catch((caught) => alive && onFailure(errorMessage(caught)));
    return () => {
      alive = false;
      if (startedId) void api.logins.cancel(startedId).catch(() => {});
    };
  }, [attempt]);
  return [session, setSession] as const;
}

function usePolling(session: LoginSession | null, update: (session: LoginSession) => void) {
  const id = session && isActive(session) ? session.id : null;
  useEffect(() => {
    if (!id) return;
    const timer = setInterval(() => {
      api.logins
        .get(id)
        .then(update)
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [id, update]);
}

export function useChatGptLogin() {
  const [attempt, setAttempt] = useState(0);
  const [startError, setStartError] = useState<string | null>(null);
  const [session, setSession] = useStartedSession(attempt, setStartError);
  usePolling(session, setSession);

  return {
    session,
    startError,
    update: setSession,
    retry: () => {
      setSession(null);
      setStartError(null);
      setAttempt((count) => count + 1);
    },
  };
}
