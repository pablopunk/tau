import type {
  ConfigureConversationInput,
  ConversationView,
  ExecutorKind,
  ModelRef,
  ThinkingLevel,
} from "@tau/protocol";
import { contextUsageInputOf } from "@tau/protocol";
import type { Ref } from "react";
import { toast } from "sonner";
import { ModelThinkingPickers, type PickersHandle } from "@/components/ModelThinkingPickers";
import { Badge } from "@/components/ui/badge";
import { ContextMeter } from "@/components/ui/context-meter";
import { GoalChip } from "@/goal/GoalChip";
import { errorMessage } from "@/lib/error-message";
import { useModels } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";
import { ProcessesChip } from "@/processes/ProcessesChip";
import { TimersChip } from "@/timers/TimersChip";
import { contextUsage } from "./composer/context-usage";
import { findModel, readAgent } from "./model/agent";
import { isNativeExecutor, NATIVE_LABEL } from "./model/executor";
import type { SidebarSectionId } from "./sidebar/sections";

export function ThreadToolbar({
  id,
  view,
  pickers,
  sidebarOpen,
  onRevealSection,
  executor,
}: {
  id: string;
  view: ConversationView;
  pickers?: Ref<PickersHandle>;
  /** When the right sidebar is open these chips live there instead. */
  sidebarOpen?: boolean;
  /** When collapsed, indicators jump to the sidebar section instead of their popover. */
  onRevealSection?: (section: SidebarSectionId) => void;
  /** A native thread has no Pi model, thinking level or Pi-only chips: it shows its engine instead. */
  executor?: ExecutorKind;
}) {
  const api = useApi();
  const models = useModels().data;
  const configure = (conversationId: string, input: ConfigureConversationInput) =>
    api.conversations
      .configure(conversationId, input)
      .catch((error) => void toast.error(errorMessage(error)));
  if (isNativeExecutor(executor)) return <Badge variant="outline">{NATIVE_LABEL}</Badge>;
  const agent = readAgent(view);
  if (!models) return null;
  const current = findModel(agent, models);
  const model: ModelRef | null = current ? { provider: current.provider, modelId: current.modelId } : null;
  const usage = current ? contextUsage(contextUsageInputOf(view), current.contextWindow) : null;
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
      <div className="ml-auto flex items-center gap-2 self-center">
        {sidebarOpen ? null : (
          <>
            {usage ? <ContextMeter used={usage.used} total={usage.total} label={usage.label} /> : null}
            <GoalChip
              conversationId={id}
              onReveal={onRevealSection ? () => onRevealSection("goal") : undefined}
            />
            <ProcessesChip
              conversationId={id}
              onReveal={onRevealSection ? () => onRevealSection("processes") : undefined}
            />
            <TimersChip
              conversationId={id}
              onReveal={onRevealSection ? () => onRevealSection("timers") : undefined}
            />
          </>
        )}
      </div>
    </>
  );
}
