import { findModel, readAgent } from "@/conversation/model/agent";
import { useConversationView } from "@/conversation/use-conversation-view";
import { useModels } from "@/lib/queries";

/** The model and thinking level of a thread, from its live view. Needs that thread's node provider. */
export function useThreadAgent(conversationId: string) {
  const state = useConversationView(conversationId);
  const models = useModels().data;
  if (state.status !== "ready") return { model: undefined, level: undefined };
  const agent = readAgent(state.view);
  return { model: findModel(agent, models), level: agent.thinkingLevel };
}
