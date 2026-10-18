const KEY = "tau:new-thread-request";

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function draftRequestId(): string {
  try {
    const existing = window.sessionStorage.getItem(KEY);
    if (existing) return existing;
    const created = newRequestId();
    window.sessionStorage.setItem(KEY, created);
    return created;
  } catch {
    return newRequestId();
  }
}

export function clearDraftRequestId(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // sessionStorage unavailable: nothing to clear
  }
}
