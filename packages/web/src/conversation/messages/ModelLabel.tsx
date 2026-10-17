import type { AssistantMessage } from "@pi-everywhere/protocol";
import { useModels } from "@/lib/queries";

export function ModelLabel({ message }: { message: AssistantMessage }) {
  const models = useModels().data;
  const known = models?.find((m) => m.provider === message.provider && m.modelId === message.model);
  return (
    <span className="truncate text-xs text-muted-foreground" data-testid="model-label">
      {known?.name ?? message.model}
    </span>
  );
}
