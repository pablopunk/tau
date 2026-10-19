import type { ModelInfo, ModelRef } from "@tau/protocol";
import { Combobox, type ComboboxOption, type ComboboxProps } from "@/components/ui/combobox";

const keyOf = (ref: ModelRef) => `${ref.provider}/${ref.modelId}`;

const CLAUDE_CLI = "claude-cli";

const ownAlias = (model: ModelInfo) => ` (${model.modelId})`;

const bareName = (model: ModelInfo) =>
  model.name.endsWith(ownAlias(model)) ? model.name.slice(0, -ownAlias(model).length) : model.name;

export const claudeCliRowLabel = (model: ModelInfo) => `${bareName(model)}${ownAlias(model)}`;

export const claudeCliHeaderLabel = (model: ModelInfo) => `${model.providerName} · ${bareName(model)}`;

export const modelRowLabel = (model: ModelInfo): string =>
  model.provider === CLAUDE_CLI ? claudeCliRowLabel(model) : model.name;

const triggerLabelOf = (model: ModelInfo): string | undefined =>
  model.provider === CLAUDE_CLI ? claudeCliHeaderLabel(model) : undefined;

const toOption = (model: ModelInfo): ComboboxOption => ({
  value: keyOf(model),
  label: modelRowLabel(model),
  triggerLabel: triggerLabelOf(model),
  description: keyOf(model),
  group: model.providerName,
  keywords: [model.modelId],
});

export const claudeCliFirst = (models: ModelInfo[]): ModelInfo[] => [
  ...models.filter((model) => model.provider === CLAUDE_CLI),
  ...models.filter((model) => model.provider !== CLAUDE_CLI),
];

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
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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
  open,
  onOpenChange,
  clearLabel,
  onClear,
}: ModelComboboxProps) {
  const options = claudeCliFirst(models).map(toOption);
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
      open={open}
      onOpenChange={onOpenChange}
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
