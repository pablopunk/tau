import type { ConversationView } from "@pi-everywhere/protocol";
import { Badge } from "@/components/ui/badge";
import { useModels } from "@/lib/queries";
import { findModel, readAgent } from "./model/agent";

export function ThreadToolbar({ view }: { view: ConversationView }) {
  const models = useModels().data;
  const agent = readAgent(view);
  const modelName = findModel(agent, models)?.name ?? agent.modelId;
  return (
    <>
      {modelName ? <Badge variant="outline">{modelName}</Badge> : null}
      <Badge variant="secondary">Thinking: {agent.thinkingLevel}</Badge>
    </>
  );
}
