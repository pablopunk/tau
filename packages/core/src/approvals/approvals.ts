import { AppError } from "@tau/protocol";
import type { ChangeEmitter } from "../change-emitter";
import type { SettingsStore } from "../home/settings-store";
import type { Approvals } from "./approvals-port";

export interface ApprovalsDeps {
  readonly settings: Pick<SettingsStore, "get" | "setClaudeConnectors">;
  readonly changes: ChangeEmitter;
  readonly conversationOfSession: (piSessionId: string) => Promise<string | undefined>;
}

const NOT_AVAILABLE = "Approvals are not available yet.";

const isAlwaysAllowed = async (deps: ApprovalsDeps, cliToolName: string): Promise<boolean> =>
  (await deps.settings.get()).claudeConnectors.alwaysAllow.includes(cliToolName);

/** Owner C replaces the body. Until then every request is denied, so nothing runs unasked. */
export function createApprovals(deps: ApprovalsDeps): Approvals {
  return {
    request: async () => ({ allowed: false, message: NOT_AVAILABLE }),
    list: () => [],
    decide: async () => {
      throw new AppError("not_found", "No such tool call is waiting.");
    },
    denyAll: () => undefined,
    hasPending: () => false,
    isAlwaysAllowed: (cliToolName) => isAlwaysAllowed(deps, cliToolName),
  };
}
