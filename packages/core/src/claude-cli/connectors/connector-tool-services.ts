import type { InterruptConversationPort } from "../ports";
import { createObservedResultStore, type ObservedResultStore } from "./observed-results";

/** What the `claude_connector` tool needs. */
export interface ClaudeConnectorToolServices extends InterruptConversationPort {
  readonly observed: ObservedResultStore;
}

export const createConnectorToolServices = (): ClaudeConnectorToolServices => ({
  observed: createObservedResultStore(),
  interruptConversation: async () => undefined,
});
