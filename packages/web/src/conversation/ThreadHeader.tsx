import type { ConversationView } from "@pi-everywhere/protocol";
import { Badge } from "@/components/ui/badge";
import { useAllConversations, useModels } from "@/lib/queries";
import { findModel, readAgent } from "./model/agent";

export function ThreadHeader({ id, view }: { id: string; view: ConversationView }) {
  const summaries = useAllConversations().data;
  const models = useModels().data;
  const agent = readAgent(view);
  const title = summaries?.find((summary) => summary.id === id)?.title || "Conversation";
  const modelName = findModel(agent, models)?.name ?? agent.modelId;
  return (
    <header className="flex min-w-0 items-center gap-2 border-b px-4 py-2">
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
      {modelName ? <Badge variant="outline">{modelName}</Badge> : null}
      <Badge variant="secondary">Thinking: {agent.thinkingLevel}</Badge>
    </header>
  );
}
