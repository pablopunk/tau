import type {
  ConfigureConversationInput,
  ConversationView,
  ModelRef,
  ThinkingLevel,
} from "@pi-everywhere/protocol";
import { toast } from "sonner";
import { ModelThinkingPickers } from "@/components/ModelThinkingPickers";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { useModels } from "@/lib/queries";
import { findModel, readAgent } from "./model/agent";

const configure = (id: string, input: ConfigureConversationInput) =>
  api.conversations.configure(id, input).catch((error) => void toast.error(errorMessage(error)));

export function ThreadToolbar({ id, view }: { id: string; view: ConversationView }) {
  const models = useModels().data;
  const agent = readAgent(view);
  if (!models) return null;
  const current = findModel(agent, models);
  const model: ModelRef | null = current ? { provider: current.provider, modelId: current.modelId } : null;
  return (
    <ModelThinkingPickers
      models={models}
      model={model}
      onModel={(ref) => void configure(id, { model: ref })}
      levels={current?.thinkingLevels ?? ["off"]}
      level={agent.thinkingLevel}
      onLevel={(thinkingLevel: ThinkingLevel) => void configure(id, { thinkingLevel })}
    />
  );
}
