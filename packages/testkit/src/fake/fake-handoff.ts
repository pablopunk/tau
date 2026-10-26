import {
  type ConversationSummary,
  type Core,
  emptyHandoffLosses,
  NATIVE_DISABLED_REASON,
  nativeDisabledError,
  validatedHandoffInstruction,
} from "@tau/protocol";

type HandoffApi = Pick<Core["conversations"], "handoffPreview" | "handoff">;

/** The fake node never has native on, so a handoff is never possible: it answers like the real core does then. */
export function createFakeHandoff(deps: {
  requireConversation: (id: string) => { summary(): ConversationSummary };
}): HandoffApi {
  return {
    async handoffPreview(id) {
      deps.requireConversation(id);
      return { canHandoff: false, reason: NATIVE_DISABLED_REASON, losses: emptyHandoffLosses(), preview: "" };
    },
    async handoff(id, input) {
      validatedHandoffInstruction(input);
      deps.requireConversation(id);
      throw nativeDisabledError();
    },
  };
}
