import { useCallback, useState } from "react";

const KEY = "tau:conversation-sidebar-open";

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "closed";
  } catch {
    return true;
  }
}

/** Right-sidebar open state for the conversation view, persisted across reloads. Defaults open. */
export function useConversationSidebarOpen() {
  const [open, setOpenState] = useState(readOpen);
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      window.localStorage.setItem(KEY, next ? "open" : "closed");
    } catch {
      // Storage unavailable: the sidebar just does not persist.
    }
  }, []);
  const toggle = useCallback(() => {
    setOpenState((prev) => {
      try {
        window.localStorage.setItem(KEY, !prev ? "open" : "closed");
      } catch {
        // Storage unavailable: the sidebar just does not persist.
      }
      return !prev;
    });
  }, []);
  return { open, setOpen, toggle };
}
