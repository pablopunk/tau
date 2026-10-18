/** Owner B implements it in the adapter; owner A's `claude_connector` calls it on Stop. */
export interface InterruptConversationPort {
  /** Idempotent. Does nothing when the query has no open turn. */
  interruptConversation(piSessionId: string): Promise<void>;
}
