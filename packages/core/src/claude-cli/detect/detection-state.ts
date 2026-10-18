import type { ClaudeCliState } from "@tau/protocol";
import type { ClaudeAuthStatus } from "../sdk-types";

export const isMissingBinary = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";

export function stateOfAuth(auth: ClaudeAuthStatus, noticed: boolean): ClaudeCliState {
  if (!auth.loggedIn) return "logged_out";
  if (auth.authMethod !== "claude.ai") return "not_plan";
  return noticed ? "ready" : "needs_notice";
}

export const failureMessage = (error: unknown): string =>
  `Could not check the claude CLI: ${error instanceof Error ? error.message : "unknown error"}`;
