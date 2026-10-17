import type { LoginSession } from "@pi-everywhere/protocol";
import { notImplemented } from "../not-implemented";

/** Frozen shape; Phase 1 (A) implements it on `models.login("openai", "oauth", ...)`. */
export interface LoginSessions {
  start(): Promise<LoginSession>;
  get(sessionId: string): Promise<LoginSession>;
  submitUrl(sessionId: string, url: string): Promise<LoginSession>;
  cancel(sessionId: string): Promise<void>;
}

export function createLoginSessions(): LoginSessions {
  const unavailable = () => {
    throw notImplemented("ChatGPT sign-in");
  };
  return { start: unavailable, get: unavailable, submitUrl: unavailable, cancel: unavailable };
}
