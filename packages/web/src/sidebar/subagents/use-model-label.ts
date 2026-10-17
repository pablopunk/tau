import type { ModelRef } from "@pi-everywhere/protocol";
import { useModels } from "@/lib/queries";

const keyOf = (model: ModelRef) => `${model.provider}/${model.modelId}`;

export function useModelLabel() {
  const models = useModels().data;
  const nameOf = (key: string) => models?.find((model) => keyOf(model) === key)?.name;
  return {
    ofRef: (model: ModelRef | null | undefined) =>
      model ? (nameOf(keyOf(model)) ?? model.modelId) : undefined,
    ofKey: (key: string) => nameOf(key) ?? key,
  };
}
