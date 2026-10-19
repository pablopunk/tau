import type { ModelInfo } from "@tau/protocol";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { useModels } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";
import { claudeCliFirst, modelRowLabel } from "@/setup/ModelCombobox";
import { attempt } from "./attempt";
import { useThreadAgent } from "./use-thread-agent";

const byProvider = (models: ModelInfo[]) =>
  [...new Set(models.map((model) => model.providerName))].map((name) => ({
    name,
    models: models.filter((model) => model.providerName === name),
  }));

/** The palette's second page: pick the model of the open thread. Must render under that thread's node provider. */
export function ModelPage({
  conversationId,
  run,
}: {
  conversationId: string;
  run: (action: () => void) => () => void;
}) {
  const api = useApi();
  const current = useThreadAgent(conversationId).model;
  const models = claudeCliFirst(useModels().data ?? []);
  const choose = (model: ModelInfo) =>
    run(
      attempt(() =>
        api.conversations.configure(conversationId, {
          model: { provider: model.provider, modelId: model.modelId },
        }),
      ),
    );
  return (
    <>
      {byProvider(models).map((group) => (
        <CommandGroup key={group.name} heading={group.name}>
          {group.models.map((model) => (
            <CommandItem
              key={`${model.provider}/${model.modelId}`}
              value={`${model.provider}/${model.modelId} ${model.name}`}
              data-checked={model.provider === current?.provider && model.modelId === current?.modelId}
              onSelect={choose(model)}
            >
              {modelRowLabel(model)}
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </>
  );
}
