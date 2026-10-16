import type { ModelInfo, ModelRef } from "@pi-everywhere/protocol";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";

const keyOf = (ref: ModelRef) => `${ref.provider}/${ref.modelId}`;

const toOption = (model: ModelInfo): ComboboxOption => ({
  value: keyOf(model),
  label: model.name,
  description: model.modelId,
});

interface ModelComboboxProps {
  models: ModelInfo[];
  value: ModelRef | null;
  onChange: (ref: ModelRef) => void;
  id?: string;
  disabled?: boolean;
}

export function ModelCombobox({ models, value, onChange, id, disabled }: ModelComboboxProps) {
  return (
    <Combobox
      id={id}
      disabled={disabled}
      options={models.map(toOption)}
      value={value ? keyOf(value) : null}
      placeholder="Select a model…"
      searchPlaceholder="Search models…"
      emptyText="No model found."
      onChange={(key) => {
        const model = models.find((candidate) => keyOf(candidate) === key);
        if (model) onChange({ provider: model.provider, modelId: model.modelId });
      }}
    />
  );
}
