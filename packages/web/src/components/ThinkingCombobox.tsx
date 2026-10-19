import type { ThinkingLevel } from "@tau/protocol";
import { BrainIcon } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";

const MODEL_DEFAULT = "__model_default__";

export const hasReasoning = (levels: ThinkingLevel[]) => levels.some((level) => level !== "off");

interface ThinkingComboboxProps {
  levels: ThinkingLevel[];
  value: ThinkingLevel | null;
  onChange: (level: ThinkingLevel | null) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
}

export function ThinkingCombobox({
  levels,
  value,
  onChange,
  id,
  disabled,
  className,
}: ThinkingComboboxProps) {
  if (!hasReasoning(levels)) return null;
  return (
    <Combobox
      id={id}
      aria-label="Thinking level"
      triggerIcon={<BrainIcon className="opacity-60" />}
      className={className}
      searchable={false}
      disabled={disabled}
      options={[
        { value: MODEL_DEFAULT, label: "Model default" },
        ...levels.map((level) => ({ value: level, label: level })),
      ]}
      value={value ?? MODEL_DEFAULT}
      onChange={(next) => onChange(next === MODEL_DEFAULT ? null : (next as ThinkingLevel))}
    />
  );
}
