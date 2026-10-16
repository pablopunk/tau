import { useState } from "react";
import { errorMessage } from "@/lib/error-message";

/** Runs an async action, tracking pending state and the API error message to show inline. */
export function useSubmit() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const run = async (action: () => Promise<void>): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setPending(false);
    }
  };
  return { run, error, pending, clearError: () => setError(null) };
}
