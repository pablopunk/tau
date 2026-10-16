import type { ModelInfo, ModelRef } from "@pi-everywhere/protocol";
import { Combobox, type ComboboxOption, type ComboboxProps } from "@/components/ui/combobox";

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
  className?: string;
  variant?: ComboboxProps["variant"];
  size?: ComboboxProps["size"];
  ariaLabel?: string;
  /** Extra first option that clears the choice (e.g. "Same as thread"). */
  clearLabel?: string;
  onClear?: () => void;
}

const CLEAR_KEY = "__clear__";

export function ModelCombobox({
  models,
  value,
  onChange,
  id,
  disabled,
  className,
  variant,
  size,
  ariaLabel,
  clearLabel,
  onClear,
}: ModelComboboxProps) {
  const options = models.map(toOption);
  const clearOption: ComboboxOption[] = clearLabel ? [{ value: CLEAR_KEY, label: clearLabel }] : [];
  return (
    <Combobox
      id={id}
      disabled={disabled}
      className={className}
      contentClassName="w-[min(32rem,calc(100vw-2rem))]"
      variant={variant}
      size={size}
      aria-label={ariaLabel}
      options={[...clearOption, ...options]}
      value={value ? keyOf(value) : clearLabel ? CLEAR_KEY : null}
      placeholder="Select a model…"
      searchPlaceholder="Search models…"
      emptyText="No model found."
      onChange={(key) => {
        if (key === CLEAR_KEY) return onClear?.();
        const model = models.find((candidate) => keyOf(candidate) === key);
        if (model) onChange({ provider: model.provider, modelId: model.modelId });
      }}
    />
  );
}
