import type { ConfigureConversationInput, ConversationView, ModelRef, ThinkingLevel } from "@tau/protocol";
import type { Ref } from "react";
import { toast } from "sonner";
import { ModelThinkingPickers, type PickersHandle } from "@/components/ModelThinkingPickers";
import { ContextMeter } from "@/components/ui/context-meter";
import { GoalChip } from "@/goal/GoalChip";
import { errorMessage } from "@/lib/error-message";
import { useModels } from "@/lib/queries";
import { useApi } from "@/machines/machine-context";
import { ProcessesChip } from "@/processes/ProcessesChip";
import { TimersChip } from "@/timers/TimersChip";
import { contextUsage } from "./composer/context-usage";
import { findModel, readAgent } from "./model/agent";

export function ThreadToolbar({
  id,
  view,
  pickers,
}: {
  id: string;
  view: ConversationView;
  pickers?: Ref<PickersHandle>;
}) {
  const api = useApi();
  const models = useModels().data;
  const configure = (conversationId: string, input: ConfigureConversationInput) =>
    api.conversations
      .configure(conversationId, input)
      .catch((error) => void toast.error(errorMessage(error)));
  const agent = readAgent(view);
  if (!models) return null;
  const current = findModel(agent, models);
  const model: ModelRef | null = current ? { provider: current.provider, modelId: current.modelId } : null;
  const usage = current ? contextUsage(view.entries, current.contextWindow) : null;
  return (
    <>
      <ModelThinkingPickers
        ref={pickers}
        models={models}
        model={model}
        onModel={(ref) => void configure(id, { model: ref })}
        levels={current?.thinkingLevels ?? ["off"]}
        level={agent.thinkingLevel}
        onLevel={(thinkingLevel: ThinkingLevel) => void configure(id, { thinkingLevel })}
      />
      <div className="ml-auto flex items-center gap-2">
        {usage ? <ContextMeter used={usage.used} total={usage.total} label={usage.label} /> : null}
        <GoalChip conversationId={id} />
        <ProcessesChip conversationId={id} />
        <TimersChip conversationId={id} />
      </div>
    </>
  );
}
