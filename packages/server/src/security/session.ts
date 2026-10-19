import { createHash, timingSafeEqual } from "node:crypto";

export interface Session {
  readonly cookieName: string;
  isValidToken(candidate: unknown): boolean;
  /** The live master token (the responder's loopback calls read it, so a rotate needs no restart). */
  currentToken(): string;
  /**
   * `tau access rotate`: swaps the master token live. The cookie value IS the master token, so every
   * local owner browser is signed out and the old token stops working at once.
   */
  rotate(token: string): void;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function createSession(token: string, port: number): Session {
  let current = token;
  let expected = digest(token);
  return {
    cookieName: `tau_${port}`,
    isValidToken: (candidate) =>
      typeof candidate === "string" && timingSafeEqual(digest(candidate), expected),
    currentToken: () => current,
    rotate(next) {
      current = next;
      expected = digest(next);
    },
  };
}
