import { createHash, timingSafeEqual } from "node:crypto";

export interface Session {
  readonly cookieName: string;
  isValidToken(candidate: unknown): boolean;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function createSession(token: string, port: number): Session {
  const expected = digest(token);
  return {
    cookieName: `pie_${port}`,
    isValidToken: (candidate) =>
      typeof candidate === "string" && timingSafeEqual(digest(candidate), expected),
  };
}
